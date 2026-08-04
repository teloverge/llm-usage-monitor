import {
  credentialIdFor,
  type CredentialSighting,
  type UsageQuotaSnapshot,
  type UsageRecord,
} from "@llm-usage-monitor/contracts";

export interface ProviderImportResult {
  records: UsageRecord[];
  quotaSnapshots: UsageQuotaSnapshot[];
  state: unknown;
  /** The provider's resolved home, so auxiliary collectors read the same one. */
  stats: { home: string };
}

export interface ImportProvider {
  readonly id: string;
  collect(
    sourceHostId: string,
    home: string | undefined,
    previousState: unknown,
  ): Promise<ProviderImportResult>;
}

export interface ImportLedger {
  importState(providerId: string): unknown;
  commitProviderImport(providerId: string, records: UsageRecord[], state: unknown): number;
  replaceQuotaSnapshots(snapshots: UsageQuotaSnapshot[]): void;
  recordCredentialObservation(sighting: CredentialSighting): void;
}

/**
 * Runs one provider's import: collect, store the records, then store the quota.
 *
 * The order is the point. `replaceQuotaSnapshots` validates against a strict
 * schema, so a single malformed quota field used to throw before any record was
 * written — discarding a whole run's usage over a supplementary reading. Worse,
 * import state advances only inside `commitProviderImport`, so a bad value that
 * persisted in the source file blocked every later import too, not just the run
 * that met it.
 *
 * So records commit first, and both auxiliary writes — the quota snapshot and
 * the credential observation — happen after that commit and cannot fail the
 * import. When a snapshot is refused the ledger keeps the previous one, and the
 * panel's "as of" line already shows the reader how old that reading is — the
 * staleness is visible without inventing a second error channel for it. The
 * credential is read before the quota is written because the snapshot carries
 * the credential's id; the two remain independently fallible.
 */
export async function runProviderImport(
  provider: ImportProvider,
  ledger: ImportLedger,
  sourceHostId: string,
  home: string | undefined,
  onAuxiliaryWriteFailed: (providerId: string, error: unknown) => void,
  observeCredential?: (
    home: string,
    observedAt: string,
  ) => Promise<CredentialSighting | null> | CredentialSighting | null,
): Promise<number> {
  const result = await provider.collect(sourceHostId, home, ledger.importState(provider.id));
  const committed = ledger.commitProviderImport(provider.id, result.records, result.state);
  // The sighting is resolved BEFORE the quota write so each snapshot can be
  // stamped with the credential in effect at observation — the fact the ledger
  // now keys retention on. A collector failure downgrades the stamp, never the
  // snapshot: the reading is still true, it is merely unattributed.
  let sighting: CredentialSighting | null = null;
  if (observeCredential) {
    try {
      sighting = await observeCredential(result.stats.home, new Date().toISOString());
    } catch (error) {
      onAuxiliaryWriteFailed(provider.id, error);
    }
  }
  // Computed outside the map: TypeScript does not carry the null-check
  // narrowing of a mutable binding into a closure, and the id is the same for
  // every snapshot in the run anyway.
  const stamp = sighting ? credentialIdFor(sighting) : null;
  const stamped = stamp
    ? result.quotaSnapshots.map((snapshot) => ({ ...snapshot, credentialId: stamp }))
    : result.quotaSnapshots;
  try {
    ledger.replaceQuotaSnapshots(stamped);
  } catch (error) {
    // Refused, not ignored: swallowing this silently would hide a mapper that
    // has drifted from the contract behind a panel that merely looks stale.
    onAuxiliaryWriteFailed(provider.id, error);
  }
  if (sighting) {
    try {
      ledger.recordCredentialObservation(sighting);
    } catch (error) {
      // Same reasoning as the quota write above: the credential is a reading
      // about the machine, not the usage, and must not be able to discard a run.
      onAuxiliaryWriteFailed(provider.id, error);
    }
  }
  return committed;
}

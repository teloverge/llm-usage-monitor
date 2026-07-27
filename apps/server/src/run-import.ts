import type { UsageQuotaSnapshot, UsageRecord } from "@llm-usage-monitor/contracts";

export interface ProviderImportResult {
  records: UsageRecord[];
  quotaSnapshots: UsageQuotaSnapshot[];
  state: unknown;
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
 * So records commit first and the quota write cannot fail the import. When a
 * snapshot is refused the ledger keeps the previous one, and the panel's "as of"
 * line already shows the reader how old that reading is — the staleness is
 * visible without inventing a second error channel for it.
 */
export async function runProviderImport(
  provider: ImportProvider,
  ledger: ImportLedger,
  sourceHostId: string,
  home: string | undefined,
  onQuotaRejected: (providerId: string, error: unknown) => void,
): Promise<number> {
  const result = await provider.collect(sourceHostId, home, ledger.importState(provider.id));
  const committed = ledger.commitProviderImport(provider.id, result.records, result.state);
  try {
    ledger.replaceQuotaSnapshots(result.quotaSnapshots);
  } catch (error) {
    // Refused, not ignored: swallowing this silently would hide a mapper that
    // has drifted from the contract behind a panel that merely looks stale.
    onQuotaRejected(provider.id, error);
  }
  return committed;
}

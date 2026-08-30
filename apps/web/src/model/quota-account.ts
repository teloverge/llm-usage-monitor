import {
  credentialIdFor,
  type CredentialObservation,
  type UsageQuotaSnapshot,
} from "@llm-usage-monitor/contracts";
import { latestCredential } from "./credential.ts";

export interface QuotaAccount {
  /** The newest reading among the hosts on this account. */
  snapshot: UsageQuotaSnapshot;
  credential: CredentialObservation | undefined;
  /** Every host whose reading was folded in, newest first. */
  sourceHostIds: string[];
}

/**
 * Folds the per-host snapshots into one meter per account.
 *
 * The ledger keys quota by (usage source, host) because that is the unit it
 * observes, but the quota belongs to the ACCOUNT: one subscription signed in on
 * two machines has one weekly window, and showing it twice reads as two plans.
 * Two hosts fold together when their latest credentials carry the same
 * non-empty fingerprint. An empty fingerprint names no account — an API key,
 * say — so it can never prove two hosts share one, and those stay apart, as
 * does any host whose credential has not been observed at all.
 *
 * The newest reading wins because quota is a moment in time; the older host's
 * figure is the same account seen earlier.
 */
export function quotaAccounts(
  snapshots: UsageQuotaSnapshot[],
  credentials: CredentialObservation[],
): QuotaAccount[] {
  const accounts = new Map<string, QuotaAccount>();
  for (const snapshot of snapshots) {
    const credential = latestCredential(credentials, snapshot.usageSourceId, snapshot.sourceHostId);
    const account = credential?.fingerprint
      ? credentialIdFor(credential)
      : `host:${snapshot.sourceHostId}`;
    const key = `${snapshot.usageSourceId}/${account}`;
    const existing = accounts.get(key);
    if (!existing) {
      accounts.set(key, { snapshot, credential, sourceHostIds: [snapshot.sourceHostId] });
    } else if (snapshot.observedAt > existing.snapshot.observedAt) {
      existing.snapshot = snapshot;
      existing.credential = credential;
      existing.sourceHostIds.unshift(snapshot.sourceHostId);
    } else {
      existing.sourceHostIds.push(snapshot.sourceHostId);
    }
  }
  return [...accounts.values()];
}

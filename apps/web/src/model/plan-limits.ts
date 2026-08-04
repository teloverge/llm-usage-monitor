import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { credentialIdFor } from "@llm-usage-monitor/contracts";

export interface PlanCard {
  /** `credentialIdFor` id, or null for snapshots observed with no credential. */
  credentialId: string | null;
  /** Raw contract mode ("subscription", "api-key", …), or null when unattributed. */
  mode: string | null;
  /** Plan tier from the newest snapshot naming one. */
  plan?: string;
  /** True when any grouped snapshot is its source's current observation. */
  active: boolean;
  /** Newest first, so the card's header facts come from its freshest evidence. */
  snapshots: QuotaSnapshotView[];
}

/**
 * Groups the analysis's snapshots into one card per Credential — the
 * subscription is the thing, the source and host merely where it was observed
 * from, so one account seen from two machines is ONE card with two meter
 * groups.
 *
 * Unattributed snapshots do NOT share a bucket: each keeps a per-source card,
 * because two sources with unknown accounts are not known to be the SAME
 * account, and merging them would assert exactly that. The NUL prefix keeps
 * those keys out of the credential-id namespace.
 */
export function planCards(snapshots: QuotaSnapshotView[]): PlanCard[] {
  const buckets = new Map<string, QuotaSnapshotView[]>();
  for (const snapshot of snapshots) {
    const key = snapshot.credentialId ?? `\u0000${snapshot.usageSourceId}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(snapshot);
    else buckets.set(key, [snapshot]);
  }
  return [...buckets.entries()]
    .map(([key, grouped]) => {
      const newestFirst = [...grouped].sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt),
      );
      const credentialId = key.startsWith("\u0000") ? null : key;
      return {
        credentialId,
        mode: credentialId ? credentialId.slice(0, credentialId.lastIndexOf(":")) : null,
        plan: newestFirst.find((snapshot) => snapshot.plan)?.plan,
        active: grouped.some((snapshot) => snapshot.active),
        snapshots: newestFirst,
      };
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (right.snapshots[0]?.observedAt ?? "").localeCompare(left.snapshots[0]?.observedAt ?? ""),
    );
}

/**
 * Whether the card's mode was deduced rather than stated — the same marking
 * the quota meters used to take from `latestCredential`. Judged from the
 * NEWEST matching observation: a mode once inferred and since stated outright
 * has been confirmed, and keeping the hedge would understate what is now
 * known.
 */
export function cardInferred(card: PlanCard, credentials: CredentialObservation[]): boolean {
  let newest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (!card.credentialId || credentialIdFor(credential) !== card.credentialId) continue;
    if (!newest || credential.observedAt > newest.observedAt) newest = credential;
  }
  return newest?.inferred ?? false;
}

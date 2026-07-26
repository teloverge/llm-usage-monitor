import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";

/**
 * A Host Group as the editor manipulates it: the group plus the hosts that
 * belong to it *right now*. Membership is effective-dated in the ledger, but
 * the editor only ever writes "as of now", so it only ever reads the open rows.
 */
export interface HostGroupRow {
  id: string;
  name: string;
  memberHostIds: string[];
}

const isOpen = (membership: HostGroupMembership) => membership.effectiveTo === null;

export function hostGroupRows(
  hostGroups: HostGroup[],
  memberships: HostGroupMembership[],
): HostGroupRow[] {
  return hostGroups.map((group) => ({
    id: group.id,
    name: group.name,
    memberHostIds: memberships
      .filter((membership) => isOpen(membership) && membership.hostGroupId === group.id)
      .map((membership) => membership.sourceHostId),
  }));
}

export function currentGroupIdFor(
  sourceHostId: string,
  memberships: HostGroupMembership[],
): string | null {
  return (
    memberships.find((membership) => isOpen(membership) && membership.sourceHostId === sourceHostId)
      ?.hostGroupId ?? null
  );
}

export function ungroupedHostIds(
  sourceHosts: SourceHost[],
  memberships: HostGroupMembership[],
): string[] {
  return sourceHosts
    .filter((host) => currentGroupIdFor(host.id, memberships) === null)
    .map((host) => host.id);
}

/**
 * Order-insensitive comparison of a draft row against its saved counterpart.
 * Shared by `isDirty` (gates the Save button) and `mergeDraft` (decides
 * whether a refetch may overwrite a card) so the two never drift apart into
 * two different ideas of "changed".
 */
export function rowsDiffer(a: HostGroupRow, b: HostGroupRow): boolean {
  return (
    a.name !== b.name ||
    a.memberHostIds.length !== b.memberHostIds.length ||
    a.memberHostIds.some((id) => !b.memberHostIds.includes(id))
  );
}

/**
 * Reconciles in-progress edits (`current`) against a newly fetched server
 * snapshot (`fresh`), using `previous` — the server snapshot the user was
 * last shown — to tell "the user edited this" apart from "the server value
 * moved underneath an untouched card". Both look like a difference against
 * `fresh` alone.
 *
 * Rule: a card is the user's (and keeps its draft) only if it diverges from
 * `previous`; an untouched card always takes the fresh value, so a real
 * change from elsewhere (e.g. an import, or another tab retiring the group)
 * still surfaces. A not-yet-persisted new-group draft (its id absent from
 * `fresh`) survives via the trailing filter.
 *
 * Pure and side-effect-free by construction: calling this twice with the
 * same arguments always returns the same result. That purity is what makes
 * it safe to call from a React state updater under `React.StrictMode`,
 * which invokes updaters twice against the same base state — a version of
 * this logic that instead mutated a ref as a side effect of computing the
 * merge would see its second invocation compare against the OUTPUT of the
 * first, silently discarding real changes (see host-groups.test.ts).
 */
export function mergeDraft(
  current: HostGroupRow[],
  fresh: HostGroupRow[],
  previous: HostGroupRow[],
): HostGroupRow[] {
  return [
    ...fresh.map((row) => {
      const draftRow = current.find((item) => item.id === row.id);
      const previousRow = previous.find((item) => item.id === row.id);
      return draftRow && previousRow && rowsDiffer(draftRow, previousRow) ? draftRow : row;
    }),
    ...current.filter((row) => !fresh.some((row2) => row2.id === row.id)),
  ];
}

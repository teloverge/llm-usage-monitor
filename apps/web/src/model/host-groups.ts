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

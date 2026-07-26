import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import { hostGroupRows, ungroupedHostIds } from "../../model/host-groups.ts";
import { sourceHostLabel } from "../../model/source-host.ts";

/**
 * Membership is written "as of now" and never backdated, so a newly created
 * group explains nothing about existing history — every past record keeps
 * resolving to Ungrouped. That is correct, and it looks exactly like a save
 * that did nothing, so the hint is not decoration.
 */
const EFFECTIVE_HINT =
  "Grouping applies to usage recorded from now on. Earlier usage keeps the grouping that applied when it happened.";

export function HostGroups({
  hostGroups,
  memberships,
  sourceHosts,
}: {
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const rows = hostGroupRows(hostGroups, memberships);
  const ungrouped = ungroupedHostIds(sourceHosts, memberships);
  // Index is the positional fallback for machines whose hostname is unusable,
  // so it must come from the full host list, not a filtered subset.
  const labelFor = (sourceHostId: string) => {
    const index = sourceHosts.findIndex((host) => host.id === sourceHostId);
    const host = sourceHosts[index];
    return host ? sourceHostLabel(host, index) : sourceHostId;
  };
  return (
    <section className="settings-section" aria-labelledby="host-groups-title">
      <div className="settings-section-head">
        <h2 id="host-groups-title">Host groups</h2>
        <p>{EFFECTIVE_HINT}</p>
      </div>
      {rows.length === 0 ? (
        <p className="empty-state">No host groups yet.</p>
      ) : (
        <ul className="host-group-list">
          {rows.map((row) => (
            <li key={row.id} className="host-group-card">
              <h3>{row.name}</h3>
              <p className="host-group-members">
                {row.memberHostIds.length === 0
                  ? "No hosts"
                  : row.memberHostIds.map(labelFor).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="host-group-ungrouped">
        Ungrouped: {ungrouped.length === 0 ? "none" : ungrouped.map(labelFor).join(", ")}
      </p>
    </section>
  );
}

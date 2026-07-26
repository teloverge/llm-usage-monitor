import { useEffect, useState } from "react";
import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import { executeAction } from "../../api.ts";
import {
  currentGroupIdFor,
  hostGroupRows,
  ungroupedHostIds,
  type HostGroupRow,
} from "../../model/host-groups.ts";
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
  onSaved,
}: {
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const saved = hostGroupRows(hostGroups, memberships);
  const [draft, setDraft] = useState<HostGroupRow[]>(saved);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ungrouped = ungroupedHostIds(sourceHosts, memberships);
  /*
    Refetching replaces the props, and without this the cards would keep
    rendering pre-save values and look unsaved.

    Unsaved new-group drafts are carried across rather than dropped. `refresh()`
    in app.tsx fires on any filter change and hands back fresh array identities,
    so a plain reset would silently discard a group the user was part-way
    through naming just because they touched a topbar chip.
  */
  useEffect(() => {
    setDraft((current) => [
      ...hostGroupRows(hostGroups, memberships),
      ...current.filter((row) => !hostGroups.some((group) => group.id === row.id)),
    ]);
  }, [hostGroups, memberships]);

  const labelFor = (sourceHostId: string) => {
    const index = sourceHosts.findIndex((host) => host.id === sourceHostId);
    const host = sourceHosts[index];
    return host ? sourceHostLabel(host, index) : sourceHostId;
  };
  const savedName = (groupId: string) => hostGroups.find((group) => group.id === groupId)?.name;
  const update = (id: string, change: Partial<HostGroupRow>) =>
    setDraft((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const toggleHost = (row: HostGroupRow, sourceHostId: string) =>
    update(row.id, {
      memberHostIds: row.memberHostIds.includes(sourceHostId)
        ? row.memberHostIds.filter((id) => id !== sourceHostId)
        : [...row.memberHostIds, sourceHostId],
    });

  const save = async (row: HostGroupRow) => {
    setSavingId(row.id);
    setError("");
    try {
      await executeAction({
        version: 1,
        type: "set-host-group",
        hostGroupId: row.id,
        name: row.name.trim(),
        sourceHostIds: row.memberHostIds,
        effectiveAt: new Date().toISOString(),
      });
      await onSaved();
    } catch (reason) {
      // Without this the rejection is unhandled, onSaved never runs, and the
      // button returns to its resting state as though the save succeeded.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingId(null);
    }
  };

  const isDirty = (row: HostGroupRow) => {
    const original = saved.find((item) => item.id === row.id);
    return (
      !original ||
      original.name !== row.name ||
      original.memberHostIds.length !== row.memberHostIds.length ||
      original.memberHostIds.some((id) => !row.memberHostIds.includes(id))
    );
  };

  return (
    <section className="settings-section" aria-labelledby="host-groups-title">
      <div className="settings-section-head">
        <h2 id="host-groups-title">Host groups</h2>
        <p>{EFFECTIVE_HINT}</p>
      </div>
      {error && (
        <p role="alert" className="error host-group-error">
          {error}
        </p>
      )}
      {draft.length === 0 ? (
        <p className="empty-state">No host groups yet.</p>
      ) : (
        <ul className="host-group-list">
          {draft.map((row) => (
            <li key={row.id} className="host-group-card">
              <div className="host-group-card-head">
                <label className="host-group-name">
                  Group name
                  <input
                    type="text"
                    value={row.name}
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={savingId !== null || row.name.trim() === "" || !isDirty(row)}
                  onClick={() => void save(row)}
                >
                  {savingId === row.id ? "Saving…" : "Save"}
                </button>
              </div>
              <fieldset className="host-group-hosts">
                <legend>Hosts in {savedName(row.id) ?? "this group"}</legend>
                {sourceHosts.map((host, index) => {
                  const elsewhere = currentGroupIdFor(host.id, memberships);
                  const moving = elsewhere !== null && elsewhere !== row.id;
                  return (
                    <label key={host.id} className="host-group-host">
                      <input
                        type="checkbox"
                        checked={row.memberHostIds.includes(host.id)}
                        onChange={() => toggleHost(row, host.id)}
                      />
                      <span>{sourceHostLabel(host, index)}</span>
                      {/* Shown before the move, not after, so the consequence
                          is visible while the choice is still reversible. */}
                      {moving && (
                        <span className="host-group-moving">
                          currently in {savedName(elsewhere) ?? elsewhere}
                        </span>
                      )}
                    </label>
                  );
                })}
              </fieldset>
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

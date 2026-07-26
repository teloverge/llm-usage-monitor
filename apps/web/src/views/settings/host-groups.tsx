import { useEffect, useRef, useState } from "react";
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

/**
 * Ids are generated, never derived from the name: the name is editable and a
 * slug-derived id would change under a rename, orphaning historical
 * memberships. `crypto.randomUUID` is available because the dashboard is served
 * from 127.0.0.1, which browsers treat as a secure context.
 */
const newGroupId = () => `group:${crypto.randomUUID()}`;

/**
 * Order-insensitive comparison of a draft row against its saved counterpart.
 * Shared by `isDirty` (gates the Save button) and the refresh effect (decides
 * whether a refetch may overwrite a card) so the two never drift apart into
 * two different ideas of "changed".
 */
function rowsDiffer(a: HostGroupRow, b: HostGroupRow): boolean {
  return (
    a.name !== b.name ||
    a.memberHostIds.length !== b.memberHostIds.length ||
    a.memberHostIds.some((id) => !b.memberHostIds.includes(id))
  );
}

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

    `refresh()` in app.tsx fires on any filter change and hands back fresh
    array identities, so a plain reset would silently overwrite a rename or a
    membership tick the moment the user touched an unrelated topbar chip. But
    comparing the draft to the newly fetched row can't tell "the user edited
    this" apart from "the server value moved underneath an untouched card" —
    both look like a difference. So `lastSeen` tracks the server rows we
    last showed the user: a card is the user's (and keeps its draft) only if
    it diverges from THAT snapshot; an untouched card always takes the fresh
    value, so a real change from elsewhere (e.g. an import) still surfaces.
    Not-yet-persisted new-group drafts are carried across the same way, via
    the append below.
  */
  const lastSeen = useRef<HostGroupRow[]>(saved);
  useEffect(() => {
    setDraft((current) => {
      const fresh = hostGroupRows(hostGroups, memberships);
      const merged = [
        ...fresh.map((row) => {
          const draftRow = current.find((item) => item.id === row.id);
          const lastSeenRow = lastSeen.current.find((item) => item.id === row.id);
          return draftRow && lastSeenRow && rowsDiffer(draftRow, lastSeenRow) ? draftRow : row;
        }),
        ...current.filter((row) => !hostGroups.some((group) => group.id === row.id)),
      ];
      lastSeen.current = fresh;
      return merged;
    });
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

  const addGroup = () =>
    setDraft((current) => [...current, { id: newGroupId(), name: "", memberHostIds: [] }]);

  /**
   * Retirement, not deletion: the group keeps its historical memberships with a
   * closed effective_to, so past totals do not move. There is deliberately no
   * way to delete a group and rewrite history.
   */
  const retire = async (row: HostGroupRow) => {
    const label = savedName(row.id) ?? row.name;
    if (
      !window.confirm(
        `Retire "${label}"? Usage recorded from now on will be ungrouped. Past usage keeps this group, so no existing totals change.`,
      )
    )
      return;
    await save({ ...row, name: label, memberHostIds: [] });
  };

  const isDirty = (row: HostGroupRow) => {
    const original = saved.find((item) => item.id === row.id);
    return !original || rowsDiffer(original, row);
  };

  return (
    <section className="settings-section" aria-labelledby="host-groups-title">
      <div className="settings-section-head host-group-head">
        <div>
          <h2 id="host-groups-title">Host groups</h2>
          <p>{EFFECTIVE_HINT}</p>
        </div>
        <button type="button" className="primary" onClick={addGroup}>
          New group
        </button>
      </div>
      {error && (
        <p role="alert" className="error host-group-error">
          {error}
        </p>
      )}
      {draft.length === 0 ? (
        <p className="empty-state">No host groups yet. Use New group to add one.</p>
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
                <div className="host-group-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={savingId !== null || row.name.trim() === "" || !isDirty(row)}
                    onClick={() => void save(row)}
                  >
                    {savingId === row.id ? "Saving…" : "Save"}
                  </button>
                  {/* A draft that was never saved has nothing to retire; it is
                      discarded by reload, so the button would be a no-op. */}
                  {savedName(row.id) !== undefined && (
                    <button
                      type="button"
                      disabled={savingId !== null}
                      onClick={() => void retire(row)}
                    >
                      Retire
                    </button>
                  )}
                </div>
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

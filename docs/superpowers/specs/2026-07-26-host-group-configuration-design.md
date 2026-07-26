# Host Group configuration

Date: 2026-07-26
Status: Approved for planning
Branch: `refactor/portable-usage-host`

## Outcome

Host Groups exist everywhere except where a user could create one. The schema,
the effective-dated resolution, the `set-host-group` action, the `hostGroupId`
filter, and the Breakdown tab all shipped; nothing ever calls them. This spec
closes the vertical slice: a Settings editor that creates, renames, populates,
and retires Host Groups, plus the reader path that lets a group's **name** reach
the screen.

## Scope

In scope:

- A `Host groups` tab in Settings holding the editor.
- `UsageLedger.hostGroups()` — the reader for a column that is currently
  write-only.
- Enforcing one group per Source Host at a time inside `setHostGroup`.
- Labelling `byHostGroup` rows by name instead of raw id.
- Carrying `hostGroups` through `/api/catalog` and `analyzeUsage`.
- Fixing the unhandled-rejection gap in `Pricing.save` while in that folder.

Explicitly out of scope:

- **Backdating membership.** `effectiveAt` is always `now`. See Decisions.
- **Hard deletion.** Removal means retirement. See Decisions.
- **Nested or overlapping groups.** A Source Host belongs to at most one group
  at any instant.
- Source Host Agent transport, remote enrollment, or anything that would produce
  a second host. This work makes grouping configurable; it does not make hosts
  appear.
- A `hostGroupId` filter chip in the topbar. The filter is supported by the
  contract and the analysis, but with one host a fourth chip earns nothing.
  Revisit when a second host exists.

## Decisions

| Decision      | Choice                                     | Why                                                                                               |
| ------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Why now       | Complete the vertical slice                | The concept is documented in CONTEXT.md and half-built in code; leaving it unreachable is the bug |
| `effectiveAt` | Always `now`                               | The purest reading of effective-dating: history keeps the grouping that applied when it happened  |
| Removal       | Retire, never hard-delete                  | Follows from `effectiveAt = now`; past totals must stay stable                                    |
| Cardinality   | One group per host at a time               | CONTEXT.md says _avoid: tag_; `effectiveGroup` returns a single value                             |
| Row labelling | Analysis keys `byHostGroup` by name        | Mirrors `bySourceHost`, which already keys by resolved label                                      |
| Placement     | Tab strip inside Settings                  | Establishes the pattern for later settings sections; keeps each view a focused file               |
| Group id      | `group:<uuid>`, generated once on create   | Names are editable, so a slug-derived id would break on rename                                    |
| Test surface  | Pure functions in `model/`, not components | Matches how `apps/web/test` tests today                                                           |

### Why `effectiveAt = now` needs visible explanation

The consequence of this decision is that the first group a user creates appears
to do nothing: every existing record keeps resolving to `Ungrouped`, so the
Breakdown tab stays empty until fresh usage accumulates. That is correct
behaviour and it looks exactly like a broken feature.

The editor therefore carries fixed hint text:

> Grouping applies to usage recorded from now on. Earlier usage keeps the
> grouping that applied when it happened.

This sentence is load-bearing, not decoration. It is the only thing
distinguishing "working as designed" from "the save button does nothing".

## Defects this work fixes

Both are pre-existing and both are exposed the moment a config UI exists.

**`setHostGroup` does not enforce one-group-per-host.** It closes open
memberships for the target group id only:

```sql
UPDATE host_group_memberships SET effective_to=? WHERE host_group_id=? AND effective_to IS NULL
```

Assigning a host that already belongs to group A into group B leaves two open
membership rows. `effectiveGroup` resolves with `.find()` over rows ordered by
`effective_from`, so the host silently reports whichever membership was created
first — not the one the user just chose. The fix is to also close open
memberships for the incoming `sourceHostIds` across all other groups, in the
same transaction.

**`host_groups.name` is write-only.** There is no `hostGroups()` accessor, so
the `HostGroup` contract interface has no implementation behind it and
`byHostGroup` rows render raw ids like `group:9f3c…`.

## Architecture

Data flows the same way Source Host labels already do.

```
UsageLedger.hostGroups() ─┐
UsageLedger.memberships() ─┼─> /api/catalog ──> app.tsx state ──> HostGroups editor
UsageLedger.sourceHosts() ─┘                                            │
                                                                        v
                                              executeAction(set-host-group)
                                                                        │
                                                                        v
UsageLedger.hostGroups() ───> analyzeUsage({ hostGroups, memberships }) ───> byHostGroup keyed by name
```

### `packages/usage-ledger`

- `hostGroups(): HostGroup[]` — `SELECT id, name FROM host_groups ORDER BY name`.
- `setHostGroup` gains the cross-group close described above, inside the existing
  transaction so a partial reassignment is impossible.

No delete method. Retirement is `setHostGroup(id, name, [], now)`, which the
current implementation already handles correctly.

### `packages/contracts`

No new action and no schema change. `set-host-group` already expresses create,
rename, reassign and retire — the distinction is entirely in the arguments. The
existing `HostGroup` interface becomes load-bearing for the first time.

### `packages/usage-analysis`

`AnalysisInput` gains `hostGroups: HostGroup[]`. `byHostGroup` resolves a group
id to its name, falling back to the id when no group row matches, and keeps
`"Ungrouped"` for a null resolution. This mirrors the `hostNames` map already
built for `bySourceHost`.

### `apps/server`

`/api/catalog` returns `hostGroups` alongside `prices`, `sourceHosts` and
`memberships`. `analyzeUsage` receives `ledger.hostGroups()`.

### `apps/web`

**`api.ts`** — type the catalog return properly. It currently declares only
`{ prices, sourceHosts }` while the server also sends `memberships`, so a
correct field is invisible to consumers.

**`model/host-groups.ts`** (new, pure) — the whole derivation:

```ts
export interface HostGroupRow {
  id: string;
  name: string;
  memberHostIds: string[];
}
export function hostGroupRows(
  hostGroups: HostGroup[],
  memberships: HostGroupMembership[],
): HostGroupRow[];
export function ungroupedHostIds(
  sourceHosts: SourceHost[],
  memberships: HostGroupMembership[],
): string[];
export function currentGroupIdFor(
  sourceHostId: string,
  memberships: HostGroupMembership[],
): string | null;
```

Current membership is `effectiveTo === null`. Keeping this out of the component
is what makes it testable, consistent with `model/source-host.ts` and
`model/harness.ts`.

**`views/settings/host-groups.tsx`** (new) — one card per group:

- A name input.
- A checkbox per Source Host, labelled with `sourceHostLabel(host, index)`.
  Never `host.hostname` directly; some machines report a MAC address there.
- Hosts currently in a different group show that group's name inline, so a move
  is visible before it is committed.
- **Save** dispatches
  `{ version: 1, type: "set-host-group", hostGroupId, name, sourceHostIds, effectiveAt: new Date().toISOString() }`
  then awaits `onSaved()`.
- **Retire** dispatches the same action with `sourceHostIds: []`, behind a
  confirmation, and explains that history is unaffected.
- **+ New group** appends a draft card with `group:${crypto.randomUUID()}`. A
  draft is not persisted until saved, and an empty name blocks Save —
  `set-host-group` requires `name.min(1)`.
- Ungrouped hosts are listed below the cards.
- Save failures set a local error and surface it in an `role="alert"` region.
  The action is a POST that can legitimately 400 or 403.

**`views/settings/index.tsx`** (new) — a shell owning
`"rates" | "host-groups"` tab state, rendered where `app.tsx` currently renders
`<Pricing>` directly. This keeps the new concern out of `app.tsx`, which already
holds nine pieces of state. Tabs reuse the `chip` / `aria-pressed` idiom from
Breakdown's Group-by row rather than inventing a control.

**`app.tsx`** — holds `hostGroups` and `memberships` from the catalog and passes
them down. One added state pair, no added logic.

**`views/settings/rates.tsx`** — add the missing `catch` to `save`. The current
`try/finally` lets a failed save reject unhandled while the button returns to
reading "Prices saved", which is the identical defect `refreshSources` was fixed
for in `app.tsx`.

## Error handling

| Failure                                  | Behaviour                                                           |
| ---------------------------------------- | ------------------------------------------------------------------- |
| Save rejects (network, 400, 403)         | Local `role="alert"` in the editor; draft state preserved for retry |
| Empty group name                         | Save disabled; the action schema would reject it anyway             |
| Group with zero members saved            | Allowed — identical to retirement                                   |
| Catalog omits a group a membership cites | `byHostGroup` falls back to the raw id rather than dropping the row |

## Testing

| Layer          | Test                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| usage-ledger   | `hostGroups()` round-trips names, ordered                                             |
| usage-ledger   | Reassigning a host closes its previous group's open membership — the defect above     |
| usage-ledger   | Retiring leaves historical membership rows intact with a closed `effective_to`        |
| usage-analysis | `byHostGroup` keys by name; unknown group id falls back to the id                     |
| usage-analysis | `Ungrouped` still covers hosts with no effective membership                           |
| web/model      | `hostGroupRows` selects only open memberships                                         |
| web/model      | `ungroupedHostIds` excludes hosts whose membership was retired, then re-includes them |

Components are not tested directly; the derivation they render is.

## Success criteria

1. A user can open Settings, create a group, put the local host in it, save, and
   see the group's **name** in Breakdown → Host Group for usage recorded after
   the save.
2. Renaming a group changes the label everywhere without altering any totals.
3. Retiring a group leaves every historical figure unchanged.
4. Moving a host between groups produces exactly one open membership for it.
5. No raw `group:<uuid>` string is ever shown to a user.

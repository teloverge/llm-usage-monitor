# Dashboard redesign and multi-harness usage sources

Date: 2026-07-24
Status: Approved for planning
Branch: `refactor/portable-usage-host`

## Outcome

Rebuild the browser dashboard as a condensed, cost-first cockpit, and generalize
collection so Codex and Claude Code are both first-class usage sources. One spec,
one plan, executed as eleven dependency-ordered slices.

The dashboard answers one question in five seconds: **what would the work I did
cost at API rates, and what drove that number.** Every layout, default, and color
decision below serves that question.

This spec supersedes the UI portions of `docs/plans/multi-harness-usage-sources.md`
and absorbs its architectural decisions. That document remains the reference for
adapter-level detail.

## Scope

In scope:

- Full visual and structural redesign of `apps/web`.
- Canonical separation of usage source, harness, provider, and model.
- Normalized quota snapshots replacing Codex-shaped rate limits.
- The `usage-sources` collection seam, its registry, and the Codex adapter.
- Atomic source ownership and reconciliation in the ledger.
- The Claude Code adapter.
- The adapter conformance kit.

Explicitly out of scope:

- **The ten remaining adapters** in the source plan's Slice 7 (Pi, OpenCode,
  Gemini CLI, Qwen Code, Kimi Code CLI, Kilo Code, t3code, Cursor, Grok Build,
  Antigravity). They carry no design content, are gated behind the conformance
  kit, and each needs format research immediately before implementation. They
  belong to a separate effort per adapter.
- Source Host Agent transport.
- Light mode. The dashboard is dark-only; the token layer is structured so a
  light theme is a later additive change, not a rewrite.
- Budgets, subscription break-even, and period-over-period deltas. The user's
  stated need is the API-equivalent cost of work performed, not a variance
  report.

## Decisions

| Decision          | Choice                                   | Why                                                                                |
| ----------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| Primary job       | "Am I burning too much?" — cost-first    | Stated by the user; drives hierarchy everywhere                                    |
| Reference point   | The estimate itself, with drivers        | User wants the API-equivalent price of work done, not a budget comparison          |
| Overview layout   | Cost cockpit: main column + context rail | Keeps the main column a pure cost story; non-spend context does not interrupt it   |
| Tone              | Remove marketing hero                    | It is a tool the user already owns, not a landing page                             |
| Advanced view     | Kept, renamed **Breakdown**              | Overview stays a summary; Breakdown is the deep pivot                              |
| Pricing           | Moves into **Settings**                  | Rare setup task; frees the main nav for the three analysis views                   |
| Filters           | Topbar chips                             | Zero vertical cost, always reachable, one filter row scoping everything            |
| Harness in UI     | A driver panel on Overview               | Coarsest grouping, visible without changing filters                                |
| Analysis addition | Task → session children                  | Lets Breakdown drill without a separate history query                              |
| Sequencing        | Visual foundation first, then interleave | The design system has zero coupling to harness work, so pulling it forward is free |

## Visual system

### Palette

Colors were computed, not chosen. Every value below was validated with the
data-visualization palette validator against this application's actual chart
surface (`#151e1a`), in dark mode, with `--pairs all`.

The current chart colors fail. `#16c79a` measures OKLCH L 0.739, `#f4b942`
measures 0.826, and `#ed6a8b` measures 0.708 — all outside the 0.48–0.67 band
required for data marks against a dark surface, which is why the existing charts
read as glare. `#f4b942` and `#ed6a8b` additionally fall below the
normal-vision separation floor.

**Roles:**

| Role              | Hex                   | Use                                                                        |
| ----------------- | --------------------- | -------------------------------------------------------------------------- |
| UI accent         | `#16c79a`             | Buttons, focus rings, brand mark, the hero figure. **Never a chart fill.** |
| Series 1 — teal   | `#0fae83`             | Rank bars, single-series trend, cached tokens                              |
| Series 2 — blue   | `#3987e5`             | Fresh input tokens                                                         |
| Series 3 — orange | `#d95926`             | Output tokens                                                              |
| Status good       | `#0ca30c`             | Quota meter under threshold                                                |
| Status warning    | `#fab219`             | Quota meter approaching limit                                              |
| Status critical   | `#d03b3b`             | Quota meter at limit                                                       |
| Surface / panel   | `#0d1411` / `#151e1a` | Page plane, chart surface                                                  |
| Gridline          | `#22302a`             | Solid hairline, horizontal only                                            |
| Baseline / axis   | `#384a41`             | Solid hairline                                                             |
| Primary ink       | `#e6eee9`             | Body text                                                                  |
| Muted ink         | `#95a59c`             | Labels, axis ticks, meta                                                   |
| Track             | `#24342c`             | Empty portion of bars and meters                                           |

Validator result for the categorical trio, all pairs, dark, surface `#151e1a`:
lightness band PASS; chroma floor PASS; CVD separation PASS (worst
`#d95926`↔`#0fae83` ΔE 10.5 deutan); normal-vision floor PASS (worst
`#3987e5`↔`#0fae83` ΔE 20.1); contrast PASS (all ≥ 3:1).

The status palette is fixed and is not a categorical set — the validator's
categorical checks do not apply to it. All three status steps clear 3:1 against
`#151e1a`. Status color never carries meaning alone: every status meter ships
with a glyph and a text label.

Series color follows the entity, never its rank. Filtering a series out must not
repaint the survivors.

### Type and density

| Role          | Size                          | Notes                                           |
| ------------- | ----------------------------- | ----------------------------------------------- |
| Hero figure   | 44px / 700 / -0.035em         | Proportional figures, system sans, accent color |
| Stat value    | 20px / 650                    | Proportional figures                            |
| Zone label    | 10px / 700 / 0.13em uppercase | Section grouping, muted, with a hairline rule   |
| Body and rows | 12.5px                        |                                                 |
| Meta and axis | 11px                          | Muted                                           |

The text floor rises from 9px to 11px. Card padding drops from 13px to 10–12px.
The blanket `min-height: 280px` on every card is deleted — containers grow to
their content, which is also what stops charts from clipping their own x-axis
labels. `font-variant-numeric: tabular-nums` applies to every vertically aligned
numeric column and to axis ticks; it is never applied to the hero figure or stat
values.

Typeface remains the system sans stack throughout. No display or serif face.

### Mark specifications

- Bars: 8px thick, 4px rounded on the data end only, anchored to the baseline.
- Lines: 2px, round joins. Endpoint marker 4.5px with a 2px surface ring.
- Stacked segments: 2px surface gap between fills. Never a stroke border.
- Gridlines: solid hairlines, horizontal only. **No dashed grid** — dashing reads
  as threshold or projection. Vertical grid removed; x-axis ticks carry it.
- Rank bars use one hue for every row. A value ramp across nominal categories is
  forbidden — it double-encodes length as color.
- Labels render inside a mark only when they fit with padding; otherwise they
  move outside the bar end or drop to the tooltip and table view.

### Chart forms

Four current charts change form because each matches a known anti-pattern:

| Current                                     | Replacement                                   | Reason                                                                                            |
| ------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Token composition donut                     | Horizontal stacked bar + value rows           | A donut cannot distinguish the two 24% slices; the bar keeps part-to-whole and adds direct labels |
| Two time charts (cost, tokens)              | One chart with a Cost/Tokens segmented toggle | One measure on one axis at a time. Dual-axis plots are forbidden outright                         |
| `<progress>` plan limits                    | Meter with status fill, glyph, and label      | A ratio against a ceiling is a meter, and its fill should carry state                             |
| Rank bars with accent fill, three rows each | One hue, one row per item                     | Removes the value-ramp double-encoding and fits four items where three fit before                 |

Every chart has a table-view twin reachable from Breakdown. Tooltips enhance and
never gate: every value is reachable via direct labels or the table view, and
keyboard focus shows the same content as hover.

## Information architecture

```
Topbar:  brand | Overview  Breakdown  History | [Period ▾] [Host ▾] [⌕ tasks] [Refresh sources] [⚙]
Settings (behind ⚙):  Sources · Rates · Hosts & groups · Data
```

Three analysis views, one settings surface. Filters live in the topbar as chips —
one filter row scoping everything below it, costing no vertical space. Per-chart
filters are forbidden.

## View: Overview

Two columns: a main column carrying the cost story, and a 248px context rail.

**Responsive behavior.** Below 1180px the rail moves beneath the main column and
its three panels lay out as a three-column row. Below 860px the driver panels
stack to two columns and the rail panels to two. Below 640px everything is a
single column, the topbar chips wrap to a second line, and the trend chart keeps
its axis band by growing rather than shrinking. The rail is never narrower than
248px; it either holds that width or moves below.

**Main column, in order:**

1. **Headline panel.** Label ("API-equivalent cost of work · last 30 days"), the
   hero figure, and a coverage line ("4,812 of 4,900 records priced · estimated
   at your configured API rates, not a bill"). The disclaimer survives here as
   one muted clause and once more in the footer — the current full-width notice
   banner is deleted.
2. **Trend chart**, inside the same panel. Single series, area with 2px line and
   endpoint marker, solid horizontal hairline grid, crosshair plus tooltip. A
   Cost/Tokens segmented control switches the measure; the axis re-scales to the
   selected measure. No legend — a single series is named by its label.
3. **Stat strip.** Four values divided by hairlines: Tokens, Cached input,
   Tasks, Models. Stat tiles, not charts.
4. **Zone: "What drove it."** Three rank panels — By harness, By model, By task.
   Each caps at four rows. When more rows exist, an "N more →" link opens
   Breakdown with that panel's dimension selected in the group-by chip row
   (`By model` → `Model`, `By task` → `Task → Session`, `By harness` →
   `Harness → Model`), carrying the current topbar filters unchanged.

**Context rail:**

1. **Token mix** — stacked bar plus value rows carrying name, absolute, and
   percent. Three categorical slots.
2. **Plan limits** — grouped by source, each rendering that source's own named
   windows with meters, status color, glyph, and reset time. Thresholds on
   `usedPercent`: **good** below 75, **warning** 75 to below 90, **critical** 90
   and above. A window with no `usedPercent` renders its label and reset time
   with no meter and the text "Not reported".
3. **Hosts** — rank list.

Footer: "Everything stays on this machine · API-equivalent estimates are not
billing claims."

Removing the eyebrow, headline, disclaimer banner, and filter card returns
roughly 190px of vertical space, which is what allows the full picture to fit
above the fold at 1440×900.

## View: Breakdown

Group-by is a chip row, not a dropdown: `Harness → Model`, `Model`,
`Task → Session`, `Host`, `Host Group`. A "Table view" button toggles the
WCAG-clean twin — same numbers, no color encoding.

Rollups nest to three levels (`Harness → Model → Reasoning`). Each level's bar is
scaled to its own parent, never to the grand total, so a child bar never implies
a share of the whole. Every level totals to the level above it.

## View: History

Task groups containing session rows. The group header carries session count,
record count, last-active time, token total, and cost, so the list is scannable
without expanding. The session table gains a **Harness** column with a small
identity dot. Columns: Last active, Harness, Model, Reasoning, Host, Records,
Tokens, Cost.

## View: Settings

Four panels behind the gear:

- **Sources** — one row per known source: name, `usageSourceId`, discovered
  path, declared capability gaps, last sync time, record count, and a per-source
  Refresh. Below the list, the outcome of the last refresh, per source. This is
  where the generic `refresh-sources` action reports what happened.

  Two orthogonal states are rendered, and conflating them is a bug:
  **detection state** (`detected` · `configured` · `unavailable` · `failed`)
  drives the row's icon, enabled state, and opacity; **verification level**
  (`experimental` · `verified`) drives the badge and is only shown for a source
  that is detected or configured. An `unavailable` source renders at reduced
  opacity with a disabled Refresh and no verification badge; a `failed` source
  renders its bounded diagnostic message and keeps Refresh enabled.

- **Rates** — the existing price table, restyled. Sticky toolbar with the save
  action; dirty state drives the button.
- **Hosts & groups** — Source Host labels and effective-dated Host Group
  membership.
- **Data** — retention and the `clear-records` action, behind its existing
  confirmation.

## States

- **Refetch** holds the previous render at reduced opacity. No skeleton flash, no
  layout jump.
- **No quota capability** renders "Not reported". Never a zero meter, never an
  error.
- **Unpriced model** contributes tokens but not dollars; the coverage line under
  the hero figure is where that becomes visible.
- **Empty result** for the current filters renders a single centered line naming
  the filter that excluded everything.
- **Error** renders inline in the affected panel, not as a page-level banner.

## Contract changes

### `UsageRecord`

Added:

- `usageSourceId: string` — the adapter and source format that supplied
  authoritative evidence (`"codex-local"`, `"claude-code-local"`).
- `harnessId: string` — the coding harness the work occurred in (`"codex"`,
  `"claude-code"`).

Changed to explicitly optional, rather than defaulting to `""` or `0`:

- `reasoningLevel`, `cachedInputTokens`, `reasoningOutputTokens`,
  `modelContextWindowTokens`, `sessionId`, `turnId`.

Removed:

- `rateLimits` — leaves the record entirely (see quota snapshots).

`provider` and `model` keep their current meaning. Pricing continues to key only
on provider and model.

### `UsageQuotaSnapshot` (new)

```ts
interface UsageQuotaSnapshot {
  usageSourceId: string;
  sourceHostId: string;
  accountScope?: string;
  plan?: string;
  observedAt: string;
  windows: Array<{
    id: string;
    label: string;
    usedPercent?: number;
    windowMinutes?: number;
    resetsAt?: string;
  }>;
  balance?: { amount: number; unit: string };
}
```

Persisted separately from records and owned by `usageSourceId` + `sourceHostId`.
Quota data never participates in cost calculation. Provider-native detail may be
retained only in a bounded, versioned diagnostic payload that canonical analysis
does not read.

### `UsageFilters`

Added `harnessId?: string` and `usageSourceId?: string`.

### `OverviewView`

- Added `byHarness: RankedUsage[]`.
- `byTask` rows gain `children` (sessions), matching the existing `byModel`
  shape.
- `latestRateLimits: RateLimits | null` → `quotaSnapshots: UsageQuotaSnapshot[]`
  (latest per source and host).

### `RankedUsage`

Added optional `harnessId`.

### Dashboard actions

- New `refresh-sources` with optional `sourceIds[]`, returning per-source
  outcomes. One source failing must not hide another source's success, and an
  unknown or disabled source fails closed with a typed outcome.
- `import-codex` remains for one release as a deprecated alias routing to
  `refresh-sources` with `sourceIds: ["codex-local"]`.
- New read-only source catalog response backing Settings → Sources:
  descriptor, detection state, verification level, declared capabilities, last
  collection status.

## Analysis changes

- Rank by harness; nest `Harness → Model → Reasoning`.
- Give `byTask` session children.
- Select the latest quota snapshot per source and host.
- **Unavailable is not zero.** A record that does not report cached input tokens
  is excluded from the cache-efficiency denominator rather than counted as zero.
  A record with no reasoning level groups under an explicit "not reported"
  bucket, never under `none`. Totals that mix reporting and non-reporting sources
  expose their coverage.

This rule is the single most important correctness constraint in the spec.
Without it, adding Claude Code silently drags cache efficiency down and invents a
reasoning bucket in the model rollups. It is cheap to build in now and expensive
to retrofit.

## Module boundaries

`apps/web/src/App.tsx` is currently 668 lines holding the shell, four views, and
every presentational component. It is split:

```
apps/web/src/
  main.tsx
  app.tsx                  shell, nav, filter chips, view switching — nothing else
  api.ts
  theme/tokens.css         design tokens; the only place raw color literals live
  theme/palette.ts         validated series and status colors, exported by role
  components/              Panel, Zone, HeroFigure, StatStrip, RankList,
                           StackedBar, Meter, Chip, Accordion, TableView
  views/overview.tsx
  views/breakdown.tsx
  views/history.tsx
  views/settings/          sources.tsx, rates.tsx, hosts.tsx, data.tsx
  model/usage-groups.ts    existing grouping helpers
  model/format.ts          money, number, compact, duration, coverage formatters
```

Each component takes data and renders it; none fetches. Views compose components
and own their local control state. `theme/palette.ts` is the single source of
series color, so a future palette change is one edit and one validator run.

The collection seam follows the source plan: a new `packages/usage-sources`
exposing `listSources()` and `refreshSources(sourceIds?)`. Format discovery,
filesystem traversal, parsing, checkpoints, and capability mapping stay behind
that interface. Clients never receive adapter implementations or provider-native
configuration shapes.

## Slices

Each slice ends green and reviewable. No UI is built twice — the quota contract
lands before the cockpit consumes it.

**Slice 0 — Freeze current behavior.** Sanitized Codex fixtures for discovery,
cumulative-token deltas, stable IDs, task-name lookup, quota extraction, and
unchanged-file checkpoints. A ledger test proving import idempotency.
_Accepts:_ current typecheck and tests stay green; Codex behavior is refactorable
without tests reaching into parser internals; fixtures contain no prompts,
responses, paths, usernames, or credentials.

**Slice 1 — Visual foundation.** Design tokens, validated palette, app shell,
topbar with filter chips, Settings shell with Rates moved in, density pass,
removal of the hero and notice banner. Built against the current data model.
_Accepts:_ every raw color literal lives in `tokens.css` or `palette.ts`; the
palette validator runs in `vp run check` and passes; no contract file changes.

**Slice 2 — Canonical identities.** `usageSourceId` and `harnessId` in the
contract; optional metrics; compatibility decoder; ledger migration; harness rank
dimension and task→session children in analysis; `CONTEXT.md` vocabulary update.
_Accepts:_ existing Codex ledgers open without data loss; analysis can filter
`harnessId` and `provider` independently; missing optional metrics render as
unavailable, not zero; pricing still keys only on provider and model.

**Slice 3 — Quota snapshots.** Contract, persistence, analysis selection; the
current Codex importer emits snapshots.
_Accepts:_ records no longer carry `rateLimits`; a source with no quota
capability yields no snapshot rather than an empty one; quota data does not enter
cost calculation.

**Slice 4 — Overview cockpit.** Headline, trend with measure toggle, stat strip,
three driver panels, context rail.
_Accepts:_ full picture fits above the fold at 1440×900; no dual-axis plot
exists; refetch holds the previous render; every chart's container includes its
axis band.

**Slice 5 — Breakdown and History.** Chip group-by, three-level nesting, table
view, harness column in History.
_Accepts:_ each level totals to its parent; child bars scale to their parent;
table view presents every value without color encoding.

**Slice 6 — The usage-sources seam.** `packages/usage-sources` with contracts,
registry, a fake adapter, and the Codex adapter; registry injected into the
server; `refresh-sources` action; Settings → Sources.
_Accepts:_ the fake and Codex adapters pass the same tests through
`refreshSources`; no Codex-specific branching outside compatibility aliases and
adapter registration; one source's failure does not hide another's success.

**Slice 7 — Source ownership and reconciliation.** Ledger ownership columns,
atomic snapshot and delta reconciliation, Codex checkpoint migration.
_Accepts:_ deleting a fixture session removes its records on the next
authoritative scan; rewriting a fixture changes records without duplicates; a
parser failure leaves records and checkpoint unchanged; two sources may share a
native session ID without collision; `clear-records` clears records, ownership,
snapshots, and checkpoints consistently.

**Slice 8 — Claude Code adapter.** Format research, sanitized fixtures covering
two sessions, model changes, missing optional metrics, and rewritten history;
discovery, parsing, stable IDs, checkpointing, capability reporting.
_Accepts:_ Codex and Claude Code import through the same interface; no new action
variant or analysis branch was required; the combined dashboard separates
harness, provider, and model correctly; the adapter stays `experimental` until a
live Windows smoke test is recorded.

**Slice 9 — Conformance kit.** Fixture builders, redaction checks, clock and
filesystem injection, standard behavioral tests, adapter metadata files.
_Accepts:_ a new adapter is testable without a live installation or network;
fixture validation rejects likely secrets and raw conversational content;
verification level is visible in catalog responses and Settings.

**Slice 10 — Release hardening.** Format, lint, typecheck, tests, full build,
extension packaging, Windows install smoke, migration from the latest released
VSIX with a copied ledger, README and architecture doc updates, CHANGELOG.
_Accepts:_ existing Codex users retain history, pricing, settings, and
keybindings; the packaged extension contains all registered adapters and no raw
fixtures; rollback preserves the user's ledger.

## Testing strategy

Tests cross the same interfaces as production callers.

- **Contract:** compatibility decoding of pre-migration payloads, strict
  transport parsing, canonical invariants.
- **Usage-source:** fake filesystem and clock through the shared conformance kit.
- **Ledger:** atomic reconciliation and source ownership against temporary SQLite
  databases.
- **Analysis:** mixed harness, provider, and model records; unavailable metrics
  excluded rather than zeroed; cache efficiency computed only over reporting
  records.
- **Server:** generic refresh, catalog, partial failure, origin checks, bounded
  bodies.
- **Client:** optional metrics render as "not reported"; quota windows with no
  `usedPercent` render without a meter; driver panels cap and link correctly;
  refetch does not unmount the previous render.
- **Palette:** an in-repo guard test runs as part of `vp run check` against the
  declared surface. It enforces **two** of the external validator's five checks —
  the lightness band and contrast — plus a golden pin on the exact hex values.
  It does **not** re-derive CVD separation, the normal-vision ΔE floor, or the
  chroma floor; porting colour-blindness simulation matrices in-repo was rejected
  because a subtly wrong constant yields a check that is green and wrong, which is
  worse than no check. The golden pin is what protects those three: any change to
  a palette value fails a test that names the external validator, making the
  change deliberate and routing the engineer back to the tool that can re-check it.

Parser-internal tests are retired once equivalent behavior is covered through the
adapter interface. Pure normalization-function tests are kept only where their
edge cases would be obscured through fixtures.

## Compatibility and migration

1. A versioned compatibility decoder handles existing JSON payloads before the
   canonical schema tightens.
2. Existing `source: "codex-local"` records map to `usageSourceId: "codex-local"`
   and `harnessId: "codex"`.
3. The existing SQLite file and configured prices are preserved.
4. Codex import state converts to the new checkpoint shape transactionally.
5. `import-codex` survives one release as a deprecated alias.
6. The existing VS Code command identifier survives one release as a hidden alias
   so user keybindings do not break.
7. Compatibility decoding is not removed until at least one released version has
   migrated existing ledgers successfully.

## Completion gate

- Codex and Claude Code use the same usage-source interface.
- No Codex-specific branch remains in the normal server, ledger, analysis,
  browser, or extension flow.
- Harness and provider are independently queryable.
- Snapshot deletion and failed-import rollback are proven.
- Optional capabilities never require fabricated zeros.
- A fixture-only adapter can pass conformance and be labeled experimental.
- Adding a third adapter changes only adapter code, registration metadata,
  fixtures, documentation, and default pricing.
- The palette validator passes in CI against the declared dark surface.

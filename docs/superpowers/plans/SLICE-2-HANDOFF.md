# Handoff — Slices 0–2 complete, resume at Task 15

Date: 2026-07-25
Branch: `refactor/portable-usage-host`
Plan: `docs/superpowers/plans/2026-07-24-dashboard-redesign-slices-0-5.md`
Spec: `docs/superpowers/specs/2026-07-24-dashboard-redesign-and-multi-harness-design.md`

## State

Tasks 1–14 done. **Resume at Task 15** (quota snapshot contract).

Tests went 21 → **81**. `tsc`, `oxlint`, `oxfmt`, and `bun run build:web` are all clean.

Verified against the real ledger (~6,900 records, $8,947 API-equivalent): reads correctly, totals unchanged across every contract change.

## How this was run

Each task: a fresh implementer subagent, then a spec-compliance reviewer, then a code-quality reviewer, each verifying independently rather than trusting the previous report. Reviewers were asked to **mutation-test** — break the code, confirm something fails. That found a real defect on nearly every task. Recommend continuing that pattern.

Commits are done by the user, not by agents — the repo signs commits with an SSH key requiring a passphrase, which a non-interactive shell cannot supply. Agents must not `git add` or `git commit`.

## Constraints learned the hard way

- **No `git stash`, ever.** An agent used it to take a measurement and corrupted the index: line endings flipped on four files and `App.tsx` regained its capital A while the disk had `app.tsx`. With `core.ignorecase=true` that passes tsc, lint, tests, and the build on Windows but breaks any case-sensitive checkout. Repaired by `git rm --cached` + re-add.
- **`git diff` is not a safety net for untracked files.** Mutation-testing a never-committed file and "restoring" it proves nothing. Use content hashes instead.
- **Nothing outside the repo.** Two agents reached into `%LOCALAPPDATA%` or a scratchpad. One deleted a stale `server.json`, orphaning a running server process.
- **The user's ledger is live data.** Read-only HTTP GETs only. It grew from 6,643 to 6,900 records mid-session — they use Codex while we work.

## Environment

- `vp run dev` / `bun run dev` **works now**. It was broken: `apps/server/package.json` ran the server under Bun, which does not implement `node:sqlite`. Now `node --experimental-strip-types src/cli.ts start`.
- `npx tsc` resolves to an unrelated package. Use `./node_modules/.bin/tsc --noEmit`.
- **`.tsx` files cannot be unit-tested.** The runner (`node --experimental-strip-types`) strips types but cannot parse JSX, and there is no jsdom. Adding a testing library was deliberately excluded. For every React component in Tasks 19–28, **code review is the only gate** — weight it accordingly, and put testable logic in `apps/web/src/model/*.ts` where it CAN be tested (as `format.ts`, `source-host.ts`, and `rollup-scale.ts` already do).

## Design decisions worth not re-litigating

- **Unavailable is not zero.** A source that does not report a metric is excluded from ratios, never counted as zero. `cacheEfficiency` divides by `cacheReportingInputTokens`, not total input. But **cost is different**: `calculateCost` keeps `?? 0` because a total cannot say "not measured", and over-stating is the safer direction. That asymmetry is documented above `calculateCost` — read it before touching either.
- **Visibly wrong beats plausibly wrong.** `harnessForSource` returns `"unknown"` for an unregistered source rather than deriving a tidy name from the id. Presentation is handled in Task 24's `model/harness.ts`, which renders it as "Unknown harness".
- **The palette guard covers 2 of the external validator's 5 checks** (lightness band, contrast) plus a golden pin on the exact hex values. It does NOT re-derive CVD separation. Porting colour-blindness matrices in-repo was rejected: a subtly wrong constant yields a check that is green and wrong.
- **`tokens.css` and `palette.ts` are twinned** for 13 colours, guarded by `apps/web/test/token-agreement.test.ts`. Adding a fourteenth means adding a row to that table.

## Plan amendments made during execution

The plan file has been edited in place; these are already reflected there.

- Tasks 9 and 10 are **coupled** — a boxed warning precedes Task 9. Task 9 alone makes every stored row unparseable.
- `TOKEN_MIX` reshaped from array to keyed record + `TOKEN_MIX_ORDER`, removing a `.find(…)!` from Task 20's consumer.
- `formatCoverage` takes `{ records, priced }` named fields; transposed positional numbers produced plausible-but-wrong text under the hero figure.
- `Panel` gained a `meta` prop; Task 24 was calling `toLocaleString()` directly, bypassing `format.ts`.
- Task 7 gained the visually-hidden per-view `<h1>` (there is no other `<h1>` after Task 8) and `model/source-host.ts`.
- Task 24 gained Step 0: `model/harness.ts` + tests.
- Task 23's `StatStrip` discloses cache coverage in **tokens**, not record count — the ratio is token-weighted, so a record count can mislead.
- `RankedUsage.harnessId` was removed as dead: a `byHarness` row's key IS the harness id.

## Open items for later slices

1. **`latestRateLimits: null`** in `usage-analysis` and **`plans: []`** in `apps/web/src/usage-groups.ts` are honest placeholders. **Tasks 15–18 finish them.** Both carry in-code comments.
2. **Task 17** replaces the `ParsedTurnRecord` rate-limit discard in `codex-importer.ts` with a real quota-snapshot conversion.
3. **`model: String(payload.model || "unknown")`** in `codex-importer.ts` still fabricates a model name when Codex reports none. Unlike `reasoningLevel`, `model` is required by the contract so absence is not representable. Worth deciding whether that needs a contract change.
4. **`/api/overview` recomputes everything per request** — every row Zod-parsed on every keystroke. Measured ~70–90ms decode plus analysis on 6,900 records. Fine today; will not stay fine as the ledger grows. Candidates: cache decoded records, push filtering into SQL, or drop Zod on the read path.
5. **Search has no debounce.** The fetch race is guarded by a request-generation ref in `app.tsx`, so results are correct, but a five-character query still issues 15 requests.
6. **`getHistory`/`getCatalog` refetch on every filter change** despite not depending on filters.

## Fixes made outside the plan

- **O(n²) in `group()`** — rebuilt its accumulator array per item. Measured 61.2ms → 0.22ms at 6,900 records in one bucket. Also fixed in the three identical instances in `apps/web/src/usage-groups.ts`.
- `vp run dev` (above).
- `.gitignore` gained `.superpowers/`.

## Mockups

Brainstorming mockups persist in `.superpowers/brainstorm/897-1784941648/content/`: `cockpit-final.html`, `other-views.html`, `visual-system.html`, `overview-layout.html`. They are content fragments — the companion server supplies the CSS frame, so `file://` renders them unstyled.

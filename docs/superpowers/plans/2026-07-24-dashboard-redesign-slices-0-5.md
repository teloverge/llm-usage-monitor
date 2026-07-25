# Dashboard Redesign (Slices 0–5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete cost-first dashboard redesign running on Codex, with the canonical usage-source/harness identities and normalized quota snapshots already in place.

**Architecture:** Six dependency-ordered slices. The visual foundation lands first because it touches no contract and therefore cannot be blocked. Contract identities and quota snapshots land next so the rebuilt views consume their final shapes once. The Overview cockpit and then Breakdown/History are rebuilt last. Records are stored as JSON payloads validated on read, so every contract change is paired with a compatibility decoder before the schema tightens.

**Tech Stack:** TypeScript 5.9, React 19, Vite 7, Recharts 3, Zod 4, `node:sqlite`, `node:test` via `node --experimental-strip-types`, oxfmt + oxlint, Bun as package manager with `vp` as the workflow entry point.

**Spec:** `docs/superpowers/specs/2026-07-24-dashboard-redesign-and-multi-harness-design.md`

**Out of scope for this plan:** Slices 6–10 (the `usage-sources` package and registry, ledger source ownership and reconciliation, the Claude Code adapter, the conformance kit, release hardening). Those get their own plan once this one lands. This plan leaves `CodexSessionProvider` in place and wired directly, exactly as it is today.

---

## Commands you will use

```bash
vp run test        # node --experimental-strip-types --test apps/*/test/*.test.ts packages/*/test/*.test.ts
vp run typecheck   # tsc --noEmit
vp run lint        # oxlint .
vp run format      # oxfmt . --write
vp run check       # format:check && lint && typecheck && test && build
```

To run a single test file: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

To run a single test by name, add `--test-name-pattern "part of the it() string"`.

**Commit signing:** this repository signs commits with an SSH key that requires a passphrase. If `git commit` appears to hang, it is waiting on a passphrase prompt that the terminal is not showing. Run commits interactively.

---

## File structure

### Created

| Path                                | Responsibility                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web/src/theme/tokens.css`     | Every design token. The only place raw color literals live in CSS.                      |
| `apps/web/src/theme/palette.ts`     | Series and status colors exported by role, plus the surface they are validated against. |
| `apps/web/src/theme/color-math.ts`  | sRGB→OKLab lightness and WCAG contrast. Used only by the guard test.                    |
| `apps/web/src/model/format.ts`      | money, tokens, compact, percent, coverage, and relative-time formatters.                |
| `apps/web/src/components/*.tsx`     | Presentational primitives. None of them fetch.                                          |
| `apps/web/src/views/overview.tsx`   | Overview composition.                                                                   |
| `apps/web/src/views/breakdown.tsx`  | Breakdown composition.                                                                  |
| `apps/web/src/views/history.tsx`    | History composition.                                                                    |
| `apps/web/src/views/settings/*.tsx` | Settings panels.                                                                        |
| `packages/contracts/src/legacy.ts`  | Compatibility decoder for pre-identity Usage Records.                                   |
| `apps/server/test/fixtures/codex/`  | Sanitized Codex session fixtures.                                                       |

### Modified

| Path                                   | Change                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `packages/contracts/src/index.ts`      | `usageSourceId`/`harnessId`, optional metrics, quota snapshot schema, filters, `OverviewView`. |
| `packages/usage-analysis/src/index.ts` | Harness ranking, task→session children, reporting-aware cache efficiency, quota selection.     |
| `packages/usage-ledger/src/index.ts`   | Decode on read, quota snapshot table.                                                          |
| `apps/server/src/codex-importer.ts`    | Emit identities; convert rate limits to quota snapshots.                                       |
| `apps/server/src/server.ts`            | Filter parsing, quota snapshots in overview.                                                   |
| `apps/web/src/App.tsx`                 | Reduced to the shell; renamed `app.tsx`.                                                       |
| `apps/web/src/styles.css`              | Rewritten against tokens.                                                                      |
| `apps/web/src/usage-groups.ts`         | Moved to `model/usage-groups.ts`, harness added.                                               |

### Deleted

| Path                   | Reason                                             |
| ---------------------- | -------------------------------------------------- |
| `apps/web/src/App.tsx` | Split into `app.tsx`, `views/`, and `components/`. |

---

# Slice 0 — Freeze current behavior

Establishes a refactoring baseline. No production code changes.

### Task 1: Sanitized Codex fixture and parser characterization test

**Files:**

- Create: `apps/server/test/fixtures/codex/sessions/2026/07/rollout-2026-07-20T09-00-00-11111111-2222-3333-4444-555555555555.jsonl`
- Create: `apps/server/test/fixtures/codex/session_index.jsonl`
- Create: `apps/server/test/fixtures/codex/README.md`
- Test: `apps/server/test/codex-characterization.test.ts`

- [ ] **Step 1: Write the fixture session file**

Create `apps/server/test/fixtures/codex/sessions/2026/07/rollout-2026-07-20T09-00-00-11111111-2222-3333-4444-555555555555.jsonl`. Each line is one JSON object. Note that `total_token_usage` is cumulative across turns — the parser emits per-turn deltas.

```jsonl
{"type":"session_meta","timestamp":"2026-07-20T09:00:00.000Z","payload":{"id":"11111111-2222-3333-4444-555555555555","model_provider":"openai","timestamp":"2026-07-20T09:00:00.000Z"}}
{"type":"turn_context","timestamp":"2026-07-20T09:00:05.000Z","payload":{"turn_id":"turn-1","model":"gpt-5-codex","effort":"high"}}
{"type":"event_msg","timestamp":"2026-07-20T09:00:30.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":400,"output_tokens":200,"reasoning_output_tokens":100,"total_tokens":1200},"model_context_window":400000},"rate_limits":{"limit_id":"plus-1","limit_name":"Plus","plan_type":"plus","rate_limit_reached_type":"none","primary":{"used_percent":41.5,"window_minutes":300,"resets_at":1784950000},"secondary":{"used_percent":78.25,"window_minutes":10080,"resets_at":1785300000}}}}
{"type":"turn_context","timestamp":"2026-07-20T09:05:00.000Z","payload":{"turn_id":"turn-2","model":"gpt-5-codex","effort":"xhigh","mode":"fast"}}
{"type":"event_msg","timestamp":"2026-07-20T09:05:40.000Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":3000,"cached_input_tokens":1500,"output_tokens":600,"reasoning_output_tokens":250,"total_tokens":3600},"model_context_window":400000}}}
```

- [ ] **Step 2: Write the task-name index and provenance note**

`apps/server/test/fixtures/codex/session_index.jsonl`:

```jsonl
{
  "id": "11111111-2222-3333-4444-555555555555",
  "thread_name": "portable-usage-host"
}
```

`apps/server/test/fixtures/codex/README.md`:

```markdown
# Codex fixtures

Hand-authored, not captured from a real machine. Session and turn identifiers are
synthetic. These files contain no prompts, responses, reasoning text, tool calls,
file contents, repository paths, usernames, or credentials — only the event
envelopes and token counters the importer reads.

Shape mirrors Codex rollout JSONL as of 2026-07. Update this note if the shape is
re-derived from a newer version.
```

- [ ] **Step 3: Write the failing characterization test**

Create `apps/server/test/codex-characterization.test.ts`:

```ts
import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSession } from "../src/codex-importer.ts";

const fixtures = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const session = join(
  fixtures,
  "sessions/2026/07",
  "rollout-2026-07-20T09-00-00-11111111-2222-3333-4444-555555555555.jsonl",
);
const taskNames = new Map([["11111111-2222-3333-4444-555555555555", "portable-usage-host"]]);

describe("Codex parser characterization", () => {
  it("emits one record per turn with cumulative counters converted to deltas", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => [record.inputTokens, record.cachedInputTokens, record.outputTokens]),
      [
        [1000, 400, 200],
        [2000, 1100, 400],
      ],
    );
  });

  it("derives stable ids from session and turn", async () => {
    const records = await parseSession(session, taskNames);
    assert.deepEqual(
      records.map((record) => record.id),
      [
        "codex:11111111-2222-3333-4444-555555555555:turn-1",
        "codex:11111111-2222-3333-4444-555555555555:turn-2",
      ],
    );
  });

  it("resolves the task name from the session index", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.taskName, "portable-usage-host");
  });

  it("carries reasoning level and mode flags per turn", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.reasoningLevel, "high");
    assert.deepEqual(records[0]?.modeFlags, { ultra: false, fast: false });
    assert.equal(records[1]?.reasoningLevel, "xhigh");
    assert.deepEqual(records[1]?.modeFlags, { ultra: false, fast: true });
  });

  it("applies the latest rate-limit snapshot to subsequent turns", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.rateLimits?.planType, "plus");
    assert.equal(records[0]?.rateLimits?.primary?.usedPercent, 41.5);
    assert.equal(records[1]?.rateLimits?.secondary?.usedPercent, 78.25);
  });
});
```

- [ ] **Step 4: Run the test**

Run: `node --experimental-strip-types --test apps/server/test/codex-characterization.test.ts`

Expected: PASS, 5 tests. This is characterization — it documents behavior that already exists. If any assertion fails, the fixture is wrong, not the parser. Fix the fixture.

- [ ] **Step 5: Commit**

```bash
git add apps/server/test/fixtures/codex apps/server/test/codex-characterization.test.ts
git commit -m "test: characterize Codex parser against sanitized fixtures"
```

---

### Task 2: Ledger import idempotency characterization

**Files:**

- Test: `packages/usage-ledger/test/ledger.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-ledger/test/ledger.test.ts`. Add this import at the top of the file if it is not already present: `import type { UsageRecord } from "@llm-usage-monitor/contracts";`

```ts
describe("Ledger import idempotency", () => {
  const sample = (id: string): UsageRecord => ({
    id,
    sourceHostId: "host:a",
    timestamp: "2026-07-20T09:00:00.000Z",
    taskName: "portable-usage-host",
    provider: "openai",
    model: "gpt-5-codex",
    reasoningLevel: "high",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
    reasoningOutputTokens: 100,
    totalTokens: 1200,
    lastTokenUsage: null,
    modelContextWindowTokens: 400_000,
    rateLimits: null,
    source: "codex-local",
  });

  it("re-importing the same records does not duplicate them", () => {
    const ledger = new UsageLedger(":memory:");
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], { v: 1 });
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], { v: 2 });
    assert.equal(ledger.records().length, 2);
    assert.deepEqual(ledger.importState("codex-local"), { v: 2 });
    ledger.close();
  });

  it("records absent from a later import are retained, not removed", () => {
    const ledger = new UsageLedger(":memory:");
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], {});
    ledger.commitProviderImport("codex-local", [sample("a")], {});
    assert.equal(ledger.records().length, 2);
    ledger.close();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`

Expected: PASS. The second test documents today's behavior — stale records survive because there is no reconciliation yet. Slice 7 (next plan) changes this deliberately; this test is the record of what changed.

- [ ] **Step 3: Commit**

```bash
git add packages/usage-ledger/test/ledger.test.ts
git commit -m "test: characterize ledger import idempotency and stale-record retention"
```

---

# Slice 1 — Visual foundation

No contract changes. Builds against the current data model.

### Task 3: Color math and the palette guard test

The palette validator lives in an external skill, so the gate is reimplemented in-repo as a test. This is what makes a future color edit fail CI.

**Files:**

- Create: `apps/web/src/theme/color-math.ts`
- Create: `apps/web/src/theme/palette.ts`
- Test: `apps/web/test/palette.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/palette.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, oklabLightness } from "../src/theme/color-math.ts";
import { CHART_SURFACE, SERIES, STATUS, UI_ACCENT } from "../src/theme/palette.ts";

describe("Chart palette gates", () => {
  it("keeps every series color inside the dark-surface lightness band", () => {
    for (const hex of Object.values(SERIES)) {
      const lightness = oklabLightness(hex);
      assert.ok(
        lightness >= 0.48 && lightness <= 0.67,
        `${hex} lightness ${lightness.toFixed(3)} is outside 0.48-0.67`,
      );
    }
  });

  it("keeps every series color at or above 3:1 against the chart surface", () => {
    for (const hex of Object.values(SERIES)) {
      const ratio = contrastRatio(hex, CHART_SURFACE);
      assert.ok(ratio >= 3, `${hex} contrast ${ratio.toFixed(2)} is below 3:1`);
    }
  });

  it("keeps every status color at or above 3:1 against the chart surface", () => {
    for (const hex of Object.values(STATUS)) {
      const ratio = contrastRatio(hex, CHART_SURFACE);
      assert.ok(ratio >= 3, `${hex} contrast ${ratio.toFixed(2)} is below 3:1`);
    }
  });

  it("excludes the UI accent from the series set because it fails the band", () => {
    assert.ok(oklabLightness(UI_ACCENT) > 0.67);
    assert.ok(!Object.values(SERIES).includes(UI_ACCENT as never));
  });
});
```

Status colors are a fixed palette, not a categorical set, so the lightness band does not apply to them — only contrast does. `#fab219` measures L 0.811 and is correct as a status color.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/palette.test.ts`

Expected: FAIL — `Cannot find module '../src/theme/color-math.ts'`

- [ ] **Step 3: Write the color math**

Create `apps/web/src/theme/color-math.ts`:

```ts
function channels(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Perceptual lightness in OKLab, 0 (black) to 1 (white). */
export function oklabLightness(hex: string): number {
  const [red, green, blue] = channels(hex).map(linearize) as [number, number, number];
  const long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short;
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = channels(hex).map(linearize) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (left, right) => right - left,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Step 4: Write the palette**

Create `apps/web/src/theme/palette.ts`:

```ts
/**
 * Validated against the chart surface below. Changing any value here requires
 * re-running apps/web/test/palette.test.ts, which enforces the same gates the
 * external palette validator applies.
 */
export const CHART_SURFACE = "#151e1a";
export const PAGE_SURFACE = "#0d1411";

/** UI only — buttons, focus, brand, hero figure. Never a chart fill: L 0.739 fails the band. */
export const UI_ACCENT = "#16c79a";

/** Categorical slots in fixed order. Assign by entity, never by rank. */
export const SERIES = {
  teal: "#0fae83",
  blue: "#3987e5",
  orange: "#d95926",
} as const;

/** Fixed status palette. Never reused as a series color; always paired with a glyph and label. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

export const CHART_INK = {
  grid: "#22302a",
  axis: "#384a41",
  muted: "#95a59c",
  track: "#24342c",
} as const;

/** Token-mix segment identity, keyed for lookup without assertions. */
export const TOKEN_MIX = {
  fresh: { label: "Fresh input", color: SERIES.blue },
  cached: { label: "Cached", color: SERIES.teal },
  output: { label: "Output", color: SERIES.orange },
} as const;

/** Stacking order for the token-mix bar. Explicit so it never depends on key order. */
export const TOKEN_MIX_ORDER = ["fresh", "cached", "output"] as const;
```

`TOKEN_MIX` is keyed rather than an array so consumers index it directly and get a compile error if a key drifts. An array shape would force `TOKEN_MIX.find(…)!` in the consumer — a non-null assertion with no compile-time link between the segment key and the palette.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/palette.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/theme apps/web/test/palette.test.ts
git commit -m "feat: add validated chart palette with in-repo gate test"
```

---

### Task 4: Quota threshold and formatter module

**Files:**

- Create: `apps/web/src/model/format.ts`
- Test: `apps/web/test/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/format.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCoverage,
  formatMoney,
  formatPercent,
  formatTokens,
  quotaStatus,
} from "../src/model/format.ts";

describe("Formatters", () => {
  it("formats money to cents for display totals", () => {
    assert.equal(formatMoney(142.3), "$142.30");
    assert.equal(formatMoney(0), "$0.00");
  });

  it("formats token counts compactly from a thousand upward", () => {
    assert.equal(formatTokens(645_000), "645K");
    assert.equal(formatTokens(1_240_000), "1.2M");
    assert.equal(formatTokens(812), "812");
    // Pins the exact transition. Without these two, `< 1_000` and `<= 1_000` are
    // indistinguishable to the suite and a refactor can flip the boundary silently.
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(1_000), "1K");
  });

  it("formats a ratio as a percent with one decimal", () => {
    assert.equal(formatPercent(0.682), "68.2%");
  });

  it("reports priced coverage only when some records are unpriced", () => {
    assert.equal(formatCoverage({ records: 4900, priced: 4900 }), "4,900 records priced");
    assert.equal(formatCoverage({ records: 4900, priced: 4812 }), "4,812 of 4,900 records priced");
  });

  it("describes an empty period in prose when there are no records", () => {
    assert.equal(formatCoverage({ records: 0, priced: 0 }), "No records in this period");
  });
});

describe("Quota thresholds", () => {
  it("is good below 75 percent", () => {
    assert.equal(quotaStatus(0), "good");
    assert.equal(quotaStatus(74.9), "good");
  });

  it("is warning from 75 up to but not including 90", () => {
    assert.equal(quotaStatus(75), "warning");
    assert.equal(quotaStatus(89.9), "warning");
  });

  it("is critical at 90 and above", () => {
    assert.equal(quotaStatus(90), "critical");
    assert.equal(quotaStatus(100), "critical");
  });

  it("is unreported when the source did not supply a percentage", () => {
    assert.equal(quotaStatus(undefined), "unreported");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/format.test.ts`

Expected: FAIL — `Cannot find module '../src/model/format.ts'`

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/model/format.ts`:

```ts
/**
 * Locale is pinned rather than taken from the runtime. This dashboard reports
 * US-dollar API rates under English copy, and `currency: "USD"` is already fixed —
 * letting the OS locale drive grouping and symbol placement while the currency
 * stays American produces inconsistent output like "142,30 $" beside English
 * labels. Pinning also keeps these assertions deterministic on contributor and CI
 * machines whose default locale is not en-US.
 */
const LOCALE = "en-US";

const money = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const plain = new Intl.NumberFormat(LOCALE);
const compact = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatTokens(value: number): string {
  return value < 1_000 ? plain.format(value) : compact.format(value);
}

export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * Named fields rather than two positional numbers: a transposed positional call
 * type-checks and yields plausible-but-wrong text ("4,900 of 4,812 records priced")
 * directly under the hero figure, where a reader would trust it.
 *
 * Always returns a renderable string, never null — the sole consumer splices it
 * into a sentence with no conditional, so the empty case belongs here rather than
 * duplicated as a null-guard at every call site.
 */
export function formatCoverage({ records, priced }: { records: number; priced: number }): string {
  if (records === 0) return "No records in this period";
  return priced === records
    ? `${plain.format(records)} records priced`
    : `${plain.format(priced)} of ${plain.format(records)} records priced`;
}

export type QuotaStatus = "good" | "warning" | "critical" | "unreported";

/**
 * 75 and 90 are the product-defined thresholds from the design spec, not tunable
 * knobs. Do not extract them into configuration without changing the spec.
 */
export function quotaStatus(usedPercent: number | undefined): QuotaStatus {
  if (usedPercent === undefined) return "unreported";
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  return "good";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/format.test.ts`

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/model/format.ts apps/web/test/format.test.ts
git commit -m "feat: add display formatters and quota threshold rules"
```

---

### Task 5: Design tokens

**Files:**

- Create: `apps/web/src/theme/tokens.css`
- Modify: `apps/web/src/styles.css` (import tokens, drop hardcoded colors)

- [ ] **Step 1: Write the token file**

Create `apps/web/src/theme/tokens.css`:

```css
:root {
  color-scheme: dark;

  --page: #0d1411;
  --panel: #151e1a;
  --raised: #1b2621;
  --field: #0f1713;
  --line: #2b3831;
  --grid: #22302a;
  --axis: #384a41;
  --track: #24342c;

  --ink: #e6eee9;
  --ink-strong: #ffffff;
  --muted: #95a59c;

  --accent: #16c79a;
  --accent-ink: #07110d;

  --series-1: #0fae83;
  --series-2: #3987e5;
  --series-3: #d95926;

  --status-good: #0ca30c;
  --status-warning: #fab219;
  --status-critical: #d03b3b;

  --size-hero: 44px;
  --size-stat: 20px;
  --size-body: 12.5px;
  --size-meta: 11px;
  --size-zone: 10px;

  --pad-panel: 11px 12px;
  --radius-panel: 9px;
  --radius-control: 6px;
  --gap: 11px;

  --rail: 248px;

  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-size: var(--size-body);
  color: var(--ink);
  background: var(--page);
  font-synthesis: none;
}
```

- [ ] **Step 2: Import tokens from the stylesheet**

Add as the first line of `apps/web/src/styles.css`:

```css
@import "./theme/tokens.css";
```

Then delete the existing `:root { ... }` block at the top of `styles.css` (lines 1–11 in the current file), because `tokens.css` now owns it.

- [ ] **Step 2b: Migrate the renamed custom property**

The old `:root` declared `--border`; `tokens.css` calls it `--line` and does not define `--border` at all. CSS custom properties fail **silently** — an unset value produces no error and the build still succeeds, so this would ship a visibly broken page with a green test suite.

`styles.css` references `var(--border)` in **11** places. Rewrite every one to `var(--line)`:

```bash
# verify the count first, then confirm zero remain afterward
grep -c "var(--border)" apps/web/src/styles.css
```

Then confirm no reference is left dangling — every property `styles.css` uses must exist in `tokens.css`:

```bash
grep -o "var(--[a-z-]*)" apps/web/src/styles.css | sort -u
grep -o "^\s*--[a-z0-9-]*" apps/web/src/theme/tokens.css | tr -d ' ' | sort -u
```

The first list must be a subset of the second. After this task the referenced set is exactly `--accent`, `--line`, `--muted`, `--panel`, `--raised`.

- [ ] **Step 3: Guard the tokens.css / palette.ts twin values**

`tokens.css` and `palette.ts` now encode the same 13 colours, and nothing enforces agreement. `palette.ts` is self-protecting — it is thick with "re-run the validator" warnings. `tokens.css` reads like an ordinary tokens file that invites a casual "make panels a bit darker" edit, and that edit would silently desynchronise the chart marks from the chrome.

This is not hypothetical by Slice 4: Task 21's quota meter colours its text label with `var(--status-warning)` and its fill bar with `STATUS.warning` from `palette.ts`, side by side in one widget. Drift renders as two different oranges.

Create `apps/web/test/token-agreement.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHART_INK,
  CHART_SURFACE,
  PAGE_SURFACE,
  SERIES,
  STATUS,
  UI_ACCENT,
} from "../src/theme/palette.ts";

const source = readFileSync(
  fileURLToPath(new URL("../src/theme/tokens.css", import.meta.url)),
  "utf8",
);

/**
 * Only tokens that have a TypeScript twin. The other 16 (sizes, radii, gap, rail,
 * and UI-only colours with no chart-side counterpart) are deliberately excluded —
 * there is nothing to compare them against, and layout drift fails loudly on screen
 * rather than quietly shifting a colour.
 *
 * Twinning a new token means adding a row here. That is the point: the table is the
 * registry of what must stay in sync.
 */
const TWINNED: Array<[string, string]> = [
  ["--page", PAGE_SURFACE],
  ["--panel", CHART_SURFACE],
  ["--accent", UI_ACCENT],
  ["--series-1", SERIES.teal],
  ["--series-2", SERIES.blue],
  ["--series-3", SERIES.orange],
  ["--status-good", STATUS.good],
  ["--status-warning", STATUS.warning],
  ["--status-critical", STATUS.critical],
  ["--grid", CHART_INK.grid],
  ["--axis", CHART_INK.axis],
  ["--muted", CHART_INK.muted],
  ["--track", CHART_INK.track],
];

function declaredValue(token: string): string {
  // Anchored to line start so `--panel` cannot match inside `--pad-panel`.
  const match = source.match(new RegExp(`^\\s*${token}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "m"));
  assert.ok(match, `${token} is not declared in tokens.css`);
  return match[1]!.toLowerCase();
}

describe("Token and palette agreement", () => {
  for (const [token, expected] of TWINNED) {
    it(`${token} matches its palette.ts twin`, () => {
      assert.equal(declaredValue(token), expected.toLowerCase());
    });
  }
});
```

Verify the guard is load-bearing: temporarily change one value in `tokens.css`, confirm the suite fails naming that token, then restore.

Rejected alternatives: generating `tokens.css` from `palette.ts` (16 of 29 tokens have no TS counterpart, so it adds a build step for a 13-value problem), and CSS-in-JS injection (trades a static stylesheet for runtime cost and contradicts `tokens.css` being the single home for CSS colour literals).

- [ ] **Step 4: Verify the build still runs**

Run: `vp run build:web`

Expected: build succeeds, `apps/web/dist/assets/` is regenerated.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/theme/tokens.css apps/web/src/styles.css apps/web/test/token-agreement.test.ts
git commit -m "feat: extract design tokens and guard their agreement with the palette"
```

---

### Task 6: Shell primitives

**Files:**

- Create: `apps/web/src/components/panel.tsx`
- Create: `apps/web/src/components/chip.tsx`

- [ ] **Step 1: Write the panel and zone primitives**

Create `apps/web/src/components/panel.tsx`:

```tsx
import type { ReactNode } from "react";

export function Panel({
  label,
  meta,
  children,
  className = "",
}: {
  label?: string;
  /**
   * Optional trailing metric, e.g. "1.2M" in "Token mix · 1.2M". Separate from
   * `label` so the value stays markable — callers cannot smuggle a pre-formatted
   * number into the title and bypass `model/format.ts`, and the metric can be
   * styled or hidden independently of the heading text.
   */
  meta?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {label && (
        <h3 className="panel-label">
          {label}
          {meta && <span className="panel-meta"> · {meta}</span>}
        </h3>
      )}
      {children}
    </section>
  );
}

export function Zone({ children }: { children: ReactNode }) {
  return <h2 className="zone">{children}</h2>;
}
```

- [ ] **Step 2: Write the filter chip**

Create `apps/web/src/components/chip.tsx`:

```tsx
export function SelectChip<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="chip">
      <span className="chip-key">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SearchChip({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="chip chip-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `vp run typecheck`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components
git commit -m "feat: add panel, zone, and filter chip primitives"
```

---

### Task 7: App shell with topbar chips

**Files:**

- Create: `apps/web/src/app.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 0: Give the Source Host label rule a testable home**

The topbar's Host chip must not re-derive this inline. `legacy-views.tsx` has `safeSourceHostLabel`, which exists because some machines report a MAC address as their hostname — showing that raw in a dropdown is both ugly and a mild information leak. `legacy-views.tsx` is deleted in Task 28, so the rule needs a permanent home, and unlike the components it is pure logic that CAN be tested.

Create `apps/web/src/model/source-host.ts`:

```ts
import type { SourceHost } from "@llm-usage-monitor/contracts";

const MAC_ADDRESS = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const BARE_HEX_ID = /^[0-9a-f]{12}$/i;

/**
 * Hostname is the preferred label, but some machines report a MAC address or a
 * bare hex identifier as their hostname. Those are meaningless to a reader and
 * mildly identifying, so they fall back to a positional label.
 */
export function sourceHostLabel(host: SourceHost, index: number): string {
  const name = host.hostname?.trim();
  return name && !MAC_ADDRESS.test(name) && !BARE_HEX_ID.test(name)
    ? name
    : `Source Host ${index + 1}`;
}
```

Create `apps/web/test/source-host.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceHost } from "@llm-usage-monitor/contracts";
import { sourceHostLabel } from "../src/model/source-host.ts";

const host = (hostname: string | null): SourceHost => ({
  id: "host:a",
  hostname,
  platform: "win32",
  architecture: "x64",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-07-20T09:00:00.000Z",
});

describe("Source Host labels", () => {
  it("prefers a real hostname", () => {
    assert.equal(sourceHostLabel(host("workstation"), 0), "workstation");
  });

  it("falls back when the hostname is a colon-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("a1:b2:c3:d4:e5:f6"), 0), "Source Host 1");
  });

  it("falls back when the hostname is a hyphen-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("A1-B2-C3-D4-E5-F6"), 1), "Source Host 2");
  });

  it("falls back when the hostname is a bare 12-digit hex identifier", () => {
    assert.equal(sourceHostLabel(host("a1b2c3d4e5f6"), 2), "Source Host 3");
  });

  it("falls back when the hostname is missing or blank", () => {
    assert.equal(sourceHostLabel(host(null), 0), "Source Host 1");
    assert.equal(sourceHostLabel(host("   "), 0), "Source Host 1");
  });

  it("keeps a hostname that merely contains hex characters", () => {
    assert.equal(sourceHostLabel(host("dead-beef-laptop"), 0), "dead-beef-laptop");
  });
});
```

- [ ] **Step 1: Write the shell**

Create `apps/web/src/app.tsx`. This holds the shell only — the four view components are still imported from `App.tsx` until Slices 4 and 5 replace them.

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ModelPrice,
  OverviewView,
  SourceHost,
  UsageFilters,
  UsageHistoryRecord,
} from "@llm-usage-monitor/contracts";
import { SearchChip, SelectChip } from "./components/chip.tsx";
import { sourceHostLabel } from "./model/source-host.ts";
import { executeAction, getCatalog, getHistory, getOverview } from "./api.ts";
import logoUrl from "../../../assets/Teloverge-lum-logo.svg?url";

export type View = "overview" | "breakdown" | "history";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "breakdown", label: "Breakdown" },
  { value: "history", label: "History" },
];

const TIMEFRAMES = [
  { value: "today", label: "Today" },
  { value: "last24", label: "Last 24 hours" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "all", label: "All retained" },
] as const;

export function App() {
  const [view, setView] = useState<View>("overview");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filters, setFilters] = useState<UsageFilters>({ timeframe: "30" });
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [history, setHistory] = useState<UsageHistoryRecord[]>([]);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [sourceHosts, setSourceHosts] = useState<SourceHost[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Guards against a stale response overwriting a newer one. The search chip fires
   * on every keystroke, so typing a five-character query launches five overlapping
   * refetches with no ordering guarantee — and switching Period from "all" (a full
   * history scan) to "today" (cheap) is exactly the shape where the slow response
   * lands last. Whichever finishes last would otherwise win, silently showing
   * results for a query the user has already moved past.
   *
   * A useEffect cleanup flag is not sufficient on its own: refresh() is also called
   * directly by the Refresh-sources button and after a price save, and those call
   * sites must participate in the same sequence.
   */
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setStale(true);
    try {
      setError("");
      const [nextOverview, nextHistory, catalog] = await Promise.all([
        getOverview(filters),
        getHistory(),
        getCatalog(),
      ]);
      if (id !== requestId.current) return;
      setOverview(nextOverview);
      setHistory(nextHistory);
      setPrices(catalog.prices);
      setSourceHosts(catalog.sourceHosts);
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (id === requestId.current) setStale(false);
    }
  }, [filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshSources = async () => {
    setBusy(true);
    try {
      await executeAction({ version: 1, type: "import-codex" });
      await refresh();
    } catch (reason) {
      // Without this the import failure is an unhandled rejection: refresh() never
      // runs, no error state is ever set, and the button quietly returns to normal
      // as though the import had succeeded.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const change = (key: keyof UsageFilters, value: string) =>
    setFilters({ ...filters, [key]: value || undefined });

  return (
    <>
      <link rel="icon" href={logoUrl} />
      <div className="app-shell">
        <header className="topbar">
          <img className="brand-mark" src={logoUrl} alt="" />
          <strong className="brand-name">Usage Monitor</strong>
          <nav aria-label="Dashboard sections">
            {VIEWS.map((item) => {
              // Settings renders over the top of whichever view is selected, so while
              // it is open no nav item is current. Without this the nav would keep
              // highlighting Overview — visually and to assistive tech — while
              // Settings is on screen.
              const current = !settingsOpen && view === item.value;
              return (
                <button
                  key={item.value}
                  className={current ? "active" : ""}
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    setSettingsOpen(false);
                    setView(item.value);
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="chips">
            <SelectChip
              label="Period"
              value={filters.timeframe}
              options={TIMEFRAMES.map((item) => ({ ...item }))}
              onChange={(value) => change("timeframe", value)}
            />
            <SelectChip
              label="Host"
              value={filters.sourceHostId ?? ""}
              options={[
                { value: "", label: "All" },
                ...sourceHosts.map((host, index) => ({
                  value: host.id,
                  // Must go through sourceHostLabel, not host.hostname directly —
                  // some machines report a MAC address as their hostname.
                  label: sourceHostLabel(host, index),
                })),
              ]}
              onChange={(value) => change("sourceHostId", value)}
            />
            <SearchChip
              value={filters.query ?? ""}
              placeholder="Filter tasks"
              onChange={(value) => change("query", value)}
            />
            <button className="primary" disabled={busy} onClick={refreshSources}>
              {busy ? "Refreshing…" : "Refresh sources"}
            </button>
            <button
              className="gear"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              ⚙
            </button>
          </div>
        </header>
        <main className={stale ? "stale" : ""}>
          {/*
            The page's only <h1>. Task 8 deletes the hero that currently holds one,
            and the brand in the topbar is deliberately NOT a heading — it is chrome,
            identical across every view. Without this, the heading outline would start
            at <h2> with no root: a headings-list scan (NVDA Insert+F7, JAWS Insert+F6)
            would have nothing to land on, and every Panel/Zone call site in Tasks
            19–28 would inherit the gap.

            It names the CURRENT VIEW rather than the product, because switching views
            re-renders without a navigation, so there is no page-load announcement.
            This heading changing is what tells an assistive-tech user the view changed.
          */}
          <h1 className="sr-only">
            Usage Monitor — {VIEWS.find((item) => item.value === view)?.label ?? "Overview"}
          </h1>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <ViewSlot
            view={view}
            settingsOpen={settingsOpen}
            overview={overview}
            history={history}
            prices={prices}
            onSaved={refresh}
          />
        </main>
        <footer>
          Everything stays on this machine · API-equivalent estimates are not billing claims
        </footer>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Add the temporary view slot**

Append to `apps/web/src/app.tsx`. This adapter keeps the app running while Slices 4 and 5 replace each view. It is deleted in Task 26.

```tsx
import { Advanced, History, Overview, Pricing } from "./App.tsx";

function ViewSlot({
  view,
  settingsOpen,
  overview,
  history,
  prices,
  onSaved,
}: {
  view: View;
  settingsOpen: boolean;
  overview: OverviewView | null;
  history: UsageHistoryRecord[];
  prices: ModelPrice[];
  onSaved: () => Promise<void>;
}) {
  if (settingsOpen) return <Pricing prices={prices} onSaved={onSaved} />;
  if (view === "overview") return overview ? <Overview data={overview} /> : null;
  if (view === "breakdown") return overview ? <Advanced data={overview} /> : null;
  return <History records={history} />;
}
```

- [ ] **Step 3: Export the existing views so the slot can import them**

In `apps/web/src/App.tsx`, change these four declarations from `function` to `export function`: `Overview`, `History`, `Advanced`, `Pricing`. Then rename the existing `export function App` to `function LegacyApp` and delete its `export`, so `app.tsx` owns the exported `App`.

- [ ] **Step 4: Point the entry at the new shell**

In `apps/web/src/main.tsx`, change the import from `./App.tsx` to `./app.tsx`.

Note: on case-insensitive filesystems `App.tsx` and `app.tsx` collide. Rename the old file first: `git mv apps/web/src/App.tsx apps/web/src/legacy-views.tsx`, and import from `./legacy-views.tsx` in Steps 2 and 3 instead.

- [ ] **Step 5: Style the topbar**

Replace the `.topbar` through `.primary` rules in `apps/web/src/styles.css` with:

```css
.topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--page) 92%, transparent);
  backdrop-filter: blur(15px);
}
.brand-mark {
  width: 19px;
  height: 19px;
  object-fit: contain;
}
.brand-name {
  font-size: var(--size-body);
  font-weight: 650;
  letter-spacing: -0.01em;
}
.topbar nav {
  display: flex;
  gap: 2px;
  margin-left: 6px;
}
.topbar nav button {
  min-height: 0;
  padding: 4px 10px;
  border-radius: var(--radius-control);
  color: var(--muted);
}
.topbar nav button.active,
.topbar nav button:hover {
  background: var(--raised);
  color: var(--ink-strong);
  font-weight: 600;
}
.chips {
  display: flex;
  gap: 5px;
  align-items: center;
  margin-left: auto;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--field);
  font-size: var(--size-meta);
}
.chip-key {
  color: var(--muted);
}
.chip select,
.chip input {
  height: auto;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  width: auto;
}
.chip-search input {
  width: 110px;
}
.primary {
  padding: 4px 11px;
  border-radius: var(--radius-control);
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 700;
  font-size: var(--size-meta);
  min-height: 0;
}
.gear {
  width: 26px;
  height: 26px;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: var(--field);
  color: var(--muted);
}
main.stale {
  opacity: 0.55;
  transition: opacity 120ms ease-out;
}
```

- [ ] **Step 6: Verify**

Run: `vp run typecheck && vp run build:web`

Expected: both succeed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat: rebuild app shell with topbar filter chips and stale-hold refetch"
```

---

### Task 8: Remove the hero and disclaimer banner

**Files:**

- Modify: `apps/web/src/legacy-views.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Delete the hero section**

In `apps/web/src/legacy-views.tsx`, delete the `<section className={...hero...}>` block from the former `App` component and the now-unused `LegacyApp` function entirely. The shell in `app.tsx` has replaced it.

- [ ] **Step 2: Delete the disclaimer banner**

In `apps/web/src/legacy-views.tsx`, in the `Overview` component, delete this block:

```tsx
<p className="notice">
  <strong>API-equivalent estimate.</strong> This shows what the selected usage would cost at
  configured standard API token rates; it may not be an amount billed under a subscription.
</p>
```

The clause survives under the hero figure (Task 22) and in the footer (already in `app.tsx`).

- [ ] **Step 3: Delete the dead styles**

In `apps/web/src/styles.css`, delete the `.hero`, `.pricing-hero`, `.eyebrow`, `h1`, `.notice`, and `.filters` rule blocks, plus their entries in both `@media` blocks.

- [ ] **Step 4: Verify**

Run: `vp run typecheck && vp run build:web`

Expected: both succeed. Run `vp run dev` and confirm the page renders with the topbar and no hero.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "refactor: remove marketing hero and full-width disclaimer banner"
```

---

# Slice 2 — Canonical identities

> **Tasks 9 and 10 must land together — do not commit between them.**
>
> `UsageLedger.records()` parses every stored row with the strict `usageRecordSchema`.
> Task 9 makes `usageSourceId` and `harnessId` required and drops `rateLimits`, so the
> instant it lands every pre-existing row fails to parse and the app cannot read its own
> ledger. Task 10's decode-on-read is the repair. A commit containing only Task 9 is a
> commit that cannot open an existing database.
>
> The unit tests do not catch this, because they construct records in the _new_ shape.
> Only real stored data exposes it — which is exactly why Task 10 includes a test that
> writes a pre-identity payload with raw SQL and reads it back through `records()`.

### Task 9: Add usage source and harness identities to the contract

**Files:**

- Modify: `packages/contracts/src/index.ts:49-78`
- Create: `packages/contracts/src/legacy.ts`
- Test: `packages/contracts/test/legacy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/contracts/test/legacy.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeUsageRecord } from "../src/legacy.ts";

const legacy = {
  id: "codex:session-a:turn-1",
  sourceHostId: "host:a",
  timestamp: "2026-07-20T09:00:00.000Z",
  taskName: "portable-usage-host",
  provider: "openai",
  model: "gpt-5-codex",
  reasoningLevel: "high",
  modeFlags: { ultra: false, fast: false },
  inputTokens: 1000,
  cachedInputTokens: 400,
  outputTokens: 200,
  reasoningOutputTokens: 100,
  totalTokens: 1200,
  lastTokenUsage: null,
  modelContextWindowTokens: 400_000,
  rateLimits: null,
  source: "codex-local",
};

describe("Legacy Usage Record decoding", () => {
  it("derives usageSourceId and harnessId from the legacy source field", () => {
    const record = decodeUsageRecord(legacy);
    assert.equal(record.usageSourceId, "codex-local");
    assert.equal(record.harnessId, "codex");
  });

  it("maps an unknown reasoning level to unreported rather than a bucket", () => {
    const record = decodeUsageRecord({ ...legacy, reasoningLevel: "unknown" });
    assert.equal(record.reasoningLevel, undefined);
  });

  it("maps an empty reasoning level to unreported", () => {
    const record = decodeUsageRecord({ ...legacy, reasoningLevel: "" });
    assert.equal(record.reasoningLevel, undefined);
  });

  it("preserves a reported reasoning level", () => {
    assert.equal(decodeUsageRecord(legacy).reasoningLevel, "high");
  });

  it("drops embedded rate limits from the canonical record", () => {
    const record = decodeUsageRecord({
      ...legacy,
      rateLimits: { limitId: "x", limitName: "", planType: "plus" },
    });
    assert.ok(!("rateLimits" in record));
  });

  it("leaves an already-migrated record unchanged", () => {
    const migrated = decodeUsageRecord({
      ...legacy,
      usageSourceId: "claude-code-local",
      harnessId: "claude-code",
    });
    assert.equal(migrated.usageSourceId, "claude-code-local");
    assert.equal(migrated.harnessId, "claude-code");
  });

  it("preserves zero cached tokens as source evidence, not as unreported", () => {
    const record = decodeUsageRecord({ ...legacy, cachedInputTokens: 0 });
    assert.equal(record.cachedInputTokens, 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/contracts/test/legacy.test.ts`

Expected: FAIL — `Cannot find module '../src/legacy.ts'`

- [ ] **Step 3: Update the record schema**

In `packages/contracts/src/index.ts`, replace the `usageRecordSchema` definition (lines 49–71) with:

```ts
export const usageRecordSchema = z
  .object({
    id: z.string().min(1).max(500),
    sourceHostId: z.string().min(1).max(200),
    usageSourceId: z.string().min(1).max(200),
    harnessId: z.string().min(1).max(200),
    timestamp: z.string().datetime(),
    taskName: z.string().min(1).max(500),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    reasoningLevel: z.string().min(1).max(100).optional(),
    modeFlags: usageModeFlagsSchema.default({ ultra: false, fast: false }),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative(),
    lastTokenUsage: tokenShapeSchema.nullable(),
    modelContextWindowTokens: z.number().int().nonnegative().optional(),
    source: z.string().min(1).max(200),
    sessionId: z.string().max(200).optional(),
    turnId: z.string().max(200).optional(),
  })
  .strict();
```

`rateLimits` is removed from the record here. The `rateLimitsSchema` export stays — the Codex importer still parses that shape in Slice 3 before converting it to a quota snapshot.

- [ ] **Step 4: Write the decoder**

Create `packages/contracts/src/legacy.ts`:

```ts
import { usageRecordSchema, type UsageRecord } from "./index.ts";

const HARNESS_BY_SOURCE: Record<string, string> = {
  "codex-local": "codex",
  "claude-code-local": "claude-code",
};

/** Maps a usage source id to its harness, falling back to the source id itself. */
export function harnessForSource(usageSourceId: string): string {
  return HARNESS_BY_SOURCE[usageSourceId] ?? usageSourceId.replace(/-local$/, "");
}

/**
 * Upgrades a stored Usage Record to the canonical shape, then validates it.
 * Records written before the identity migration carry `source` but no
 * `usageSourceId`/`harnessId`, and embed Codex-shaped `rateLimits`.
 */
export function decodeUsageRecord(value: unknown): UsageRecord {
  const record = { ...(value as Record<string, unknown>) };
  const usageSourceId = String(record.usageSourceId ?? record.source ?? "unknown");
  record.usageSourceId = usageSourceId;
  record.harnessId = String(record.harnessId ?? harnessForSource(usageSourceId));
  record.source = String(record.source ?? usageSourceId);
  delete record.rateLimits;
  const reasoning = String(record.reasoningLevel ?? "").trim();
  if (!reasoning || reasoning.toLocaleLowerCase() === "unknown") delete record.reasoningLevel;
  return usageRecordSchema.parse(record);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/contracts/test/legacy.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src packages/contracts/test/legacy.test.ts
git commit -m "feat: separate usage source, harness, and provider identities"
```

---

### Task 10: Decode on read in the ledger

**Files:**

- Modify: `packages/usage-ledger/src/index.ts:38-43,209-224`
- Test: `packages/usage-ledger/test/ledger.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-ledger/test/ledger.test.ts`:

```ts
describe("Ledger legacy migration", () => {
  it("reads a pre-identity record and upgrades it on the way out", () => {
    const ledger = new UsageLedger(":memory:");
    ledger.database
      .prepare(
        "INSERT INTO usage_records (id, source_host_id, recorded_at, payload) VALUES (?, ?, ?, ?)",
      )
      .run(
        "codex:old:turn-1",
        "host:a",
        "2026-07-20T09:00:00.000Z",
        JSON.stringify({
          id: "codex:old:turn-1",
          sourceHostId: "host:a",
          timestamp: "2026-07-20T09:00:00.000Z",
          taskName: "legacy task",
          provider: "openai",
          model: "gpt-5-codex",
          reasoningLevel: "unknown",
          modeFlags: { ultra: false, fast: false },
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          reasoningOutputTokens: 1,
          totalTokens: 12,
          lastTokenUsage: null,
          modelContextWindowTokens: 400000,
          rateLimits: { limitId: "x", limitName: "", planType: "plus" },
          source: "codex-local",
        }),
      );
    const [record] = ledger.records();
    assert.equal(record?.usageSourceId, "codex-local");
    assert.equal(record?.harnessId, "codex");
    assert.equal(record?.reasoningLevel, undefined);
    ledger.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`

Expected: FAIL — the record fails `usageRecordSchema.parse` because `usageSourceId` is missing and `rateLimits` is not allowed by the strict schema.

- [ ] **Step 3: Decode on read**

In `packages/usage-ledger/src/index.ts`, change the import on line 9 to:

```ts
import { modelPriceSchema, usageRecordSchema } from "@llm-usage-monitor/contracts";
import { decodeUsageRecord } from "@llm-usage-monitor/contracts/legacy";
```

If the contracts package does not expose subpath exports, import from the package root instead and re-export `decodeUsageRecord` from `packages/contracts/src/index.ts` by adding this line at the end of that file:

```ts
export { decodeUsageRecord, harnessForSource } from "./legacy.ts";
```

Then replace the body of `records()` (lines 38–43) with:

```ts
  records(): UsageRecord[] {
    return this.database
      .prepare("SELECT payload FROM usage_records ORDER BY recorded_at DESC")
      .all()
      .map((row) => decodeUsageRecord(JSON.parse(String(row.payload))));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/usage-ledger packages/contracts/src/index.ts
git commit -m "feat: decode legacy usage records on read"
```

---

### Task 11: Rank usage by harness

**Files:**

- Modify: `packages/contracts/src/index.ts` (`RankedUsage`, `OverviewView`)
- Modify: `packages/usage-analysis/src/index.ts:23-53`
- Test: `packages/usage-analysis/test/analysis.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`. Extend the local `record` helper first — replace its definition (lines 6–28) with:

```ts
const record = (
  timestamp: string,
  reasoningLevel: string | undefined = "high",
  modeFlags = { ultra: false, fast: false },
  overrides: Partial<UsageRecord> = {},
): UsageRecord => ({
  id: timestamp,
  sourceHostId: "host:a",
  usageSourceId: "codex-local",
  harnessId: "codex",
  timestamp,
  taskName: "Architecture",
  provider: "openai",
  model: "gpt-test",
  reasoningLevel,
  modeFlags,
  inputTokens: 1_000_000,
  cachedInputTokens: 500_000,
  outputTokens: 100_000,
  reasoningOutputTokens: 50_000,
  totalTokens: 1_100_000,
  lastTokenUsage: null,
  modelContextWindowTokens: 400_000,
  source: "codex-local",
  ...overrides,
});
```

Then append:

```ts
describe("Harness ranking", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
    {
      provider: "anthropic",
      model: "claude-test",
      input: 3,
      cachedInput: 0.3,
      output: 15,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("groups records by harness and sorts by estimated cost", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z"),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "claude-1",
            usageSourceId: "claude-code-local",
            harnessId: "claude-code",
            provider: "anthropic",
            model: "claude-test",
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.deepEqual(
      view.byHarness.map((row) => row.key),
      ["claude-code", "codex"],
    );
    assert.equal(view.byHarness.length, 2);
  });

  it("keeps harness and provider independently filterable", () => {
    const records = [
      record("2026-07-23T10:00:00.000Z"),
      record(
        "2026-07-23T11:00:00.000Z",
        "high",
        { ultra: false, fast: false },
        {
          id: "claude-1",
          usageSourceId: "claude-code-local",
          harnessId: "claude-code",
          provider: "anthropic",
          model: "claude-test",
        },
      ),
    ];
    const byHarness = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all", harnessId: "codex" },
    });
    assert.equal(byHarness.totals.records, 1);
    assert.equal(byHarness.byModel[0]?.model, "gpt-test");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: FAIL — `view.byHarness` is undefined.

- [ ] **Step 3: Extend the contract**

In `packages/contracts/src/index.ts`, add `harnessId?: string;` and `usageSourceId?: string;` to `UsageFilters`, and add `byHarness: RankedUsage[];` to `OverviewView`. Also add both keys to `filtersSchema`:

Do **not** add `harnessId` to `RankedUsage`. `rankModels` populates `provider`/`model`/`reasoningLevel` because those are structured sub-fields distinct from a model row's key — but a `byHarness` row's key already IS the harness id, so the field would only ever hold `row.key` again. Every consumer reads `row.key` for the label.

```ts
    harnessId: z.string().max(200).optional(),
    usageSourceId: z.string().max(200).optional(),
```

- [ ] **Step 4: Implement ranking and filtering**

In `packages/usage-analysis/src/index.ts`, add to the returned object in `analyzeUsage` (after `byModel`):

```ts
    byHarness: rank(priced, ({ record }) => record.harnessId),
```

And in `filterUsageRecords`, add these two conditions to the returned predicate:

```ts
      (!filters.harnessId || record.harnessId === filters.harnessId) &&
      (!filters.usageSourceId || record.usageSourceId === filters.usageSourceId) &&
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: PASS.

- [ ] **Step 6: Pass the new filters through the server**

In `apps/server/src/server.ts`, add `"harnessId"` and `"usageSourceId"` to the key array in `parseFilters` (lines 186–196).

- [ ] **Step 7: Prove the server accepts them**

Append to `apps/server/test/server.test.ts`, following the existing pattern in that file for starting a server against a temporary data directory:

```ts
describe("Harness filter transport", () => {
  it("echoes a harness filter back in the overview response", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lum-harness-"));
    const started = await startUsageMonitorServer({
      dataDirectory: directory,
      webDirectory: directory,
    });
    try {
      const response = await fetch(
        `${started.discovery.dashboardUrl}api/overview?timeframe=all&harnessId=codex`,
      );
      const view = (await response.json()) as OverviewView;
      assert.equal(response.status, 200);
      assert.equal(view.filters.harnessId, "codex");
      assert.deepEqual(view.byHarness, []);
    } finally {
      await started.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an over-long harness filter", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lum-harness-"));
    const started = await startUsageMonitorServer({
      dataDirectory: directory,
      webDirectory: directory,
    });
    try {
      const response = await fetch(
        `${started.discovery.dashboardUrl}api/overview?timeframe=all&harnessId=${"x".repeat(300)}`,
      );
      assert.equal(response.status, 500);
    } finally {
      await started.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
```

Reuse whatever imports `server.test.ts` already has for `fs`, `join`, `tmpdir`, and `startUsageMonitorServer`; add only `OverviewView` to the contracts type import.

- [ ] **Step 8: Verify and commit**

Run: `vp run test && vp run typecheck`

```bash
git add packages/contracts packages/usage-analysis apps/server/src/server.ts
git commit -m "feat: rank and filter usage by harness"
```

---

### Task 12: Cache efficiency excludes non-reporting records

**Files:**

- Modify: `packages/contracts/src/index.ts` (`UsageTotals`)
- Modify: `packages/usage-analysis/src/index.ts:139-168`
- Test: `packages/usage-analysis/test/analysis.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`:

```ts
describe("Unavailable metrics are not zero", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("excludes records that do not report caching from cache efficiency", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z"),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "no-cache",
            cachedInputTokens: undefined,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.totals.cacheEfficiency, 0.5);
    assert.equal(view.totals.cacheReportingRecords, 1);
    assert.equal(view.totals.records, 2);
  });

  it("reports zero cached tokens as evidence, not as unreported", () => {
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            cachedInputTokens: 0,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.totals.cacheEfficiency, 0);
    assert.equal(view.totals.cacheReportingRecords, 1);
  });

  it("groups records with no reasoning level under an explicit unreported key", () => {
    const view = analyzeUsage({
      records: [
        record("2026-07-23T10:00:00.000Z", undefined),
        record("2026-07-23T11:00:00.000Z", "high", { ultra: false, fast: false }, { id: "b" }),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    const levels = view.byModel[0]?.children?.map((child) => child.key) ?? [];
    assert.ok(levels.includes("not reported"));
    assert.ok(!levels.includes("none"));
    assert.ok(!levels.includes("unknown"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: FAIL — `cacheEfficiency` is 0.25 because the non-reporting record contributes 0 to the numerator while its input tokens inflate the denominator.

- [ ] **Step 3: Add the coverage field to the contract**

In `packages/contracts/src/index.ts`, add to `UsageTotals`:

```ts
cacheReportingRecords: number;
```

- [ ] **Step 4: Implement reporting-aware summarization**

In `packages/usage-analysis/src/index.ts`, replace `summarize` (lines 139–168) with:

```ts
function summarize(items: PricedRecord[]): UsageTotals {
  const totals = items.reduce(
    (sum, { record, estimatedCost }) => ({
      estimatedCost: sum.estimatedCost + (estimatedCost ?? 0),
      pricedRecords: sum.pricedRecords + (estimatedCost === null ? 0 : 1),
      records: sum.records + 1,
      inputTokens: sum.inputTokens + record.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + (record.cachedInputTokens ?? 0),
      cacheReportingRecords:
        sum.cacheReportingRecords + (record.cachedInputTokens === undefined ? 0 : 1),
      cacheReportingInputTokens:
        sum.cacheReportingInputTokens +
        (record.cachedInputTokens === undefined ? 0 : record.inputTokens),
      outputTokens: sum.outputTokens + record.outputTokens,
      reasoningOutputTokens: sum.reasoningOutputTokens + (record.reasoningOutputTokens ?? 0),
      totalTokens: sum.totalTokens + record.totalTokens,
    }),
    {
      estimatedCost: 0,
      pricedRecords: 0,
      records: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheReportingRecords: 0,
      cacheReportingInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
  const { cacheReportingInputTokens, ...rest } = totals;
  return {
    ...rest,
    tasks: new Set(items.map(({ record }) => record.taskName)).size,
    models: new Set(items.map(({ record }) => `${record.provider}/${record.model}`)).size,
    cacheEfficiency: cacheReportingInputTokens
      ? totals.cachedInputTokens / cacheReportingInputTokens
      : 0,
  };
}
```

- [ ] **Step 5: Use an explicit unreported reasoning bucket**

In `packages/usage-analysis/src/index.ts`, in `rankModels`, change the children grouping key from `record.reasoningLevel || "unknown"` to:

```ts
const children = rank(values, ({ record }) => record.reasoningLevel ?? "not reported");
```

And in `reasoningOrder`, replace `"unknown"` with `"not reported"` in the order array.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts packages/usage-analysis
git commit -m "feat: exclude non-reporting records from cache efficiency"
```

---

### Task 13: Task rows gain session children

**Files:**

- Modify: `packages/usage-analysis/src/index.ts`
- Test: `packages/usage-analysis/test/analysis.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`:

```ts
describe("Task session children", () => {
  const prices = [
    {
      provider: "openai",
      model: "gpt-test",
      input: 2,
      cachedInput: 0.5,
      output: 10,
      source: "test",
      effectiveDate: "2026-01-01",
    },
  ];
  const hosts = [
    {
      id: "host:a",
      hostname: "workstation",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: "2026-01-01T00:00:00.000Z",
      lastSeenAt: "2026-07-23T10:00:00.000Z",
    },
  ];

  it("nests sessions under their task, ranked by cost", () => {
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "a",
            sessionId: "session-1",
          },
        ),
        record(
          "2026-07-23T11:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "b",
            sessionId: "session-1",
          },
        ),
        record(
          "2026-07-23T12:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "c",
            sessionId: "session-2",
            outputTokens: 10,
            totalTokens: 1_010_000,
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    const task = view.byTask[0];
    assert.equal(task?.children?.length, 2);
    assert.equal(task?.children?.[0]?.key, "session-1");
    assert.equal(task?.children?.[0]?.records, 2);
  });

  it("falls back to the record id when a session id is absent", () => {
    const view = analyzeUsage({
      records: [
        record(
          "2026-07-23T10:00:00.000Z",
          "high",
          { ultra: false, fast: false },
          {
            id: "solo",
          },
        ),
      ],
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.equal(view.byTask[0]?.children?.[0]?.key, "solo");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: FAIL — `task.children` is undefined.

- [ ] **Step 3: Implement nested task ranking**

In `packages/usage-analysis/src/index.ts`, add this function after `rankModels`:

```ts
function rankTasks(items: PricedRecord[]): RankedUsage[] {
  return group(items, ({ record }) => record.taskName)
    .map(({ key, items: values }) => {
      const total = summarize(values);
      return {
        key,
        estimatedCost: total.estimatedCost,
        totalTokens: total.totalTokens,
        records: total.records,
        modeFlags: summarizeModes(values),
        children: rank(values, ({ record }) => record.sessionId?.trim() || record.id),
      };
    })
    .sort(
      (left, right) =>
        right.estimatedCost - left.estimatedCost || right.totalTokens - left.totalTokens,
    );
}
```

Then change the `byTask` line in `analyzeUsage` from `rank(priced, ({ record }) => record.taskName)` to `rankTasks(priced)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/usage-analysis
git commit -m "feat: nest sessions under task rankings"
```

---

### Task 14: Importer emits canonical identities

**Files:**

- Modify: `apps/server/src/codex-importer.ts:126-153`
- Test: `apps/server/test/codex-characterization.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/codex-characterization.test.ts`:

```ts
describe("Codex identity emission", () => {
  it("stamps the usage source and harness on every record", async () => {
    const records = await parseSession(session, taskNames);
    for (const record of records) {
      assert.equal(record.usageSourceId, "codex-local");
      assert.equal(record.harnessId, "codex");
    }
  });

  it("omits the reasoning level when Codex reported no effort", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.reasoningLevel, "high");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/codex-characterization.test.ts`

Expected: FAIL — `usageSourceId` is undefined.

- [ ] **Step 3: Emit the identities**

In `apps/server/src/codex-importer.ts`, inside the object returned by the `turns.flatMap` callback, add these two properties next to `source: "codex-local"`:

```ts
        usageSourceId: "codex-local",
        harnessId: "codex",
```

And change the reasoning level assignment on line 100 from:

```ts
const reasoningLevel = String(payload.effort || "unknown");
```

to:

```ts
const reasoningLevel = payload.effort ? String(payload.effort) : undefined;
```

Then update the `Turn` type's `reasoningLevel` field to `string | undefined`, and update the `usageModeFlags` call to pass `reasoningLevel ?? ""`.

In `usageModeFlags`, the first line becomes:

```ts
const normalizedReasoning = String(reasoningLevel ?? "")
  .trim()
  .toLocaleLowerCase();
```

- [ ] **Step 4: Remove rate limits from the emitted record**

Delete the `rateLimits: turn.rateLimits,` line from the returned record object. The `latestRateLimits` tracking stays — Task 17 uses it to build quota snapshots.

The characterization test from Task 1 asserting `record.rateLimits` will now fail. Update those two assertions to read from the snapshot instead once Task 17 lands; for now, delete the `it("applies the latest rate-limit snapshot to subsequent turns")` block and note in the commit that Task 17 replaces it.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/codex-characterization.test.ts`

Expected: PASS.

- [ ] **Step 6: Verify the whole suite and commit**

Run: `vp run test && vp run typecheck`

```bash
git add apps/server/src/codex-importer.ts apps/server/test/codex-characterization.test.ts
git commit -m "feat: emit usage source and harness identities from the Codex importer"
```

---

# Slice 3 — Quota snapshots

### Task 15: Quota snapshot contract

> **Changing `OverviewView` breaks two consumers immediately.** `packages/usage-analysis/src/index.ts`
> returns `latestRateLimits: null` and `LimitsCard` in `apps/web/src/legacy-views.tsx` reads
> `data.latestRateLimits`. As originally written this task renamed the field and left both
> dangling until Task 18, so Tasks 15, 16, and 17 would each commit a tree that does not
> typecheck. Step 3 below therefore folds in the placeholder halves of Task 18's Steps 3 and 5.
> Task 18 still does the real work — threading actual snapshots through `AnalysisInput`.

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/usage-analysis/src/index.ts` (placeholder, completed in Task 18)
- Modify: `apps/web/src/legacy-views.tsx` (placeholder, replaced in Task 24)
- Test: `packages/contracts/test/contracts.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/test/contracts.test.ts`:

```ts
describe("Usage quota snapshots", () => {
  it("accepts a snapshot whose windows omit optional measurements", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "claude-code-local",
      sourceHostId: "host:a",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [{ id: "five-hour", label: "5-hour window" }],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, undefined);
    assert.equal(snapshot.plan, undefined);
  });

  it("accepts a fully populated Codex-shaped snapshot", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      plan: "plus",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [
        {
          id: "primary",
          label: "5-hour window",
          usedPercent: 41.5,
          windowMinutes: 300,
          resetsAt: "2026-07-23T12:06:40.000Z",
        },
      ],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, 41.5);
  });

  // Snapshots round-trip through the ledger as JSON (Task 16), so a field the
  // schema does not know about is silently dropped on the way in rather than
  // surfacing as a bug at the source. Strictness turns that into a parse error.
  it("rejects a snapshot carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
        creditsRemaining: 12,
      }),
    );
  });

  it("rejects a window carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", resets_at: 1785300000 }],
      }),
    );
  });

  it("rejects a snapshot with no usage source", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
      }),
    );
  });
});
```

Add `usageQuotaSnapshotSchema` to the existing import from `../src/index.ts` at the top of the file.

The two unknown-field tests were added during execution. Without them `.strict()` on either
schema is unguarded, and dropping it is silent: Zod's default is to strip unknown keys, not to
reject, so a Codex-shaped `resets_at` passed straight through would vanish rather than fail.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`

Expected: FAIL — `usageQuotaSnapshotSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/contracts/src/index.ts`, add after `rateLimitsSchema`:

```ts
export const usageQuotaWindowSchema = z
  .object({
    id: z.string().min(1).max(200),
    label: z.string().min(1).max(200),
    usedPercent: z.number().nonnegative().optional(),
    windowMinutes: z.number().int().nonnegative().optional(),
    resetsAt: z.string().datetime().optional(),
  })
  .strict();
export const usageQuotaSnapshotSchema = z
  .object({
    usageSourceId: z.string().min(1).max(200),
    sourceHostId: z.string().min(1).max(200),
    accountScope: z.string().max(200).optional(),
    plan: z.string().max(200).optional(),
    observedAt: z.string().datetime(),
    windows: z.array(usageQuotaWindowSchema).max(50),
    balance: z
      .object({ amount: z.number(), unit: z.string().max(50) })
      .strict()
      .optional(),
  })
  .strict();
export type UsageQuotaSnapshot = z.infer<typeof usageQuotaSnapshotSchema>;
export type UsageQuotaWindow = z.infer<typeof usageQuotaWindowSchema>;
```

Then in `OverviewView`, replace `latestRateLimits: RateLimits | null;` with:

```ts
  quotaSnapshots: UsageQuotaSnapshot[];
```

`rateLimitsSchema` and the `RateLimits` type both stay exported — the Codex importer still parses
that shape in Task 17 before converting it.

- [ ] **Step 3b: Keep the two consumers compiling**

Per the boxed note above. In `packages/usage-analysis/src/index.ts`, replace the
`latestRateLimits: null` placeholder with `quotaSnapshots: []` and update the comment above it to
point at Tasks 16–18 rather than 15–18. An empty list is the honest placeholder for the same
reason `null` was: it reports that nothing observed a quota instead of fabricating one.

In `apps/web/src/legacy-views.tsx`, rewrite `LimitsCard` to read `data.quotaSnapshots[0]` and map
over its `windows` instead of the fixed Primary/Weekly pair. Two things change beyond the field
name, and both are easy to get wrong:

- `usedPercent` is now optional. Render `—` and a value-less (indeterminate) `<progress>` when it
  is absent. A `?? 0` draws an empty bar that reads as "none used" — the exact
  unavailable-is-not-zero mistake Slice 2 spent Task 12 removing.
- `resetsAt` is an ISO instant, not Unix epoch seconds. The old code multiplied by 1000; doing
  that to an ISO string yields `Invalid Date`.

Task 24 replaces this card properly; this is only enough to keep the tree green.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`

Expected: PASS, 8 tests.

Then run `vp run check` — Step 3b means this task must leave the whole gate green, not just the
contracts suite.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/usage-analysis apps/web/src/legacy-views.tsx
git commit -m "feat: add normalized usage quota snapshot contract"
```

---

### Task 16: Persist quota snapshots

**Files:**

- Modify: `packages/usage-ledger/src/index.ts`
- Test: `packages/usage-ledger/test/ledger.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-ledger/test/ledger.test.ts`:

Use the file's existing `create()` helper rather than `new UsageLedger(":memory:")` plus a manual
`close()` — the `afterEach` at the top of the file already closes every ledger `create()` hands
out, and a test that fails before its `close()` line leaks a handle.

```ts
describe("Quota snapshot storage", () => {
  const snapshot = (observedAt: string, usedPercent: number) => ({
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    plan: "plus",
    observedAt,
    windows: [{ id: "primary", label: "5-hour window", usedPercent }],
  });

  it("keeps only the latest snapshot per source and host", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T10:00:00.000Z", 41.5)]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.windows[0]?.usedPercent, 41.5);
  });

  // Added during execution. The test above writes in ascending time order, so it
  // passes under plain last-write-wins and proves nothing about recency despite
  // its name. This is the one that makes "latest" mean latest.
  it("does not let an older observation overwrite a newer one", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T10:00:00.000Z", 41.5)]);
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.observedAt, "2026-07-20T10:00:00.000Z");
    assert.equal(stored[0]?.windows[0]?.usedPercent, 41.5);
  });

  it("keeps snapshots from different sources side by side", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([
      snapshot("2026-07-20T09:00:00.000Z", 10),
      { ...snapshot("2026-07-20T09:00:00.000Z", 88), usageSourceId: "claude-code-local" },
    ]);
    assert.equal(ledger.quotaSnapshots().length, 2);
  });

  // Added during execution. The key is (source, host) but the test above only
  // covers the source half; without this, collapsing the host half goes unnoticed.
  it("keeps snapshots for the same source on different hosts side by side", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([
      snapshot("2026-07-20T09:00:00.000Z", 10),
      { ...snapshot("2026-07-20T09:00:00.000Z", 88), sourceHostId: "host:b" },
    ]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map((entry) => entry.sourceHostId).sort(), ["host:a", "host:b"]);
  });

  it("clears snapshots along with records", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    ledger.clearRecords();
    assert.equal(ledger.quotaSnapshots().length, 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`

Expected: FAIL — `ledger.replaceQuotaSnapshots is not a function`

- [ ] **Step 3: Add the table and methods**

In `packages/usage-ledger/src/index.ts`, add to the `migrate()` SQL block:

```sql
      CREATE TABLE IF NOT EXISTS usage_quota_snapshots (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(usage_source_id, source_host_id));
```

Add these methods to the class:

The `WHERE` clause on the `DO UPDATE` was added during execution. Without it the upsert is
last-write-wins, not latest-wins: an import that sees older evidence overwrites a fresher reading
and the quota meter silently reverts. Keep the comment — the lexicographic-ISO assumption it
records is what makes the SQL comparison valid.

```ts
  /**
   * Keeps the NEWEST snapshot per (usage source, host), not the most recently
   * written one. Quota state is a point-in-time observation, so an import that
   * happens to see older evidence — a partial scan, a re-read of an archived
   * session, two sources racing — must not overwrite a fresher reading. Without
   * the WHERE clause this is last-write-wins, which passes any test that writes
   * in ascending order and silently reverts the quota meter in production.
   *
   * The comparison is lexicographic on ISO-8601. `usageQuotaSnapshotSchema`
   * pins `observedAt` to UTC (Zod's `.datetime()` rejects offsets), so that is
   * chronological — with one bounded exception: mixed sub-second precision at
   * the same second sorts "…00Z" after "…00.5Z". Sources emit uniform
   * precision, and the worst case is picking the wrong one of two observations
   * under a second apart, so this stays a string compare rather than a parse.
   */
  replaceQuotaSnapshots(snapshots: UsageQuotaSnapshot[]): void {
    const validated = snapshots.map((snapshot) => usageQuotaSnapshotSchema.parse(snapshot));
    this.transaction(() => {
      const insert = this.database
        .prepare(`INSERT INTO usage_quota_snapshots (usage_source_id, source_host_id, observed_at, payload) VALUES (?, ?, ?, ?)
        ON CONFLICT(usage_source_id, source_host_id) DO UPDATE SET observed_at=excluded.observed_at, payload=excluded.payload
        WHERE excluded.observed_at > usage_quota_snapshots.observed_at`);
      for (const snapshot of validated)
        insert.run(
          snapshot.usageSourceId,
          snapshot.sourceHostId,
          snapshot.observedAt,
          JSON.stringify(snapshot),
        );
    });
  }

  quotaSnapshots(): UsageQuotaSnapshot[] {
    return this.database
      .prepare("SELECT payload FROM usage_quota_snapshots ORDER BY usage_source_id")
      .all()
      .map((row) => usageQuotaSnapshotSchema.parse(JSON.parse(String(row.payload))));
  }
```

Update the import at line 9 to include `usageQuotaSnapshotSchema` and add `UsageQuotaSnapshot` to the type import block. Update `clearRecords()` so its `exec` reads:

```ts
this.database.exec(
  "DELETE FROM usage_records; DELETE FROM provider_import_state; DELETE FROM usage_quota_snapshots;",
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`

Expected: PASS, 10 tests in the file (5 of them new).

- [ ] **Step 5: Commit**

```bash
git add packages/usage-ledger
git commit -m "feat: persist normalized quota snapshots per source and host"
```

---

### Task 17: Codex importer produces quota snapshots

**Files:**

- Modify: `apps/server/src/codex-importer.ts`
- Modify: `apps/server/src/server.ts:41-57`
- Create: `apps/server/test/fixtures/codex/archived_sessions/2026/06/rollout-2026-06-15T08-00-00-bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jsonl`
- Modify: `apps/server/test/fixtures/codex/README.md`
- Test: `apps/server/test/codex-characterization.test.ts` (append)

> **The plan's tests cover the pure converter, not what actually gets stored.**
> `quotaSnapshotFromRateLimits` is exercised thoroughly below, but Step 4b's
> cross-file newest-wins tracking and cached path — the code that decides which
> snapshot reaches the ledger — had no coverage at all. Step 6b adds it. Both
> defects it catches are silent in production: a fully-cached run reporting no
> quota, and an archived session overwriting a live reading.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/codex-characterization.test.ts`:

```ts
import { quotaSnapshotFromRateLimits } from "../src/codex-importer.ts";

describe("Codex quota conversion", () => {
  const limits = {
    limitId: "plus-1",
    limitName: "Plus",
    planType: "plus",
    rateLimitReachedType: "none",
    primary: { usedPercent: 41.5, windowMinutes: 300, resetsAt: 1784950000 },
    secondary: { usedPercent: 78.25, windowMinutes: 10080, resetsAt: 1785300000 },
    credits: null,
    individualLimit: null,
  };

  it("converts Codex windows into named quota windows", () => {
    const snapshot = quotaSnapshotFromRateLimits(limits, "host:a", "2026-07-20T09:00:30.000Z");
    assert.equal(snapshot?.usageSourceId, "codex-local");
    assert.equal(snapshot?.plan, "plus");
    assert.deepEqual(
      snapshot?.windows.map((window) => [window.id, window.label, window.usedPercent]),
      [
        ["primary", "5-hour window", 41.5],
        ["secondary", "Weekly window", 78.25],
      ],
    );
  });

  it("converts epoch reset seconds into an ISO timestamp", () => {
    const snapshot = quotaSnapshotFromRateLimits(limits, "host:a", "2026-07-20T09:00:30.000Z");
    assert.equal(snapshot?.windows[0]?.resetsAt, new Date(1784950000 * 1000).toISOString());
  });

  it("omits a window the source did not report", () => {
    const snapshot = quotaSnapshotFromRateLimits(
      { ...limits, secondary: null },
      "host:a",
      "2026-07-20T09:00:30.000Z",
    );
    assert.equal(snapshot?.windows.length, 1);
  });

  it("returns null when there are no rate limits at all", () => {
    assert.equal(quotaSnapshotFromRateLimits(null, "host:a", "2026-07-20T09:00:30.000Z"), null);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/codex-characterization.test.ts`

Expected: FAIL — `quotaSnapshotFromRateLimits` is not exported.

- [ ] **Step 3: Implement the conversion**

Add to `apps/server/src/codex-importer.ts`:

The label is derived from `windowMinutes` rather than hardcoded per slot (changed during
execution). The slot name says nothing about duration: `primary` is 5 hours on the plans we have
seen, but a plan whose primary window is 3 hours would still be labelled "5-hour window" — telling
the reader the wrong reset horizon on the one widget whose whole job is answering "how long until
this frees up?". The plan's two assertions below pass either way, because Codex's current windows
happen to be exactly 300 and 10080 minutes, so Step 1 gained two tests that distinguish them.

```ts
import type { RateLimits, UsageQuotaSnapshot, UsageRecord } from "@llm-usage-monitor/contracts";

/**
 * Fallback labels, used only when the source does not report a window length.
 */
const WINDOW_LABELS: Record<string, string> = {
  primary: "5-hour window",
  secondary: "Weekly window",
};

function windowLabel(id: string, windowMinutes: number): string {
  if (windowMinutes <= 0) return WINDOW_LABELS[id] ?? id;
  if (windowMinutes % 10_080 === 0) {
    const weeks = windowMinutes / 10_080;
    return weeks === 1 ? "Weekly window" : `${weeks}-week window`;
  }
  if (windowMinutes % 1_440 === 0) {
    const days = windowMinutes / 1_440;
    return days === 1 ? "Daily window" : `${days}-day window`;
  }
  if (windowMinutes % 60 === 0) return `${windowMinutes / 60}-hour window`;
  return `${windowMinutes}-minute window`;
}

/** Converts a Codex rate-limit payload into a normalized quota snapshot. */
export function quotaSnapshotFromRateLimits(
  limits: RateLimits | null,
  sourceHostId: string,
  observedAt: string,
): UsageQuotaSnapshot | null {
  if (!limits) return null;
  const windows = (["primary", "secondary"] as const).flatMap((id) => {
    const window = limits[id];
    if (!window) return [];
    return [
      {
        id,
        label: windowLabel(id, window.windowMinutes),
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        ...(window.resetsAt ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
      },
    ];
  });
  return {
    usageSourceId: "codex-local",
    sourceHostId,
    ...(limits.planType ? { plan: limits.planType } : {}),
    observedAt,
    windows,
    ...(limits.credits && !limits.credits.unlimited
      ? { balance: { amount: limits.credits.balance, unit: "credits" } }
      : {}),
  };
}
```

- [ ] **Step 4: Return the snapshot from collect**

In `CodexSessionProvider.collect`, track the latest rate limits. Change `parseSession` to return `{ records, rateLimits }` instead of a bare array:

At the end of `parseSession`, replace the `return turns.flatMap(...)` statement with:

```ts
const records = turns.flatMap((turn) => {
  if (!turn.total) return [];
  const delta = subtractTokenShapes(turn.total, previous);
  previous = turn.total;
  if (delta.totalTokens <= 0 && delta.inputTokens <= 0 && delta.outputTokens <= 0) return [];
  return [
    {
      id: `codex:${sessionId}:${turn.turnId}`,
      timestamp: new Date(turn.timestamp).toISOString(),
      taskName,
      provider,
      model: turn.model,
      ...(turn.reasoningLevel ? { reasoningLevel: turn.reasoningLevel } : {}),
      modeFlags: turn.modeFlags,
      ...delta,
      lastTokenUsage: turn.last,
      modelContextWindowTokens: turn.modelContextWindowTokens,
      usageSourceId: "codex-local",
      harnessId: "codex",
      source: "codex-local",
      sessionId,
      turnId: turn.turnId,
    },
  ];
});
return { records, rateLimits: latestRateLimits };
```

Change the declared return type to
`Promise<{ records: Array<Omit<UsageRecord, "sourceHostId">>; rateLimits: RateLimits | null }>`.

- [ ] **Step 4b: Cache rate limits per file and build the snapshot in collect**

The cached path (`prior?.fingerprint === fingerprint`) skips parsing, so rate limits must be stored in the per-file state alongside records or an unchanged file would silently drop its quota evidence.

Widen the `ImportState` file entry type:

```ts
type ImportState = {
  schemaVersion?: number;
  files?: Record<
    string,
    {
      fingerprint: string;
      records: Array<Omit<UsageRecord, "sourceHostId">>;
      rateLimits?: RateLimits | null;
    }
  >;
  home?: string;
};
```

Bump `CACHE_SCHEMA_VERSION` from `4` to `5` so existing caches re-parse once and pick up rate limits.

Then replace the body of the `for (const file of files)` loop and the return statement in `collect` with:

```ts
for (const file of files) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    continue;
  }
  const fingerprint = `${stat.size}:${stat.mtimeMs}`;
  const prior = state.schemaVersion === CACHE_SCHEMA_VERSION ? state.files?.[file] : undefined;
  let parsed: Array<Omit<UsageRecord, "sourceHostId">>;
  let rateLimits: RateLimits | null;
  if (prior?.fingerprint === fingerprint) {
    parsed = prior.records.map((record) => ({
      ...record,
      taskName: taskNames.get(record.sessionId ?? "") ?? record.taskName,
    }));
    rateLimits = prior.rateLimits ?? null;
  } else {
    const result = await parseSession(file, taskNames);
    parsed = result.records;
    rateLimits = result.rateLimits;
    parsedFiles += 1;
  }
  nextFiles[file] = { fingerprint, records: parsed, rateLimits };
  records.push(...parsed.map((record) => ({ ...record, sourceHostId })));
  const newest = parsed.at(-1)?.timestamp;
  if (rateLimits && newest && newest > latestObservedAt) {
    latestObservedAt = newest;
    latestRateLimits = rateLimits;
  }
}
const snapshot = quotaSnapshotFromRateLimits(
  latestRateLimits,
  sourceHostId,
  latestObservedAt || new Date().toISOString(),
);
return {
  records,
  quotaSnapshots: snapshot ? [snapshot] : [],
  state: {
    schemaVersion: CACHE_SCHEMA_VERSION,
    files: nextFiles,
    home,
    lastScan: new Date().toISOString(),
  },
  stats: { discoveredFiles: files.length, parsedFiles, records: records.length, home },
};
```

Declare the two trackers alongside `parsedFiles`, before the loop:

```ts
let latestRateLimits: RateLimits | null = null;
let latestObservedAt = "";
```

The newest snapshot wins because quota state is a point-in-time observation — the most recent turn's limits are the only ones still true.

- [ ] **Step 4c: Update the Task 1 tests for the new return shape**

Every call in `apps/server/test/codex-characterization.test.ts` of the form `await parseSession(session, taskNames)` now returns an object. Change each to:

```ts
const { records } = await parseSession(session, taskNames);
```

and leave the assertions on `records` unchanged.

Also rewrite the `it("applies the latest rate-limit snapshot to subsequent turns")` block that
Task 14 gutted. It asserted on a per-record `rateLimits` field that no longer exists; restore the
coverage in the shape the contract now uses — one file-level observation rather than a copy
stapled to every turn — plus a test that `"rateLimits" in records[0]` is now false and one that a
session which never reported limits yields `rateLimits: null`.

Two dead things fall out of this step and should go with it: the `rateLimits` field on the
internal `Turn` type (nothing reads it once the record stops carrying it) and the
`ParsedTurnRecord` alias, which becomes plain `ParsedRecord = Omit<UsageRecord, "sourceHostId">`.

- [ ] **Step 5: Persist snapshots on import**

In `apps/server/src/server.ts`, change the `importCodex` action body to:

```ts
    async importCodex(codexHome) {
      const result = await importer.collect(
        local.host.id,
        codexHome,
        ledger.importState(importer.id),
      );
      ledger.replaceQuotaSnapshots(result.quotaSnapshots);
      return ledger.commitProviderImport(importer.id, result.records, result.state);
    },
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/codex-characterization.test.ts`

Expected: PASS.

- [ ] **Step 6b: Cover `collect`, not just the converter (added during execution)**

The fixture directory doubles as a Codex home — `collect(sourceHostId, home, state)` reads it
read-only — so Step 4b's logic is directly testable. Add a `describe("Codex import quota
snapshots")` block asserting that `collect`:

1. produces exactly one snapshot, carrying the `sourceHostId` it was handed;
2. observes it at the newest turn that actually reported limits (the 07-21 fixture is newer and
   reports none — a file without quota evidence must be skipped, not treated as evidence that the
   quota is now unknown);
3. still returns the snapshot when every file is served from cache;
4. returns `[]` for a home with no sessions;
5. does not let an older archived session overwrite a newer reading.

(5) needs a new fixture, because nothing in the existing set can reach the recency guard. Create
`archived_sessions/2026/06/rollout-2026-06-15T08-00-00-bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jsonl`
reporting `plan_type: "pro"` at 5.5% / 9.75%. It is the oldest session present and, because
`collect` walks `sessions` and then `archived_sessions` with each sorted independently, also the
last one iterated — so under plain last-one-wins its stale reading replaces the live `plus` one and
the cockpit shows a months-old quota as current. Verify by deleting `newest > latestObservedAt`
from the condition: three tests fail with `actual: 'pro', expected: 'plus'`. Note the hazard in the
fixtures README.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/test
git commit -m "feat: convert Codex rate limits into normalized quota snapshots"
```

---

### Task 18: Serve quota snapshots in the overview

**Files:**

- Modify: `packages/usage-analysis/src/index.ts`
- Modify: `apps/server/src/server.ts:84-97`
- Test: `packages/usage-analysis/test/analysis.test.ts` (append)
- Test: `apps/server/test/quota-round-trip.test.ts` (created during execution, see Step 5b)

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`:

```ts
describe("Quota snapshots in the overview", () => {
  it("passes supplied snapshots through unchanged", () => {
    const snapshots = [
      {
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        plan: "plus",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
      },
    ];
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      quotaSnapshots: snapshots,
      filters: { timeframe: "all" },
    });
    assert.deepEqual(view.quotaSnapshots, snapshots);
  });

  it("defaults to no snapshots when none are supplied", () => {
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      filters: { timeframe: "all" },
    });
    assert.deepEqual(view.quotaSnapshots, []);
  });

  // Added during execution. Every other field on OverviewView is derived from
  // the FILTERED records, so "filter the snapshots too" is the natural-looking
  // next edit — and it is wrong. Quota is the account's standing with the
  // provider, not a property of the selected records: narrowing the period or
  // typing in the search box must not change what the meter reads, and a filter
  // matching nothing must not render as 0% used.
  it("reports quota unchanged regardless of the active filters", () => {
    const snapshots = [
      {
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        plan: "plus",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
      },
    ];
    const view = analyzeUsage({
      records: [],
      prices: [],
      sourceHosts: [],
      memberships: [],
      quotaSnapshots: snapshots,
      filters: { timeframe: "today", query: "matches-nothing", sourceHostId: "host:zzz" },
    });
    assert.equal(view.totals.records, 0);
    assert.deepEqual(view.quotaSnapshots, snapshots);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`

Expected: FAIL — `view.quotaSnapshots` is undefined.

- [ ] **Step 3: Thread snapshots through analysis**

In `packages/usage-analysis/src/index.ts`, add `quotaSnapshots?: UsageQuotaSnapshot[];` to `AnalysisInput` and import the type. Task 15 already renamed the returned property to `quotaSnapshots` and hardcoded `[]`; replace that placeholder — and the comment block above it, which is now spent — with:

```ts
    quotaSnapshots: input.quotaSnapshots ?? [],
```

- [ ] **Step 4: Supply them from the server**

In `apps/server/src/server.ts`, add `quotaSnapshots: ledger.quotaSnapshots(),` to the `analyzeUsage({ ... })` call in the `api/overview` route.

- [ ] **Step 5: Run the full suite**

Run: `vp run test && vp run typecheck`

Expected: PASS. `LimitsCard` in `legacy-views.tsx` was already migrated to `data.quotaSnapshots` in Task 15's Step 3b, so nothing further is needed there. Task 24 replaces it properly.

- [ ] **Step 5b: Test the seam Slice 3 just created (added during execution)**

Tasks 16, 17 and 18 each land in a different package and each is unit-tested inside it. Nothing
exercises the joins, and one of them can fail silently: `replaceQuotaSnapshots` validates through
`usageQuotaSnapshotSchema`, which is `.strict()`. If the Task 17 converter emits a field the
contract does not declare, every unit test still passes — the failure surfaces only when a real
import runs, as a thrown parse error behind the user's Refresh-sources button.

`apps/server` depends on contracts, usage-ledger and usage-analysis, so it is the right home for
this. Create `apps/server/test/quota-round-trip.test.ts` that runs
`CodexSessionProvider.collect` against the fixture home, feeds the result to
`ledger.replaceQuotaSnapshots`, reads it back with `ledger.quotaSnapshots()`, passes that to
`analyzeUsage`, and asserts the snapshot arrives intact.

Verify it is load-bearing by adding a stray key to the emitted window (e.g.
`limitName: limits.limitName`): all 20 importer unit tests still pass and only this one fails,
with `Unrecognized key: "limitName"`.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-analysis apps/server/src/server.ts apps/server/test/quota-round-trip.test.ts
git commit -m "feat: serve normalized quota snapshots from the overview endpoint"
```

Slice 3 is complete at this point. The quota path runs end to end: Codex rate limits → normalized
snapshot → ledger → `/api/overview`. The only consumer is still the legacy `LimitsCard`; Task 21
builds the real quota meter and Task 24 puts it on the Overview.

---

# Slice 4 — Overview cockpit

### Task 19: Rank list component

**Files:**

- Create: `apps/web/src/model/rank-scale.ts` (added during execution)
- Create: `apps/web/src/components/rank-list.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/test/rank-scale.test.ts` (added during execution)

- [ ] **Step 0: Put the arithmetic somewhere testable (added during execution)**

`.tsx` cannot be unit tested here, and everything that can actually go wrong in this component is
arithmetic rather than markup: an empty list, a zero or negative cap, and an all-unpriced period
that divides by zero. Extract it to `apps/web/src/model/rank-scale.ts` — `rankView(rows, limit)`
returning `{ shown, remaining, maximum }`, and `rankBarWidth(cost, maximum)` — with
`apps/web/test/rank-scale.test.ts` covering:

- the cap hides rows and `remaining` reports how many;
- `maximum` is 0 for an empty list, not `-Infinity` (`Math.max()` with no arguments);
- `rankBarWidth` returns 0 rather than `NaN` when nothing is priced — `width: NaN%` is an invalid
  declaration that the browser drops silently, so the bar keeps whatever width it last had;
- the width clamps to 0–100;
- a zero **and** a negative limit hide everything. Unclamped, `slice(0, -1)` means "all but the
  last", so a caller computing a limit arithmetically would quietly drop its smallest row.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/rank-list.tsx`. Two changes from the original draft, both
described below it:

```tsx
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatMoney } from "../model/format.ts";
import { rankBarWidth, rankView } from "../model/rank-scale.ts";

export function RankList({
  rows,
  limit = 4,
  onMore,
  emptyLabel = "No usage in this period",
}: {
  rows: RankedUsage[];
  limit?: number;
  onMore?: () => void;
  emptyLabel?: string;
}) {
  if (!rows.length) return <p className="empty-state">{emptyLabel}</p>;

  const { shown, remaining, maximum } = rankView(rows, limit);
  return (
    <>
      <ol className="rank-list">
        {shown.map((row) => (
          <li key={row.key}>
            <span className="rank-name" title={row.key}>
              {row.key}
            </span>
            <span className="rank-track" aria-hidden="true">
              <i style={{ width: `${rankBarWidth(row.estimatedCost, maximum)}%` }} />
            </span>
            <span className="rank-value">{formatMoney(row.estimatedCost)}</span>
          </li>
        ))}
      </ol>
      {remaining > 0 &&
        (onMore ? (
          <button type="button" className="link" onClick={onMore}>
            {remaining} more →
          </button>
        ) : (
          <p className="link link-static">{remaining} more</p>
        ))}
    </>
  );
}
```

**The empty check reads `rows.length`, not `shown.length`.** A list that has rows but shows none of
them is truncated, not empty; keying off `shown` renders "No usage in this period" over real usage.

**Truncation is disclosed whether or not there is a drill-down.** The original `remaining > 0 &&
onMore` renders nothing when no handler is passed — and Task 24 has exactly such a call site:
`<RankList rows={data.bySourceHost} limit={5} />`. A reader with eight hosts would see five and no
indication the other three exist. The static variant says so without pretending to be an action.

`type="button"` matches the three buttons already in `app.tsx`; without it a button inside any
future `<form>` defaults to submit.

- [ ] **Step 2: Add the styles**

Insert these **before** the `@media` blocks at the end of `apps/web/src/styles.css`, not at EOF.
Appending after them puts base rules later in the cascade than the responsive overrides, so any
future media-query rule for these classes would lose to its own base rule at equal specificity.
The same applies to every later task in this plan that says "append to `styles.css`".

```css
.rank-list {
  display: grid;
  gap: 7px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.rank-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1.1fr 52px;
  gap: 9px;
  align-items: center;
  font-size: var(--size-meta);
}
.rank-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rank-track {
  height: 8px;
  background: var(--track);
  border-radius: 0 4px 4px 0;
  overflow: hidden;
}
.rank-track i {
  display: block;
  height: 100%;
  background: var(--series-1);
  border-radius: 0 4px 4px 0;
}
.rank-value {
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.link {
  margin-top: 8px;
  padding: 0;
  color: var(--muted);
  font-size: var(--size-meta);
}
.link:hover {
  color: var(--ink);
}
/* Truncation disclosed with no drill-down to offer: same voice as the button,
   but not focusable and with no hover affordance, so it never reads as an
   action that does nothing when clicked. */
.link-static {
  margin-bottom: 0;
}
.link-static:hover {
  color: var(--muted);
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `vp run check` (the extracted module has tests now, so the full gate applies)

```bash
git add apps/web/src/components/rank-list.tsx apps/web/src/model/rank-scale.ts \
  apps/web/test/rank-scale.test.ts apps/web/src/styles.css
git commit -m "feat: add single-hue rank list component"
```

---

### Task 20: Token mix stacked bar

**Files:**

- Create: `apps/web/src/model/token-mix.ts` (added during execution)
- Create: `apps/web/src/components/token-mix.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/test/token-mix.test.ts` (added during execution)

> **`fresh = inputTokens - cachedInputTokens` mixes two populations.** `summarize`
> accumulates `cachedInputTokens` over only the records that reported caching, while
> `inputTokens` covers every record. The difference therefore sweeps a silent source's entire
> input into a segment labelled "Fresh input" — a measurement claim the data does not support,
> and the same unavailable-is-not-zero error `cacheEfficiency` was fixed for in Task 12. It is
> worse here, because a labelled chart segment reads as a measurement rather than a ratio.
>
> `cacheReportingInputTokens` exists precisely for this. Step 0 uses it and gives the
> unaccounted-for input its own segment.

- [ ] **Step 0: Put the arithmetic somewhere testable (added during execution)**

Create `apps/web/src/model/token-mix.ts` exporting `tokenMixSegments(totals)` →
`Array<{ key, tokens, percent }>`, with `apps/web/test/token-mix.test.ts` covering it. Two rules:

**Segment on the reporting population.** `fresh` is `cacheReportingInputTokens - cachedInputTokens`;
the remainder, `inputTokens - cacheReportingInputTokens`, becomes a fourth `unreported` segment.
Today Codex reports caching on every record so that segment is 0 and the bar looks unchanged — it
becomes non-zero the moment a source that does not report caching lands, which is the point of the
multi-harness work. Clamp every segment at 0 so no arithmetic surprise can produce a negative width.

**Allocate the displayed percentages by largest remainder.** Rounding each share independently
gives 33/33/33 = 99% for an even three-way split, and a "Token mix" panel whose parts visibly fail
to make a whole undermines every number around it. A segment with zero tokens can never be bumped
to 1%: the leftover to distribute is always smaller than the count of segments with a fractional
part.

`TokenMixKey` derives from `TOKEN_MIX_ORDER` rather than restating the keys, so the palette stays
the single source of stacking order and this task remains its consumer.

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/token-mix.tsx` as a thin renderer over that module:

```tsx
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { CHART_INK, TOKEN_MIX } from "../theme/palette.ts";
import { formatTokens } from "../model/format.ts";
import { tokenMixSegments, type TokenMixKey } from "../model/token-mix.ts";

const SEGMENTS: Record<TokenMixKey, { label: string; color: string }> = {
  ...TOKEN_MIX,
  unreported: { label: "Cache not reported", color: CHART_INK.track },
};

export function TokenMix({ totals }: { totals: UsageTotals }) {
  const segments = tokenMixSegments(totals);
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (!total) return <p className="empty-state">No tokens in this period</p>;

  const drawn = segments.filter((segment) => segment.tokens > 0);
  const listed = segments.filter((segment) => segment.key !== "unreported" || segment.tokens > 0);

  return (
    <>
      <div className="stack" role="img" aria-label="Token composition">
        {drawn.map((segment) => (
          <span
            key={segment.key}
            style={{
              width: `${(segment.tokens / total) * 100}%`,
              background: SEGMENTS[segment.key].color,
            }}
          />
        ))}
      </div>
      <ul className="legend">
        {listed.map((segment) => (
          <li key={segment.key}>
            <i className="dot" style={{ background: SEGMENTS[segment.key].color }} />
            <span>{SEGMENTS[segment.key].label}</span>
            <span className="legend-count">{formatTokens(segment.tokens)}</span>
            <span className="legend-share">{`${segment.percent}%`}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
```

**`unreported` borrows the track colour, not a fourth series slot.** It is an absence, not a
category: a data hue would put it in the same visual language as measured values, and the three
series colours are validated as a categorical set that a fourth would change — which would also
mean a new row in the `tokens.css`/`palette.ts` agreement table. `CHART_INK.track` is already
twinned and already means "empty".

**Zero-token segments are dropped from the bar but kept in the legend.** A zero-width flex child
still draws its 2px gap, leaving a stray seam. The legend row is informative in a way the bar
segment is not — "Cached 0" says caching was measured and found none. The `unreported` row is the
exception, listed only when non-zero: otherwise it is noise disclosing nothing.

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.stack {
  display: flex;
  height: 15px;
  gap: 2px;
  border-radius: 4px;
  overflow: hidden;
  margin-top: 8px;
}
.legend {
  display: grid;
  gap: 6px;
  margin: 9px 0 0;
  padding: 0;
  list-style: none;
  font-size: var(--size-meta);
}
.legend li {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto 34px;
  gap: 8px;
  align-items: center;
}
.dot {
  width: 9px;
  height: 9px;
  border-radius: 2px;
}
.legend-count {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.legend-share {
  text-align: right;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}
```

The 2px `gap` on `.stack` is the surface gap between fills. Do not replace it with a border.
Insert these before the `@media` blocks, not at EOF — see Task 19 Step 2.

- [ ] **Step 3: Typecheck and commit**

Run: `vp run check`

```bash
git add apps/web/src/components/token-mix.tsx apps/web/src/model/token-mix.ts \
  apps/web/test/token-mix.test.ts apps/web/src/styles.css
git commit -m "feat: replace token composition donut with a stacked bar"
```

---

### Task 21: Quota meter component

**Files:**

- Create: `apps/web/src/components/quota-meters.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/quota-meters.tsx`:

```tsx
import type { UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { quotaStatus, type QuotaStatus } from "../model/format.ts";

const GLYPH: Record<QuotaStatus, string> = {
  good: "",
  warning: "⚠",
  critical: "⚠",
  unreported: "",
};
const FILL: Record<QuotaStatus, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
  unreported: "transparent",
};

export function QuotaMeters({
  snapshots,
  harnessLabel,
}: {
  snapshots: UsageQuotaSnapshot[];
  harnessLabel: (usageSourceId: string) => string;
}) {
  if (!snapshots.length) return <p className="empty-state">Not reported</p>;
  return (
    <div className="quota-groups">
      {snapshots.map((snapshot) => (
        <div className="quota-group" key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}>
          <p className="quota-source">
            {harnessLabel(snapshot.usageSourceId)}
            {snapshot.plan ? ` · ${snapshot.plan}` : ""}
          </p>
          {snapshot.windows.map((window) => {
            const status = quotaStatus(window.usedPercent);
            return (
              <div className="quota-window" key={window.id}>
                <p className="quota-head">
                  <b>{window.label}</b>
                  <span className={`quota-value ${status}`}>
                    {status === "unreported"
                      ? "Not reported"
                      : `${GLYPH[status]} ${window.usedPercent!.toFixed(0)}%`.trim()}
                  </span>
                </p>
                {status !== "unreported" && (
                  <div
                    className="meter"
                    role="meter"
                    aria-valuenow={Math.round(window.usedPercent!)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${window.label} used`}
                  >
                    <i
                      style={{
                        width: `${Math.min(100, window.usedPercent!)}%`,
                        background: FILL[status],
                      }}
                    />
                  </div>
                )}
                {window.resetsAt && (
                  <p className="quota-reset">resets {new Date(window.resetsAt).toLocaleString()}</p>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.quota-groups {
  display: grid;
  gap: 11px;
}
.quota-group + .quota-group {
  padding-top: 9px;
  border-top: 1px solid var(--line);
}
.quota-source {
  margin: 0 0 5px;
  color: var(--muted);
  font-size: var(--size-meta);
}
.quota-window + .quota-window {
  margin-top: 11px;
}
.quota-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin: 0 0 4px;
  font-size: var(--size-meta);
}
.quota-head b {
  font-weight: 550;
}
.quota-value {
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.quota-value.warning {
  color: var(--status-warning);
}
.quota-value.critical {
  color: var(--status-critical);
}
.quota-value.unreported {
  color: var(--muted);
  font-weight: 400;
}
.meter {
  height: 8px;
  border-radius: 99px;
  background: var(--track);
  overflow: hidden;
}
.meter i {
  display: block;
  height: 100%;
  border-radius: 99px;
}
.quota-reset {
  margin: 3px 0 0;
  color: var(--muted);
  font-size: var(--size-meta);
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `vp run typecheck`

```bash
git add apps/web/src/components/quota-meters.tsx apps/web/src/styles.css
git commit -m "feat: replace progress bars with status-aware quota meters"
```

---

### Task 22: Headline and trend chart

**Files:**

- Create: `apps/web/src/components/headline.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/headline.tsx`:

```tsx
import { useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverviewView } from "@llm-usage-monitor/contracts";
import { CHART_INK, SERIES } from "../theme/palette.ts";
import { formatCoverage, formatMoney, formatTokens } from "../model/format.ts";

type Measure = "cost" | "tokens";

const TIMEFRAME_LABEL: Record<string, string> = {
  today: "today",
  last24: "last 24 hours",
  "7": "last 7 days",
  "30": "last 30 days",
  "90": "last 90 days",
  all: "all retained history",
  custom: "the selected range",
};

export function Headline({ data }: { data: OverviewView }) {
  const [measure, setMeasure] = useState<Measure>("cost");
  const period = TIMEFRAME_LABEL[data.filters.timeframe] ?? "the selected range";
  const key = measure === "cost" ? "estimatedCost" : "totalTokens";
  const format = measure === "cost" ? formatMoney : formatTokens;
  return (
    <section className="panel headline">
      <div className="headline-head">
        <div>
          <p className="panel-label">API-equivalent cost of work · {period}</p>
          <p className="hero">{formatMoney(data.totals.estimatedCost)}</p>
          <p className="panel-label">
            {formatCoverage({
              records: data.totals.records,
              priced: data.totals.pricedRecords,
            })}{" "}
            · estimated at your configured API rates, not a bill
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Trend measure">
          {(["cost", "tokens"] as Measure[]).map((item) => (
            <button
              key={item}
              className={measure === item ? "on" : ""}
              aria-pressed={measure === item}
              onClick={() => setMeasure(item)}
            >
              {item === "cost" ? "Cost" : "Tokens"}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={168}>
        <AreaChart data={data.timeline} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortDate}
            stroke={CHART_INK.axis}
            tick={{ fill: CHART_INK.muted, fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value) => format(Number(value))}
            stroke={CHART_INK.axis}
            tick={{ fill: CHART_INK.muted, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value) => format(Number(value))}
            labelFormatter={shortDate}
            contentStyle={{
              background: "#0b120f",
              border: "1px solid #2b3831",
              borderRadius: 7,
              fontSize: 11,
            }}
          />
          <Area
            type="monotone"
            dataKey={key}
            stroke={SERIES.teal}
            strokeWidth={2}
            fill={SERIES.teal}
            fillOpacity={0.13}
            name={measure === "cost" ? "Estimated cost" : "Tokens"}
            activeDot={{ r: 4.5, strokeWidth: 2, stroke: "#151e1a" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}

function shortDate(value: string): string {
  return value.length > 10 ? value.slice(5, 13).replace("T", " ") : value.slice(5);
}
```

A single series carries no legend — the panel label names it. There is exactly one Y axis; the measure toggle swaps which measure it scales to.

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.headline-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.hero {
  margin: 5px 0 3px;
  font-size: var(--size-hero);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.02;
  color: var(--accent);
}
/*
 * Worn by two different elements: the <h3> a Panel renders for its label, and the
 * <p> the headline uses for descriptive lines. The font-weight and margin resets
 * exist so both render identically — without them the <h3> inherits browser-default
 * bold and vertical margins and the two drift apart visually.
 */
.panel-label {
  margin: 0;
  color: var(--muted);
  font-size: var(--size-meta);
  font-weight: 400;
}
.panel-meta {
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.segmented {
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  overflow: hidden;
}
.segmented button {
  min-height: 0;
  padding: 3px 10px;
  border-radius: 0;
  color: var(--muted);
  font-size: var(--size-meta);
}
.segmented button.on {
  background: var(--raised);
  color: var(--ink-strong);
  font-weight: 600;
}
```

Note the absence of `tabular-nums` on `.hero` — proportional figures are correct at display size.

- [ ] **Step 3: Typecheck and commit**

Run: `vp run typecheck`

```bash
git add apps/web/src/components/headline.tsx apps/web/src/styles.css
git commit -m "feat: add headline figure and single-axis trend chart with measure toggle"
```

---

### Task 23: Stat strip

**Files:**

- Create: `apps/web/src/components/stat-strip.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/stat-strip.tsx`:

```tsx
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { formatPercent, formatTokens } from "../model/format.ts";

export function StatStrip({ totals }: { totals: UsageTotals }) {
  // Coverage is disclosed in TOKENS, not records, because cacheEfficiency is
  // token-weighted. A few large calls that do not report caching can dominate token
  // volume while looking negligible as a record count, so "of 6,400 records" could
  // imply the ratio covers far more usage than it does.
  const partialCacheCoverage =
    totals.cacheReportingInputTokens > 0 && totals.cacheReportingInputTokens < totals.inputTokens;
  const stats = [
    { label: "Tokens", value: formatTokens(totals.totalTokens), note: "" },
    {
      label: "Cached input",
      value: totals.cacheReportingRecords ? formatPercent(totals.cacheEfficiency) : "Not reported",
      note: partialCacheCoverage
        ? `of ${formatTokens(totals.cacheReportingInputTokens)} reporting tokens`
        : "",
    },
    { label: "Tasks", value: String(totals.tasks), note: "" },
    { label: "Models", value: String(totals.models), note: "" },
  ];
  return (
    <section className="panel strip">
      {stats.map((stat) => (
        <div key={stat.label}>
          <p className="panel-label">{stat.label}</p>
          <p className="stat">{stat.value}</p>
          {stat.note && <p className="panel-label">{stat.note}</p>}
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.strip {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
}
.strip > div {
  padding: 0 12px;
  border-left: 1px solid var(--line);
}
.strip > div:first-child {
  border-left: 0;
  padding-left: 0;
}
.stat {
  margin: 2px 0 0;
  font-size: var(--size-stat);
  font-weight: 650;
  letter-spacing: -0.02em;
}
```

- [ ] **Step 3: Typecheck and commit**

Run: `vp run typecheck`

```bash
git add apps/web/src/components/stat-strip.tsx apps/web/src/styles.css
git commit -m "feat: add stat strip with cache coverage disclosure"
```

---

### Task 24: Assemble the Overview

**Files:**

- Create: `apps/web/src/model/harness.ts`
- Create: `apps/web/test/harness.test.ts`
- Create: `apps/web/src/views/overview.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 0: Give harness ids a display label**

`byHarness` rows carry raw ids — `codex`, `claude-code`, and `unknown` for a source that is not registered (see `harnessForSource` in `packages/contracts/src/legacy.ts`). Rendering `row.key` directly puts bare lowercase tokens in a panel beside proper nouns, and shows `unknown` as though it were a harness someone installed.

The spec's rule is that missing data renders as explicitly missing — "Not reported", capitalised and phrased — never a raw token. That rule governs presentation here too, not only semantics.

Note the `HARNESS_LABELS` map in Step 1 is a different thing: it is keyed by `usageSourceId` and feeds the quota meters. This one is keyed by `harnessId`. Do not conflate them.

Create `apps/web/src/model/harness.ts`:

```ts
const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

/**
 * Display label for a harness id. An id we do not recognise — including the
 * "unknown" sentinel a legacy or unregistered usage source decodes to — renders as
 * "Unknown harness" rather than a bare token, so it reads as a state rather than as
 * the name of something the user installed.
 */
export function harnessLabel(harnessId: string): string {
  return HARNESS_LABELS[harnessId] ?? (harnessId === "unknown" ? "Unknown harness" : harnessId);
}

/** True when the id is not a harness we know how to name. Callers style these apart. */
export function isUnknownHarness(harnessId: string): boolean {
  return !(harnessId in HARNESS_LABELS);
}
```

Create `apps/web/test/harness.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { harnessLabel, isUnknownHarness } from "../src/model/harness.ts";

describe("Harness labels", () => {
  it("names the harnesses it knows", () => {
    assert.equal(harnessLabel("codex"), "Codex");
    assert.equal(harnessLabel("claude-code"), "Claude Code");
  });

  it("renders the unknown sentinel as a state, not a name", () => {
    assert.equal(harnessLabel("unknown"), "Unknown harness");
  });

  it("passes an unrecognised id through rather than inventing a name", () => {
    assert.equal(harnessLabel("windsurf"), "windsurf");
  });

  it("flags anything it cannot name so callers can style it apart", () => {
    assert.equal(isUnknownHarness("codex"), false);
    assert.equal(isUnknownHarness("claude-code"), false);
    assert.equal(isUnknownHarness("unknown"), true);
    assert.equal(isUnknownHarness("windsurf"), true);
  });
});
```

Relabel the harness rows in the view rather than teaching `RankList` about harnesses:

```tsx
<Panel label="By harness">
  <RankList
    rows={data.byHarness.map((row) => ({ ...row, key: harnessLabel(row.key) }))}
    onMore={() => onDrillDown("byHarness")}
  />
</Panel>
```

Task 27's Breakdown must do the same for its `Harness → Model` grouping.

- [ ] **Step 1: Write the view**

Create `apps/web/src/views/overview.tsx`:

```tsx
import type { OverviewView } from "@llm-usage-monitor/contracts";
import { formatTokens } from "../model/format.ts";
import { Headline } from "../components/headline.tsx";
import { Panel, Zone } from "../components/panel.tsx";
import { QuotaMeters } from "../components/quota-meters.tsx";
import { RankList } from "../components/rank-list.tsx";
import { StatStrip } from "../components/stat-strip.tsx";
import { TokenMix } from "../components/token-mix.tsx";

const HARNESS_LABELS: Record<string, string> = {
  "codex-local": "Codex",
  "claude-code-local": "Claude Code",
};

export function Overview({
  data,
  onDrillDown,
}: {
  data: OverviewView;
  onDrillDown: (dimension: "byHarness" | "byModel" | "byTask") => void;
}) {
  return (
    <div className="cockpit">
      <div className="cockpit-main">
        <Headline data={data} />
        <StatStrip totals={data.totals} />
        <Zone>What drove it</Zone>
        <div className="drivers">
          <Panel label="By harness">
            <RankList rows={data.byHarness} onMore={() => onDrillDown("byHarness")} />
          </Panel>
          <Panel label="By model">
            <RankList rows={data.byModel} onMore={() => onDrillDown("byModel")} />
          </Panel>
          <Panel label="By task">
            <RankList rows={data.byTask} onMore={() => onDrillDown("byTask")} />
          </Panel>
        </div>
      </div>
      <div className="cockpit-rail">
        <Zone>Context</Zone>
        <Panel label="Token mix" meta={formatTokens(data.totals.totalTokens)}>
          <TokenMix totals={data.totals} />
        </Panel>
        <Panel label="Plan limits">
          <QuotaMeters
            snapshots={data.quotaSnapshots}
            harnessLabel={(id) => HARNESS_LABELS[id] ?? id}
          />
        </Panel>
        <Panel label="Hosts">
          <RankList rows={data.bySourceHost} limit={5} />
        </Panel>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the layout styles**

Append to `apps/web/src/styles.css`:

```css
.cockpit {
  display: grid;
  grid-template-columns: minmax(0, 1fr) var(--rail);
  gap: var(--gap);
}
.cockpit-main,
.cockpit-rail {
  display: grid;
  gap: var(--gap);
  align-content: start;
  min-width: 0;
}
.drivers {
  display: grid;
  grid-template-columns: 0.82fr 1fr 1fr;
  gap: var(--gap);
}
.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
  background: var(--panel);
  padding: var(--pad-panel);
}
.zone {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0;
  font-size: var(--size-zone);
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
  color: var(--muted);
}
.zone::after {
  content: "";
  height: 1px;
  flex: 1;
  background: var(--line);
}

@media (max-width: 1180px) {
  .cockpit {
    grid-template-columns: minmax(0, 1fr);
  }
  .cockpit-rail {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .cockpit-rail .zone {
    grid-column: 1 / -1;
  }
}
@media (max-width: 860px) {
  .drivers,
  .cockpit-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .drivers,
  .cockpit-rail {
    grid-template-columns: minmax(0, 1fr);
  }
  .topbar {
    flex-wrap: wrap;
  }
  .chips {
    width: 100%;
    margin-left: 0;
    flex-wrap: wrap;
  }
  .strip {
    grid-template-columns: repeat(2, 1fr);
    gap: 9px;
  }
}
```

- [ ] **Step 3: Wire it into the shell**

In `apps/web/src/app.tsx`, replace the `Overview` import in `ViewSlot` with `import { Overview } from "./views/overview.tsx";` and update the branch to:

```tsx
if (view === "overview")
  return overview ? <Overview data={overview} onDrillDown={onDrillDown} /> : null;
```

Add an `onDrillDown` prop to `ViewSlot` and pass it from `App`:

```tsx
const [breakdownDimension, setBreakdownDimension] = useState<
  "byHarness" | "byModel" | "byTask" | "bySourceHost" | "byHostGroup"
>("byModel");
const onDrillDown = (dimension: "byHarness" | "byModel" | "byTask") => {
  setBreakdownDimension(dimension);
  setView("breakdown");
};
```

- [ ] **Step 4: Verify in the browser**

Run: `vp run dev`

Open the printed dashboard URL. Confirm: the headline reads as a single figure, the trend chart shows its x-axis labels without an inner scrollbar, toggling Cost/Tokens rescales the Y axis, and the rail shows token mix, quota meters, and hosts.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: assemble the Overview cockpit"
```

---

### Task 25: Delete the legacy Overview

**Files:**

- Modify: `apps/web/src/legacy-views.tsx`

- [ ] **Step 1: Remove the replaced components**

Delete `Overview`, `Metric`, `LimitsCard`, and the now-unused `colors` constant from `apps/web/src/legacy-views.tsx`. Keep `History`, `Advanced`, `Pricing`, `ModelRollups`, `ModeBadges`, `HistorySessionTable`, and the shared helpers — Slice 5 replaces those.

- [ ] **Step 2: Remove the replaced styles**

Delete the `.metrics`, `.metric`, `.chart-grid`, `.card`, `.ranks`, `.rank`, `.rank-label`, `.rank i`, `.rank b`, `.limit-list`, and `progress` rule blocks from `apps/web/src/styles.css`, plus their `@media` entries.

- [ ] **Step 3: Verify**

Run: `vp run check`

Expected: PASS across format, lint, typecheck, test, and build.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "refactor: delete the legacy Overview and its styles"
```

---

# Slice 5 — Breakdown and History

### Task 26: Nested rollup component

**Files:**

- Create: `apps/web/src/components/rollup.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/test/rollup-scale.test.ts`

- [ ] **Step 1: Write the failing test**

The one piece of rollup logic worth testing in isolation is that a child bar scales to its parent, not to the grand total.

The test suite runs under `node --experimental-strip-types`, which strips TypeScript annotations but **cannot parse JSX**. A test may therefore never import a `.tsx` file. `shareOfParent` lives in a plain `.ts` module for exactly this reason.

Create `apps/web/test/rollup-scale.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareOfParent } from "../src/model/rollup-scale.ts";

describe("Rollup bar scaling", () => {
  it("scales a child against its largest sibling, not the grand total", () => {
    assert.equal(shareOfParent(25, [25, 50]), 50);
    assert.equal(shareOfParent(50, [25, 50]), 100);
  });

  it("returns zero width when every sibling is zero", () => {
    assert.equal(shareOfParent(0, [0, 0]), 0);
  });

  it("returns zero width when there are no siblings", () => {
    assert.equal(shareOfParent(10, []), 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/rollup-scale.test.ts`

Expected: FAIL — `Cannot find module '../src/model/rollup-scale.ts'`

- [ ] **Step 3: Write the scaling rule**

Create `apps/web/src/model/rollup-scale.ts`:

```ts
/**
 * Width percentage for a row's bar, relative to its largest sibling — never to
 * the grand total, so a child bar cannot imply a share of the whole.
 */
export function shareOfParent(value: number, siblings: number[]): number {
  const maximum = Math.max(0, ...siblings);
  return maximum > 0 ? (value / maximum) * 100 : 0;
}
```

- [ ] **Step 4: Write the component**

Create `apps/web/src/components/rollup.tsx`:

```tsx
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatMoney, formatTokens } from "../model/format.ts";
import { shareOfParent } from "../model/rollup-scale.ts";

export function Rollup({
  rows,
  depth = 0,
  defaultOpenFirst = true,
}: {
  rows: RankedUsage[];
  depth?: number;
  defaultOpenFirst?: boolean;
}) {
  const siblings = rows.map((row) => row.estimatedCost);
  return (
    <>
      {rows.map((row, index) => {
        const bar = (
          <span className="rank-track" aria-hidden="true">
            <i style={{ width: `${shareOfParent(row.estimatedCost, siblings)}%` }} />
          </span>
        );
        const metrics = (
          <>
            <span className="rollup-tokens">{formatTokens(row.totalTokens)}</span>
            <span className="rank-value">{formatMoney(row.estimatedCost)}</span>
          </>
        );
        if (!row.children?.length) {
          return (
            <div className={`rollup-row depth-${depth}`} key={row.key}>
              <span className="rank-name" title={row.key}>
                {row.key}
              </span>
              {bar}
              {metrics}
            </div>
          );
        }
        return (
          <details
            className={`rollup depth-${depth}`}
            key={row.key}
            open={defaultOpenFirst && index === 0}
          >
            <summary>
              <span className="rank-name" title={row.key}>
                {row.key}
              </span>
              {bar}
              {metrics}
            </summary>
            <Rollup rows={row.children} depth={depth + 1} defaultOpenFirst={false} />
          </details>
        );
      })}
    </>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/rollup-scale.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 6: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.rollup-row,
.rollup > summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 1fr 96px 74px;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--grid);
  font-size: var(--size-meta);
}
.rollup > summary {
  cursor: pointer;
  list-style: none;
  background: #131c18;
  border-bottom: 1px solid var(--line);
}
.rollup > summary::-webkit-details-marker {
  display: none;
}
.rollup > summary::before {
  content: "▸";
  color: var(--muted);
  margin-right: -6px;
}
.rollup[open] > summary::before {
  content: "▾";
}
.rollup.depth-1 > summary,
.rollup-row.depth-1 {
  padding-left: 30px;
}
.rollup.depth-2 > summary,
.rollup-row.depth-2 {
  padding-left: 57px;
}
.rollup-tokens {
  text-align: right;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/rollup.tsx apps/web/src/model/rollup-scale.ts apps/web/src/styles.css apps/web/test/rollup-scale.test.ts
git commit -m "feat: add nested rollup with parent-relative bar scaling"
```

---

### Task 27: Breakdown view

**Files:**

- Create: `apps/web/src/views/breakdown.tsx`
- Modify: `apps/web/src/app.tsx`

- [ ] **Step 1: Write the view**

Create `apps/web/src/views/breakdown.tsx`:

```tsx
import { useState } from "react";
import type { OverviewView, RankedUsage } from "@llm-usage-monitor/contracts";
import { Rollup } from "../components/rollup.tsx";
import { formatMoney, formatTokens } from "../model/format.ts";

export type Dimension = "byHarness" | "byModel" | "byTask" | "bySourceHost" | "byHostGroup";

const DIMENSIONS: Array<{ value: Dimension; label: string }> = [
  { value: "byHarness", label: "Harness" },
  { value: "byModel", label: "Model → Reasoning" },
  { value: "byTask", label: "Task → Session" },
  { value: "bySourceHost", label: "Host" },
  { value: "byHostGroup", label: "Host Group" },
];

export function Breakdown({
  data,
  dimension,
  onDimensionChange,
}: {
  data: OverviewView;
  dimension: Dimension;
  onDimensionChange: (value: Dimension) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  const rows = data[dimension];
  return (
    <section className="breakdown">
      <div className="group-by">
        <span className="panel-label">Group by</span>
        {DIMENSIONS.map((item) => (
          <button
            key={item.value}
            className={`chip ${dimension === item.value ? "on" : ""}`}
            aria-pressed={dimension === item.value}
            onClick={() => onDimensionChange(item.value)}
          >
            {item.label}
          </button>
        ))}
        <button
          className="chip table-toggle"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          ⊞ Table view
        </button>
      </div>
      <div className="panel breakdown-body">
        {rows.length === 0 ? (
          <p className="empty-state">No usage matches the current filters.</p>
        ) : asTable ? (
          <BreakdownTable rows={rows} />
        ) : (
          <Rollup rows={rows} />
        )}
      </div>
    </section>
  );
}

function BreakdownTable({ rows }: { rows: RankedUsage[] }) {
  const flat = rows.flatMap((row) => [
    { depth: 0, row },
    ...(row.children ?? []).flatMap((child) => [
      { depth: 1, row: child },
      ...(child.children ?? []).map((leaf) => ({ depth: 2, row: leaf })),
    ]),
  ]);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Group</th>
          <th className="n">Records</th>
          <th className="n">Tokens</th>
          <th className="n">Cost</th>
        </tr>
      </thead>
      <tbody>
        {flat.map(({ depth, row }) => (
          <tr key={`${depth}/${row.key}`}>
            <td style={{ paddingLeft: `${10 + depth * 20}px` }}>{row.key}</td>
            <td className="n">{row.records.toLocaleString()}</td>
            <td className="n">{formatTokens(row.totalTokens)}</td>
            <td className="n">{formatMoney(row.estimatedCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.breakdown {
  display: grid;
  gap: 10px;
}
.group-by {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.group-by .chip {
  cursor: pointer;
  color: var(--ink);
}
.group-by .chip.on {
  border-color: #2f6a52;
  background: #12241d;
}
.table-toggle {
  margin-left: auto;
}
.breakdown-body {
  padding: 0;
  overflow: hidden;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--size-meta);
}
.data-table th {
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--size-zone);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
.data-table td {
  padding: 6px 10px;
  border-bottom: 1px solid var(--grid);
  white-space: nowrap;
}
.data-table .n {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.data-table tbody tr:last-child td {
  border-bottom: 0;
}
```

- [ ] **Step 3: Wire it in**

In `apps/web/src/app.tsx`, import `Breakdown` and its `Dimension` type, and replace the breakdown branch in `ViewSlot`:

```tsx
if (view === "breakdown")
  return overview ? (
    <Breakdown
      data={overview}
      dimension={breakdownDimension}
      onDimensionChange={setBreakdownDimension}
    />
  ) : null;
```

Pass `breakdownDimension` and `setBreakdownDimension` into `ViewSlot` as props.

- [ ] **Step 4: Verify**

Run: `vp run typecheck && vp run dev`

Confirm each group-by chip re-renders, nested levels expand, and Table view lists the same numbers with no bars.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat: rebuild Breakdown with chip group-by, nesting, and a table view"
```

---

### Task 28: History view with harness column

**Files:**

- Create: `apps/web/src/views/history.tsx`
- Modify: `apps/web/src/model/usage-groups.ts`
- Modify: `apps/web/src/app.tsx`
- Test: `apps/web/test/usage-groups.test.ts` (append)

- [ ] **Step 1: Move the grouping helpers**

Run: `git mv apps/web/src/usage-groups.ts apps/web/src/model/usage-groups.ts`

Update the import path in `apps/web/test/usage-groups.test.ts` to `../src/model/usage-groups.ts`.

- [ ] **Step 2: Write the failing test**

Append to `apps/web/test/usage-groups.test.ts`:

```ts
describe("Session harness attribution", () => {
  const base = {
    id: "a",
    usageSourceId: "codex-local",
    harnessId: "codex",
    timestamp: "2026-07-20T09:00:00.000Z",
    taskName: "portable-usage-host",
    provider: "openai",
    model: "gpt-5-codex",
    reasoningLevel: "high",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 10,
    cachedInputTokens: 4,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    totalTokens: 12,
    lastTokenUsage: null,
    modelContextWindowTokens: 400_000,
    source: "codex-local",
    sessionId: "session-1",
    sourceHostLabel: "workstation",
    estimatedCost: 1,
  };

  it("collects the harnesses that contributed to a session", () => {
    const [group] = groupHistoryByTask([
      base,
      { ...base, id: "b", harnessId: "claude-code", usageSourceId: "claude-code-local" },
    ]);
    assert.deepEqual(group?.sessions[0]?.harnesses, ["codex", "claude-code"]);
  });

  it("labels a missing reasoning level as not reported", () => {
    const [group] = groupHistoryByTask([{ ...base, reasoningLevel: undefined }]);
    assert.deepEqual(group?.sessions[0]?.reasoningLevels, ["not reported"]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/usage-groups.test.ts`

Expected: FAIL — `harnesses` is undefined.

- [ ] **Step 4: Extend the grouping**

In `apps/web/src/model/usage-groups.ts`, add `harnesses: string[];` to the `HistorySession` interface. In `groupSessions`, add:

```ts
        harnesses: unique(sorted.map((record) => record.harnessId)),
```

and change the reasoning line to:

```ts
        reasoningLevels: unique(sorted.map((record) => record.reasoningLevel ?? "not reported")),
```

Delete the `plans` field and its `unique(...)` expression — that data now lives in quota snapshots, not on records.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/usage-groups.test.ts`

Expected: PASS.

- [ ] **Step 6: Write the view**

Create `apps/web/src/views/history.tsx`:

```tsx
import { useMemo } from "react";
import type { UsageHistoryRecord } from "@llm-usage-monitor/contracts";
import { Zone } from "../components/panel.tsx";
import { SERIES } from "../theme/palette.ts";
import { formatMoney, formatTokens } from "../model/format.ts";
import { groupHistoryByTask, type HistorySession } from "../model/usage-groups.ts";

const HARNESS_COLOR: Record<string, string> = {
  codex: SERIES.teal,
  "claude-code": SERIES.blue,
};

export function History({ records }: { records: UsageHistoryRecord[] }) {
  const groups = useMemo(() => groupHistoryByTask(records), [records]);
  const sessions = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  if (!groups.length) return <p className="empty-state">No usage history matches the filters.</p>;
  return (
    <section className="history">
      <Zone>
        {groups.length} tasks · {sessions} sessions · {records.length} records
      </Zone>
      <div className="panel breakdown-body">
        {groups.map((group, index) => (
          <details className="rollup" key={group.key} open={index === 0}>
            <summary>
              <span className="rank-name" title={group.label}>
                {group.label}
              </span>
              <span className="rollup-tokens">
                {group.sessions.length} sessions · {formatTokens(group.totalTokens)}
              </span>
              <span className="rollup-tokens">{new Date(group.lastActiveAt).toLocaleString()}</span>
              <span className="rank-value">
                {group.estimatedCost === null ? "Unpriced" : formatMoney(group.estimatedCost)}
              </span>
            </summary>
            <SessionTable sessions={group.sessions} />
          </details>
        ))}
      </div>
    </section>
  );
}

function SessionTable({ sessions }: { sessions: HistorySession[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Last active</th>
          <th>Harness</th>
          <th>Model</th>
          <th>Reasoning</th>
          <th>Host</th>
          <th className="n">Records</th>
          <th className="n">Tokens</th>
          <th className="n">Cost</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.key}>
            <td>{new Date(session.lastActiveAt).toLocaleString()}</td>
            <td>
              {session.harnesses.map((harness) => (
                <span className="harness" key={harness}>
                  <i
                    className="dot"
                    style={{ background: HARNESS_COLOR[harness] ?? SERIES.orange }}
                  />
                  {harness}
                </span>
              ))}
            </td>
            <td>{session.models.join(", ")}</td>
            <td>{session.reasoningLevels.join(", ")}</td>
            <td>{session.sourceHosts.join(", ")}</td>
            <td className="n">{session.records.toLocaleString()}</td>
            <td className="n">{formatTokens(session.totalTokens)}</td>
            <td className="n">
              {session.estimatedCost === null ? "Unpriced" : formatMoney(session.estimatedCost)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 7: Add the harness cell style**

Append to `apps/web/src/styles.css`:

```css
.harness {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.harness + .harness {
  margin-left: 10px;
}
```

- [ ] **Step 8: Wire it in and delete the legacy views**

In `apps/web/src/app.tsx`, import `History` from `./views/history.tsx` and drop the `legacy-views.tsx` import entirely. Then delete `apps/web/src/legacy-views.tsx` and move the `Pricing` component into `apps/web/src/views/settings/rates.tsx` unchanged apart from its import paths, wiring it to the `settingsOpen` branch of `ViewSlot`.

Run: `git rm apps/web/src/legacy-views.tsx`

- [ ] **Step 9: Verify the whole workspace**

Run: `vp run check`

Expected: PASS across format, lint, typecheck, test, and build.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src apps/web/test
git commit -m "feat: rebuild History with harness attribution and retire legacy views"
```

---

### Task 29: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `CONTEXT.md`

- [ ] **Step 1: Add the new vocabulary**

Add to `CONTEXT.md`, following the existing entry format:

```markdown
**Usage Source**:
The adapter and source format that supplied authoritative usage evidence for a Usage Record, identified by `usageSourceId` such as `codex-local`.
_Avoid_: provider, importer, harness

**Harness**:
The coding harness in which the work occurred, identified by `harnessId` such as `codex` or `claude-code`. Distinct from both the Usage Source and the model provider.
_Avoid_: client, tool, provider

**Usage Quota Snapshot**:
A normalized, source-owned observation of plan limits with named windows. It never participates in cost calculation.
_Avoid_: rate limits, plan usage, billing state
```

- [ ] **Step 2: Update the capability list**

In `README.md`, replace the "Shows API-equivalent spend…" bullet with:

```markdown
- Shows API-equivalent spend as a single headline figure with its cost drivers by harness, model, and task, plus token composition and per-source plan limits.
- Separates usage source, harness, model provider, and model as distinct identities, so one harness may use several providers and one provider may be reached through several harnesses.
- Reports metrics a source does not supply as unavailable rather than as zero.
```

- [ ] **Step 3: Record the change**

Add to the `Unreleased` section of `CHANGELOG.md`:

```markdown
### Changed

- Rebuilt the dashboard as a cost-first cockpit: one headline figure, a single-axis trend with a Cost/Tokens toggle, driver panels by harness, model, and task, and a context rail for token mix, plan limits, and hosts.
- Replaced the token composition donut with a stacked bar, dashed gridlines with solid hairlines, and plan-limit progress bars with status-aware meters.
- Moved rate configuration into Settings; renamed Advanced to Breakdown.

### Added

- Canonical `usageSourceId` and `harnessId` on every Usage Record, with a compatibility decoder for existing ledgers.
- Normalized usage quota snapshots with named windows, replacing Codex-shaped rate limits embedded in records.
- Session-level children under task rankings.

### Fixed

- Cache efficiency no longer counts records whose source does not report caching, which previously understated the ratio.
- `vp run dev` starts the server again. It ran the server under Bun, which does not implement `node:sqlite`, so the documented development command failed on every machine.
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md CONTEXT.md
git commit -m "docs: document harness identities and the redesigned dashboard"
```

---

## Done criteria for this plan

- [ ] `vp run check` passes.
- [ ] The Overview fits above the fold at 1440×900 with no inner scrollbars.
- [ ] No chart plots two Y axes.
- [ ] `apps/web/test/palette.test.ts` fails if any series color is edited outside the gates.
- [ ] A record with no `cachedInputTokens` does not change the cache-efficiency ratio.
- [ ] A record with no `reasoningLevel` appears under "not reported", never `none` or `unknown`.
- [ ] An existing Codex ledger opens with no data loss and no manual migration step.
- [ ] `apps/web/src/legacy-views.tsx` no longer exists.

## Known deviations from the spec

Two spec requirements are not fully met by this plan. Both are deliberate; neither is an oversight.

**1. Error state is page-level, not per-panel.** The spec says an error renders inline in the affected panel. This plan renders it as a single alert above the views (Task 7). The reason is that `refresh()` fetches overview, history, and catalog in one `Promise.all`, so a failure is global — attributing it to one panel would be a lie about which data is missing. Revisit if and when the views fetch independently; until then, a page-level alert is the accurate representation.

**2. Two Settings panels are unassigned.** The spec's Settings section describes four panels — Sources, Rates, Hosts & groups, and Data — but its slice list only ever places Rates (slice 1) and Sources (slice 6). **Hosts & groups** and **Data** appear in no slice in either plan. Options, for the author to decide:

- Add them to the end of Plan 2 as a small slice of their own. The underlying actions (`set-host-group`, `clear-records`) already exist in `dashboard-actions`, so both panels are UI-only work.
- Or drop them from the spec and keep host-group management out of the browser entirely.

Do not silently ship a Settings surface with two dead nav items. Whichever way it goes, update the spec's Settings section to match.

## What Plan 2 picks up

Slices 6–10: the `packages/usage-sources` seam and registry, the `refresh-sources` action and Settings → Sources panel, ledger source ownership with atomic reconciliation, the Claude Code adapter, the conformance kit, and release hardening. Task 17's per-file quota caching and Task 28's `Pricing` relocation are the two places Plan 2 touches first.

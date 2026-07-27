# Claude plan limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Claude Code's plan limits in the Overview "Plan limits" panel, read from Claude Code's local config cache, with the age of the reading visible and expired windows dropped.

**Architecture:** A new server module `claude-quota.ts` locates `~/.claude.json`, parses `cachedUsageUtilization` leniently, and maps its `limits[]` array into the existing `UsageQuotaSnapshot` contract. `ClaudeSessionProvider.collect` returns it in the `quotaSnapshots` array it already returns, so the ledger, analysis, and panel need no schema change. Expiry filtering happens in `analyzeUsage` at projection time, not at import.

**Tech Stack:** TypeScript with native Node type-stripping, `node:test` + `node:assert/strict`, Zod 4 contracts, React 19 + i18next web app, oxfmt/oxlint, Bun as package manager via the `vp` CLI.

**Spec:** `docs/superpowers/specs/2026-07-26-claude-plan-limits-design.md`

## Global Constraints

- Node.js 24+, Bun 1.3+. `vp` is the workflow entry point; `bun run <script>` works directly too.
- Full verification is `vp run check` (format:check, lint, typecheck, test, build).
- Tests run via `node --experimental-strip-types --test apps/*/test/*.test.ts packages/*/test/*.test.ts`. **Test files must sit directly in a `test/` directory** — the glob is one level deep only.
- Test style is `node:test` `describe`/`it` with `node:assert/strict`. No test framework dependency exists; do not add one.
- Imports of local TypeScript use explicit `.ts` extensions (`../src/claude-quota.ts`).
- `usageQuotaSnapshotSchema` is `.strict()`. Any field the mapper emits that the contract does not declare throws at the ledger boundary.
- `usageQuotaWindowSchema` uses Zod `.datetime()`, which **rejects UTC offsets**. Every instant must be normalized through `new Date(v).toISOString()`.
- Schema limits that the mapper must respect: `windows` max 50 entries; `id`, `label`, `plan` max 200 chars; `balance.unit` max 50 chars; `usedPercent` and `windowMinutes` nonnegative.
- Never read `~/.claude/.credentials.json`. Never persist an email address, account UUID, or token.
- The dashboard distinguishes "not reported" from "zero". Absent measurements are omitted fields, never `0`.
- User-visible strings in the web app go through i18next with keys added to **both** `en.json` and `es.json`.
- Commit after every task.

---

### Task 1: Shared window label module

`windowLabel` currently lives in `codex-importer.ts` and is the only place that turns a window length into English. Claude's mapper needs the same function, and two copies would drift into two different words for the same window.

**Files:**

- Create: `apps/server/src/quota-window-label.ts`
- Modify: `apps/server/src/codex-importer.ts` (remove the local copy at lines 253–283, import instead)
- Test: `apps/server/test/quota-window-label.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `windowLabel(id: string, windowMinutes: number): string`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/quota-window-label.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { windowLabel } from "../src/quota-window-label.ts";

describe("windowLabel", () => {
  it("derives the label from the reported length, not the slot name", () => {
    assert.equal(windowLabel("primary", 300), "5-hour window");
    assert.equal(windowLabel("secondary", 10_080), "Weekly window");
    // A slot named "primary" whose length is three hours must not claim five.
    assert.equal(windowLabel("primary", 180), "3-hour window");
  });

  it("names multi-week and multi-day windows", () => {
    assert.equal(windowLabel("x", 20_160), "2-week window");
    assert.equal(windowLabel("x", 1_440), "Daily window");
    assert.equal(windowLabel("x", 2_880), "2-day window");
  });

  it("falls back to minutes when the length divides into nothing larger", () => {
    assert.equal(windowLabel("x", 90), "90-minute window");
  });

  it("falls back to the slot name when no length is reported", () => {
    assert.equal(windowLabel("primary", 0), "5-hour window");
    assert.equal(windowLabel("secondary", 0), "Weekly window");
    assert.equal(windowLabel("session", 0), "session");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/quota-window-label.test.ts`
Expected: FAIL — `Cannot find module '../src/quota-window-label.ts'`

- [ ] **Step 3: Create the module**

Create `apps/server/src/quota-window-label.ts`. This is a move, not a rewrite — the body is lifted verbatim from `codex-importer.ts` so behaviour is unchanged:

```ts
/**
 * Fallback labels, used only when the source does not report a window length.
 * A harness's own window sizes are what the label is supposed to describe, so
 * `windowLabel` prefers them and reaches for this map only when there is
 * nothing to derive from.
 */
const WINDOW_LABELS: Record<string, string> = {
  primary: "5-hour window",
  secondary: "Weekly window",
};

/**
 * Derived from `windowMinutes` rather than hardcoded per slot, because the slot
 * name says nothing about duration: "primary" is 5 hours on the plans we have
 * seen, but a plan whose primary window is 3 hours would still be labelled
 * "5-hour window" and tell the reader the wrong reset horizon on the one widget
 * whose entire job is answering "how long until this frees up?".
 *
 * Shared by every harness that reports quota, so that two sources describing
 * the same seven days cannot end up calling it two different things.
 */
export function windowLabel(id: string, windowMinutes: number): string {
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
```

- [ ] **Step 4: Remove the copy in the Codex importer**

In `apps/server/src/codex-importer.ts`, delete the `WINDOW_LABELS` constant and the `windowLabel` function (the block that begins with the comment `Fallback labels, used only when...` and ends with the closing brace of `windowLabel`, around lines 253–283). Add to the imports at the top of the file:

```ts
import { windowLabel } from "./quota-window-label.ts";
```

Leave the call site inside `quotaSnapshotFromRateLimits` untouched — it already reads `windowLabel(id, window.windowMinutes)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/quota-window-label.test.ts apps/server/test/quota-round-trip.test.ts apps/server/test/codex-characterization.test.ts`
Expected: PASS. The Codex tests are included deliberately — they are the proof the move changed no behaviour.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/quota-window-label.ts apps/server/src/codex-importer.ts apps/server/test/quota-window-label.test.ts
git commit -m "Share windowLabel between harnesses instead of copying it

Claude's quota mapper needs the same length-to-English function Codex
uses. Two copies would drift into two different words for the same
seven days on the same panel."
```

---

### Task 2: Locate and read the Claude config cache

The quota numbers live in `~/.claude.json`, which is a sibling of the `~/.claude` home the importer already resolves — not inside it. Under `CLAUDE_CONFIG_DIR` the same file sits _inside_ the configured directory instead, so both layouts must be probed.

**Files:**

- Create: `apps/server/src/claude-quota.ts`
- Test: `apps/server/test/claude-quota.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `readClaudeConfig(home: string, maxBytes?: number): Promise<Record<string, unknown> | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/claude-quota.test.ts`. The fixtures are written to temp directories at run time rather than committed: one of them is deliberately malformed JSON, and a broken `.json` file in the repo would fight the formatter.

```ts
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readClaudeConfig } from "../src/claude-quota.ts";

const scratch: string[] = [];
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-claude-"));
  scratch.push(dir);
  return dir;
}
after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

describe("readClaudeConfig", () => {
  it("finds the config beside the default home directory", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    // The importer's `home` is `<dir>/.claude`; the config is its sibling.
    assert.deepEqual(await readClaudeConfig(join(dir, ".claude")), { marker: "sibling" });
  });

  it("finds the config inside a configured home directory", async () => {
    const dir = await temp();
    const home = join(dir, "cfg");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), '{"marker":"inside"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "inside" });
  });

  it("returns null when no config exists", async () => {
    const dir = await temp();
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("falls through to the sibling when the inner config is malformed", async () => {
    const dir = await temp();
    const home = join(dir, ".claude");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), "{ not json", "utf8");
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "sibling" });
  });

  it("returns null for malformed JSON with nothing to fall through to", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "{ not json", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("skips a file larger than the size guard", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude"), 4), null);
  });

  it("rejects a top-level array", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "[1,2,3]", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: FAIL — `Cannot find module '../src/claude-quota.ts'`

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/claude-quota.ts`:

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";

/**
 * The config file accumulates a project history the monitor does not control,
 * so its size is not bounded by anything we can reason about. 32 MB is far
 * above any plausible real file and far below anything that would hurt to read.
 */
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;

/**
 * Locates and parses Claude Code's config file.
 *
 * The quota evidence is NOT in the transcripts — see `claude-importer.ts` — it
 * is in this file, which sits BESIDE the `~/.claude` home under the default
 * layout and INSIDE it under `CLAUDE_CONFIG_DIR`. Both are probed, in that
 * order, and the first one that parses wins.
 *
 * Every failure path returns null rather than throwing. This file belongs to
 * another program, is undocumented, and is reshaped without notice; an import
 * that found a transcript must not fail because a config file it also happened
 * to look at was unreadable.
 */
export async function readClaudeConfig(
  home: string,
  maxBytes: number = MAX_CONFIG_BYTES,
): Promise<Record<string, unknown> | null> {
  for (const candidate of [join(home, ".claude.json"), `${home}.json`]) {
    let raw: string;
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > maxBytes) continue;
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable is evidence we do not have, not a reason to stop looking.
    }
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/claude-quota.ts apps/server/test/claude-quota.test.ts
git commit -m "Locate and read Claude Code's config file

Two layouts: beside the home directory by default, inside it under
CLAUDE_CONFIG_DIR. Every failure returns null - this file belongs to
another program and an unreadable one must not fail an import that
already found transcripts."
```

---

### Task 3: Map the cache into a quota snapshot

The mapping proper. `limits[]` drives the meters; the sibling `five_hour` / `seven_day` fields are consulted only to establish window durations, which `limits[]` omits.

**Files:**

- Modify: `apps/server/src/claude-quota.ts`
- Test: `apps/server/test/claude-quota.test.ts`

**Interfaces:**

- Consumes: `windowLabel(id, windowMinutes)` from Task 1.
- Produces: `claudeQuotaSnapshot(config: unknown, sourceHostId: string): UsageQuotaSnapshot | null`

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/claude-quota.test.ts`. Add `claudeQuotaSnapshot` to the existing import from `../src/claude-quota.ts`.

The `config()` helper mirrors the real observed shape, including the offset-and-microsecond timestamps and the null codename slots, so the tests exercise the data as it actually arrives.

```ts
const FIVE_HOUR_RESET = "2026-07-27T03:10:00.127734+00:00";
const SEVEN_DAY_RESET = "2026-07-31T22:00:00.127758+00:00";

/**
 * Overrides replace keys INSIDE `utilization`. Spreading them at the
 * `cachedUsageUtilization` level instead would let an `{ utilization: … }`
 * override silently replace the whole block rather than merge into it.
 */
function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oauthAccount: {
      emailAddress: "someone@example.com",
      organizationType: "claude_max",
      organizationRateLimitTier: "default_claude_max_20x",
    },
    cachedUsageUtilization: {
      fetchedAtMs: 1785105458317,
      accountUuid: "937ec57b-57ff-4293-abce-493df76661c8",
      utilization: {
        five_hour: { utilization: 2, resets_at: FIVE_HOUR_RESET },
        seven_day: { utilization: 6, resets_at: SEVEN_DAY_RESET },
        tangelo: null,
        iguana_necktie: null,
        limits: [
          {
            kind: "session",
            group: "session",
            percent: 2,
            severity: "normal",
            resets_at: FIVE_HOUR_RESET,
            scope: null,
            is_active: false,
          },
          {
            kind: "weekly_all",
            group: "weekly",
            percent: 6,
            severity: "normal",
            resets_at: SEVEN_DAY_RESET,
            scope: null,
            is_active: true,
          },
          {
            kind: "weekly_scoped",
            group: "weekly",
            percent: 0,
            severity: "normal",
            resets_at: null,
            scope: { model: { id: null, display_name: "Fable" } },
            is_active: false,
          },
        ],
        ...overrides,
      },
    },
  };
}

describe("claudeQuotaSnapshot", () => {
  it("maps the observed cache into a snapshot", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    assert.ok(snapshot);
    assert.equal(snapshot.usageSourceId, "claude-code-local");
    assert.equal(snapshot.sourceHostId, "host:a");
    assert.equal(snapshot.observedAt, "2026-07-26T22:37:38.317Z");
    assert.equal(snapshot.plan, "claude_max_20x");
    assert.equal(snapshot.windows.length, 3);
  });

  it("normalizes an offset timestamp to the instant the contract accepts", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    // Zod's .datetime() rejects "+00:00" outright. A passthrough value would
    // pass every mapper test and throw at the ledger.
    assert.equal(snapshot?.windows[0]?.resetsAt, "2026-07-27T03:10:00.127Z");
    assert.match(String(snapshot?.windows[0]?.resetsAt), /Z$/);
  });

  it("establishes window length by cross-reference, never by assumption", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    assert.equal(snapshot?.windows[0]?.windowMinutes, 300);
    assert.equal(snapshot?.windows[0]?.label, "5-hour window");
    assert.equal(snapshot?.windows[1]?.windowMinutes, 10_080);
    assert.equal(snapshot?.windows[1]?.label, "Weekly window");
  });

  it("omits the length when nothing corroborates it", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    const scoped = snapshot?.windows[2];
    assert.equal(scoped?.windowMinutes, undefined);
    assert.equal(scoped?.resetsAt, undefined);
    assert.equal(scoped?.label, "Weekly window · Fable");
  });

  it("gives scoped windows distinct ids so two models are two meters", () => {
    const snapshot = claudeQuotaSnapshot(
      config({
        limits: [
          { kind: "weekly_scoped", percent: 1, scope: { model: { display_name: "Fable" } } },
          { kind: "weekly_scoped", percent: 2, scope: { model: { display_name: "Opus 5" } } },
        ],
      }),
      "host:a",
    );
    assert.deepEqual(
      snapshot?.windows.map((window) => window.id),
      ["weekly_scoped:fable", "weekly_scoped:opus-5"],
    );
    assert.equal(new Set(snapshot?.windows.map((w) => w.id)).size, 2);
  });

  it("keeps an unrecognised kind rather than dropping it", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [{ kind: "monthly_all", percent: 12 }] }),
      "host:a",
    );
    assert.equal(snapshot?.windows.length, 1);
    assert.equal(snapshot?.windows[0]?.id, "monthly_all");
    assert.equal(snapshot?.windows[0]?.label, "Monthly all");
    assert.equal(snapshot?.windows[0]?.usedPercent, 12);
  });

  it("omits an unreported percentage instead of calling it zero", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [{ kind: "session", percent: null }] }),
      "host:a",
    );
    assert.equal(snapshot?.windows[0]?.usedPercent, undefined);
    assert.ok(!("usedPercent" in (snapshot?.windows[0] ?? {})));
  });

  it("falls back to the organization type when no tier is stated", () => {
    const snapshot = claudeQuotaSnapshot(
      { ...config(), oauthAccount: { organizationType: "claude_max" } },
      "host:a",
    );
    assert.equal(snapshot?.plan, "claude_max");
  });

  it("caps windows at the contract's limit", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      kind: `kind_${index}`,
      percent: 1,
    }));
    const snapshot = claudeQuotaSnapshot(config({ limits: many }), "host:a");
    assert.equal(snapshot?.windows.length, 50);
  });

  it("returns null when the cache is absent, empty, or undated", () => {
    assert.equal(claudeQuotaSnapshot({}, "host:a"), null);
    assert.equal(claudeQuotaSnapshot(null, "host:a"), null);
    assert.equal(claudeQuotaSnapshot({ cachedUsageUtilization: {} }, "host:a"), null);
    assert.equal(
      claudeQuotaSnapshot({ cachedUsageUtilization: { utilization: {} } }, "host:a"),
      null,
    );
  });

  it("emits a snapshot with no windows when the cache reports no limits", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [], five_hour: null, seven_day: null }),
      "host:a",
    );
    // "We know this account exists and have nothing current about it" is a
    // different statement from "no such account".
    assert.deepEqual(snapshot?.windows, []);
    assert.equal(snapshot?.plan, "claude_max_20x");
  });

  it("stores no account identifier", () => {
    const serialized = JSON.stringify(claudeQuotaSnapshot(config(), "host:a"));
    assert.ok(!serialized.includes("someone@example.com"));
    assert.ok(!serialized.includes("937ec57b-57ff-4293-abce-493df76661c8"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: FAIL — `claudeQuotaSnapshot is not a function` / not exported.

- [ ] **Step 3: Write the implementation**

Append to `apps/server/src/claude-quota.ts`, and add the imports at the top of that file:

```ts
import type { UsageQuotaSnapshot, UsageQuotaWindow } from "@llm-usage-monitor/contracts";
import { windowLabel } from "./quota-window-label.ts";
```

```ts
/** Contract cap on `windows`; exceeding it throws at the ledger. */
const MAX_WINDOWS = 50;

/**
 * Labels for the kinds Anthropic ships today. `weekly_scoped` shares the weekly
 * label because the scope name is appended to it, giving "Weekly window · Fable".
 */
const KIND_LABELS: Record<string, string> = {
  session: "Session window",
  weekly_all: "Weekly window",
  weekly_scoped: "Weekly window",
};

/**
 * Maps Claude Code's cached utilization block into a normalized snapshot.
 *
 * Driven by `utilization.limits`, not by the sibling `five_hour` / `seven_day`
 * fields, because the array is Anthropic's own normalized list and the fields
 * beside it are experiment slots — a real account carries half a dozen null
 * codenames (`tangelo`, `iguana_necktie`, `omelette_promotional`) that come and
 * go. Reading the array means a new per-model cap appears with no code change.
 *
 * Every field is treated as optional and every unreadable value is omitted
 * rather than defaulted, so a reshaped cache degrades to fewer meters instead
 * of wrong ones.
 */
export function claudeQuotaSnapshot(
  config: unknown,
  sourceHostId: string,
): UsageQuotaSnapshot | null {
  const root = asRecord(config);
  const cached = asRecord(root?.cachedUsageUtilization);
  const utilization = asRecord(cached?.utilization);
  if (!cached || !utilization) return null;
  const observedAt = instant(cached.fetchedAtMs);
  if (!observedAt) return null;
  const plan = planLabel(asRecord(root?.oauthAccount));
  return {
    usageSourceId: "claude-code-local",
    sourceHostId,
    ...(plan ? { plan } : {}),
    observedAt,
    windows: quotaWindows(utilization).slice(0, MAX_WINDOWS),
  };
}

function quotaWindows(utilization: Record<string, unknown>): UsageQuotaWindow[] {
  const limits = Array.isArray(utilization.limits) ? utilization.limits : [];
  const durations = statedDurations(utilization);
  const windows: UsageQuotaWindow[] = [];
  const taken = new Set<string>();
  for (const entry of limits) {
    const limit = asRecord(entry);
    if (!limit) continue;
    const kind = text(limit.kind);
    if (!kind) continue;
    const scope = scopeName(limit);
    const resetsAt = instant(limit.resets_at);
    const windowMinutes = resetsAt === undefined ? undefined : durations.get(resetsAt);
    const usedPercent = nonNegative(limit.percent);
    windows.push({
      // Unique because it is the React key, and `weekly_scoped` legitimately
      // repeats once per scoped model.
      id: unique(taken, scope ? `${kind}:${slug(scope)}` : kind),
      label: capped(label(kind, scope, windowMinutes)),
      ...(usedPercent === undefined ? {} : { usedPercent }),
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  }
  return windows;
}

/**
 * Window lengths as the cache states them, keyed by reset instant.
 *
 * `limits[]` carries no duration, and hardcoding "session means 300 minutes"
 * would put a number on screen that no source said. Instead: when a limit's
 * reset instant matches `five_hour`'s or `seven_day`'s exactly, the field NAME
 * is Anthropic stating that window's length, and the match is what licenses us
 * to use it. No match, no duration.
 */
function statedDurations(utilization: Record<string, unknown>): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [field, minutes] of [
    ["five_hour", 300],
    ["seven_day", 10_080],
  ] as const) {
    const at = instant(asRecord(utilization[field])?.resets_at);
    if (at) durations.set(at, minutes);
  }
  return durations;
}

function label(kind: string, scope: string | undefined, windowMinutes: number | undefined): string {
  const base =
    windowMinutes === undefined
      ? (KIND_LABELS[kind] ?? humanize(kind))
      : windowLabel(kind, windowMinutes);
  return scope ? `${base} · ${scope}` : base;
}

/** `monthly_all` -> `Monthly all`. Ugly beats absent: a new cap must appear. */
function humanize(kind: string): string {
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function scopeName(limit: Record<string, unknown>): string | undefined {
  return text(asRecord(asRecord(limit.scope)?.model)?.display_name);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(taken: Set<string>, base: string): string {
  let id = capped(base);
  for (let suffix = 2; taken.has(id); suffix += 1) id = capped(`${base}-${suffix}`);
  taken.add(id);
  return id;
}

function planLabel(account: Record<string, unknown> | null): string | undefined {
  const tier = text(account?.organizationRateLimitTier);
  // The tier names the plan precisely ("claude_max_20x"); the type is coarser
  // ("claude_max") and only used when the tier is missing.
  return tier ? capped(tier.replace(/^default_/, "")) : text(account?.organizationType);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** ISO instant in UTC, or undefined. Offsets and epoch millis both normalize. */
function instant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const at = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function nonNegative(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? capped(value.trim()) : undefined;
}

function capped(value: string): string {
  return value.slice(0, 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/claude-quota.ts apps/server/test/claude-quota.test.ts
git commit -m "Map Claude's cached utilization into a quota snapshot

Driven by the limits[] array rather than the sibling fields beside it,
which are experiment slots that come and go. Window length is taken from
a matching reset instant, never assumed, so no duration reaches the
screen that the cache did not state."
```

---

### Task 4: Extra usage and spend

Both blocks are disabled on every account observed so far, so this ships dormant. It is written to fail closed — any field missing, the block is omitted rather than guessed at — and it is tested in both directions precisely because dormant code breaks silently on the day it wakes up.

**Files:**

- Modify: `apps/server/src/claude-quota.ts`
- Test: `apps/server/test/claude-quota.test.ts`

**Interfaces:**

- Consumes: `claudeQuotaSnapshot` from Task 3.
- Produces: no new export; `claudeQuotaSnapshot` gains `balance` and may emit an `extra-usage` window.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/claude-quota.test.ts`:

```ts
describe("claudeQuotaSnapshot extra usage", () => {
  it("reports no balance when both blocks are disabled", () => {
    // The state of every account observed so far.
    const snapshot = claudeQuotaSnapshot(
      config({
        extra_usage: { is_enabled: false, used_credits: null, utilization: null },
        spend: { enabled: false, used: { amount_minor: 0, currency: "USD", exponent: 2 } },
      }),
      "host:a",
    );
    assert.equal(snapshot?.balance, undefined);
    assert.ok(!snapshot?.windows.some((window) => window.id === "extra-usage"));
  });

  it("takes the balance from spend when spend is enabled", () => {
    const snapshot = claudeQuotaSnapshot(
      config({
        spend: { enabled: true, used: { amount_minor: 1234, currency: "USD", exponent: 2 } },
      }),
      "host:a",
    );
    assert.deepEqual(snapshot?.balance, { amount: 12.34, unit: "USD" });
  });

  it("falls back to extra usage credits when only that block is enabled", () => {
    const snapshot = claudeQuotaSnapshot(
      config({
        spend: { enabled: false },
        extra_usage: {
          is_enabled: true,
          used_credits: 5000,
          decimal_places: 2,
          currency: "USD",
          utilization: 25,
        },
      }),
      "host:a",
    );
    assert.deepEqual(snapshot?.balance, { amount: 50, unit: "USD" });
  });

  it("adds an extra usage meter with no reset instant", () => {
    const snapshot = claudeQuotaSnapshot(
      config({
        extra_usage: {
          is_enabled: true,
          utilization: 25,
          currency: "USD",
          decimal_places: 2,
          used_credits: 5000,
        },
      }),
      "host:a",
    );
    const meter = snapshot?.windows.find((window) => window.id === "extra-usage");
    assert.equal(meter?.label, "Extra usage");
    assert.equal(meter?.usedPercent, 25);
    // A monthly spend cap; the cache states no reset instant for it.
    assert.equal(meter?.resetsAt, undefined);
    assert.equal(meter?.windowMinutes, undefined);
  });

  it("fails closed when an enabled block is missing fields", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ spend: { enabled: true, used: { amount_minor: 1234 } } }),
      "host:a",
    );
    // No currency and no exponent: omit rather than invent a unit.
    assert.equal(snapshot?.balance, undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: FAIL — `balance` is `undefined` where a value is expected, and no `extra-usage` window exists.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/claude-quota.ts`, change the `windows` line and add `balance` in `claudeQuotaSnapshot`:

```ts
const balance = balanceFrom(utilization);
return {
  usageSourceId: "claude-code-local",
  sourceHostId,
  ...(plan ? { plan } : {}),
  observedAt,
  windows: [...quotaWindows(utilization), ...extraUsageWindow(utilization)].slice(0, MAX_WINDOWS),
  ...(balance ? { balance } : {}),
};
```

And append:

```ts
/**
 * `spend` and `extra_usage` read as two generations of one feature, so `spend`
 * wins where both are present.
 *
 * Both are disabled on every account observed so far, which means this mapping
 * is written against a structure whose populated semantics have never been
 * seen. It therefore fails closed: a missing currency or scale omits the
 * balance entirely rather than reporting a number in an assumed unit.
 */
function balanceFrom(
  utilization: Record<string, unknown>,
): { amount: number; unit: string } | undefined {
  const spend = asRecord(utilization.spend);
  if (spend?.enabled === true) {
    const used = asRecord(spend.used);
    const money = scaled(used?.amount_minor, used?.exponent, used?.currency);
    if (money) return money;
  }
  const extra = asRecord(utilization.extra_usage);
  if (extra?.is_enabled === true) {
    const money = scaled(extra.used_credits, extra.decimal_places, extra.currency);
    if (money) return money;
  }
  return undefined;
}

function scaled(
  minor: unknown,
  exponent: unknown,
  currency: unknown,
): { amount: number; unit: string } | undefined {
  const amount = nonNegative(minor);
  const scale = nonNegative(exponent);
  const unit = text(currency);
  if (amount === undefined || scale === undefined || !unit) return undefined;
  return { amount: amount / 10 ** scale, unit: unit.slice(0, 50) };
}

/**
 * A monthly spend cap rather than a rolling window, so it carries a percentage
 * and no reset instant. It is a meter because that is what a percentage is.
 */
function extraUsageWindow(utilization: Record<string, unknown>): UsageQuotaWindow[] {
  const extra = asRecord(utilization.extra_usage);
  if (extra?.is_enabled !== true) return [];
  const usedPercent = nonNegative(extra.utilization);
  if (usedPercent === undefined) return [];
  return [{ id: "extra-usage", label: "Extra usage", usedPercent }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/claude-quota.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/claude-quota.ts apps/server/test/claude-quota.test.ts
git commit -m "Map Claude spend and extra usage to a balance and a meter

Both blocks are disabled on every account observed so far, so this is
dormant and its populated semantics are unverified. It fails closed: a
missing currency or scale omits the balance rather than reporting a
number in an assumed unit. Tested in both directions because dormant
code breaks silently the day an account enables it."
```

---

### Task 5: Wire the snapshot into the Claude importer

**Files:**

- Modify: `apps/server/src/claude-importer.ts` (header comment lines 18–30; `collect` return at line 67)
- Test: `apps/server/test/quota-round-trip.test.ts`

**Interfaces:**

- Consumes: `readClaudeConfig(home, maxBytes?)` and `claudeQuotaSnapshot(config, sourceHostId)`.
- Produces: `ClaudeSessionProvider.collect` returns a populated `quotaSnapshots` array.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/quota-round-trip.test.ts`. Add these imports at the top of the file:

```ts
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeSessionProvider } from "../src/claude-importer.ts";
```

```ts
describe("Claude quota round trip", () => {
  it("carries the config cache through the ledger into the overview", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lum-claude-rt-"));
    const ledger = new UsageLedger();
    try {
      await fs.writeFile(
        join(directory, ".claude.json"),
        JSON.stringify({
          oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" },
          cachedUsageUtilization: {
            fetchedAtMs: 1785105458317,
            utilization: {
              five_hour: { utilization: 2, resets_at: "2026-07-27T03:10:00.127734+00:00" },
              seven_day: { utilization: 6, resets_at: "2026-07-31T22:00:00.127758+00:00" },
              limits: [
                { kind: "session", percent: 2, resets_at: "2026-07-27T03:10:00.127734+00:00" },
                { kind: "weekly_all", percent: 6, resets_at: "2026-07-31T22:00:00.127758+00:00" },
              ],
            },
          },
        }),
        "utf8",
      );

      // No `projects` directory: this asserts quota is read even when the
      // transcript walk finds nothing, which is the state of a fresh install.
      const imported = await new ClaudeSessionProvider().collect(
        "host:a",
        join(directory, ".claude"),
        {},
      );
      assert.equal(imported.records.length, 0);
      assert.equal(imported.quotaSnapshots.length, 1);

      // The strict-schema boundary. Throws here if the mapper emits a field
      // the contract does not declare, or an offset timestamp.
      ledger.replaceQuotaSnapshots(imported.quotaSnapshots);

      const view = analyzeUsage({
        records: [],
        prices: [],
        memberships: [],
        quotaSnapshots: ledger.quotaSnapshots(),
        filters: { timeframe: "all" },
        // After the cache was fetched, before either window resets.
        now: new Date("2026-07-27T00:00:00.000Z"),
      });

      assert.equal(view.quotaSnapshots[0]?.usageSourceId, "claude-code-local");
      assert.equal(view.quotaSnapshots[0]?.plan, "claude_max_20x");
      assert.equal(view.quotaSnapshots[0]?.observedAt, "2026-07-26T22:37:38.317Z");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.label, "5-hour window");
      assert.equal(view.quotaSnapshots[0]?.windows[1]?.usedPercent, 6);
    } finally {
      ledger.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/quota-round-trip.test.ts`
Expected: FAIL — `quotaSnapshots.length` is 0, expected 1.

- [ ] **Step 3: Wire it in**

In `apps/server/src/claude-importer.ts`, add to the imports:

```ts
import { claudeQuotaSnapshot, readClaudeConfig } from "./claude-quota.ts";
```

Inside `collect`, after the file loop and before the `return`:

```ts
const snapshot = claudeQuotaSnapshot(await readClaudeConfig(home), sourceHostId);
```

and change the returned `quotaSnapshots: []` to:

```ts
      quotaSnapshots: snapshot ? [snapshot] : [],
```

- [ ] **Step 4: Correct the header comment**

The comment on lines 26–29 currently ends the class docstring with "No quota snapshots: the transcripts carry no rate-limit evidence." Half of that is still true and half is now wrong. Replace that paragraph with:

```ts
 * The transcripts still carry no rate-limit evidence — that part has not
 * changed, and it is why quota does not come from this file's parser. It comes
 * from Claude Code's config cache instead, read by `claude-quota.ts`, which is
 * a separate module because it reads a different file in a different format
 * with different failure modes. A machine where Claude Code has never run has
 * no cache, and the panel reads "unreported" rather than showing an empty
 * meter — we have not observed the plan's quota, and a Claude Code plan
 * certainly has one.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/quota-round-trip.test.ts apps/server/test/claude-quota.test.ts`
Expected: PASS. The Codex round trip in the same file must still pass untouched.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/claude-importer.ts apps/server/test/quota-round-trip.test.ts
git commit -m "Report Claude plan limits from the importer

The transcripts still carry no rate-limit evidence; the quota comes from
the config cache instead. Read even when the transcript walk finds
nothing, which is the state of a fresh install."
```

---

### Task 6: Drop expired windows at projection time

A snapshot is written once and served for days afterwards. A window that was live when imported goes expired while sitting in SQLite, so expiry cannot be decided at import.

**Files:**

- Modify: `packages/usage-analysis/src/index.ts` (the `quotaSnapshots` line in `analyzeUsage`, currently line 63)
- Modify: `apps/server/test/quota-round-trip.test.ts` (the Codex case needs a pinned `now`)
- Test: `packages/usage-analysis/test/analysis.test.ts`

**Interfaces:**

- Consumes: `analyzeUsage`'s existing `now` input.
- Produces: `currentQuota(snapshots: UsageQuotaSnapshot[], now: Date): UsageQuotaSnapshot[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`. Add `currentQuota` to the existing import from `../src/index.ts`, and `UsageQuotaSnapshot` to the type imports from `@llm-usage-monitor/contracts` if not already present.

```ts
describe("currentQuota", () => {
  const snapshot: UsageQuotaSnapshot = {
    usageSourceId: "claude-code-local",
    sourceHostId: "host:a",
    plan: "claude_max_20x",
    observedAt: "2026-07-26T22:37:38.317Z",
    windows: [
      {
        id: "session",
        label: "5-hour window",
        usedPercent: 2,
        resetsAt: "2026-07-27T03:10:00.127Z",
      },
      {
        id: "weekly_all",
        label: "Weekly window",
        usedPercent: 6,
        resetsAt: "2026-07-31T22:00:00.127Z",
      },
      { id: "weekly_scoped:fable", label: "Weekly window · Fable", usedPercent: 0 },
    ],
  };

  it("keeps windows that have not reset yet", () => {
    const [current] = currentQuota([snapshot], new Date("2026-07-26T20:00:00.000Z"));
    assert.equal(current?.windows.length, 3);
  });

  it("drops a window whose reset instant has passed", () => {
    // The percentage is not merely old, it is known-wrong: the window cleared.
    const [current] = currentQuota([snapshot], new Date("2026-07-28T00:00:00.000Z"));
    assert.deepEqual(
      current?.windows.map((window) => window.id),
      ["weekly_all", "weekly_scoped:fable"],
    );
  });

  it("keeps a window that states no reset instant", () => {
    const [current] = currentQuota([snapshot], new Date("2030-01-01T00:00:00.000Z"));
    assert.deepEqual(
      current?.windows.map((window) => window.id),
      ["weekly_scoped:fable"],
    );
  });

  it("keeps the group when every window has expired", () => {
    const expired = { ...snapshot, windows: snapshot.windows.slice(0, 2) };
    const [current] = currentQuota([expired], new Date("2030-01-01T00:00:00.000Z"));
    // "We know this account exists and have nothing current" is not "no account".
    assert.equal(current?.windows.length, 0);
    assert.equal(current?.plan, "claude_max_20x");
    assert.equal(current?.observedAt, "2026-07-26T22:37:38.317Z");
  });

  it("is applied by analyzeUsage at its own now", () => {
    const view = analyzeUsage({
      records: [],
      prices: [],
      memberships: [],
      quotaSnapshots: [snapshot],
      filters: { timeframe: "all" },
      now: new Date("2026-07-28T00:00:00.000Z"),
    });
    assert.equal(view.quotaSnapshots[0]?.windows.length, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: FAIL — `currentQuota is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/usage-analysis/src/index.ts`, change the `quotaSnapshots` line inside `analyzeUsage` from:

```ts
    quotaSnapshots: input.quotaSnapshots ?? [],
```

to:

```ts
    quotaSnapshots: currentQuota(input.quotaSnapshots ?? [], now),
```

and add the function (export it — the tests address it directly, as this package's other pure helpers are):

```ts
/**
 * Drops windows whose reset instant has already passed.
 *
 * Filtered here rather than in an importer because a snapshot is written once
 * and served for days afterwards: a window that was live at import goes expired
 * while sitting in SQLite, so an expiry decision taken at write time is stale
 * before it is ever read. `analyzeUsage` already carries an injectable `now`,
 * which makes this both correct and testable.
 *
 * An expired window's percentage is not merely old, it is known-wrong — the
 * window has since cleared. A snapshot left with no windows keeps its group,
 * plan, and observation time: "we know this account exists and have nothing
 * current about it" is a different statement from "no such account".
 */
export function currentQuota(snapshots: UsageQuotaSnapshot[], now: Date): UsageQuotaSnapshot[] {
  const at = now.getTime();
  return snapshots.map((snapshot) => ({
    ...snapshot,
    windows: snapshot.windows.filter((window) => {
      if (!window.resetsAt) return true;
      const resets = Date.parse(window.resetsAt);
      // An unparseable instant is not evidence of expiry.
      return Number.isNaN(resets) || resets > at;
    }),
  }));
}
```

- [ ] **Step 4: Pin `now` in the Codex round trip**

The existing Codex assertion at `apps/server/test/quota-round-trip.test.ts:41` is `assert.deepEqual(view.quotaSnapshots, imported.quotaSnapshots)`, and the fixture's `resets_at` values (`1784950000`, `1785300000`) are epoch seconds in **July 2026 — already in the past**. Without a pinned `now` this test now fails, correctly. Add to that test's `analyzeUsage` call:

```ts
        now: new Date("2026-07-20T00:00:00.000Z"),
```

This sits before both fixture reset instants, so the round trip keeps asserting on both windows.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts apps/server/test/quota-round-trip.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/usage-analysis/src/index.ts packages/usage-analysis/test/analysis.test.ts apps/server/test/quota-round-trip.test.ts
git commit -m "Drop expired quota windows when projecting, not when importing

A snapshot is written once and served for days; a window that was live
at import goes expired while sitting in SQLite. An expired percentage is
not old, it is wrong - the window cleared."
```

---

### Task 7: Show how old the reading is

The Claude number is a cache refreshed only while Claude Code runs, so an unqualified percentage is a claim the data cannot support. Codex gains the same line — it has the same exposure.

**Files:**

- Modify: `apps/web/src/components/quota-meters.tsx`
- Modify: `apps/web/src/styles.css` (the `.quota-source` rule at line 397)
- Modify: `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/locales/es.json`

**Interfaces:**

- Consumes: `snapshot.observedAt`, `formatDateTime` from `../model/format.ts`.
- Produces: no exports. This repo tests pure functions in `model/`, not components — `formatDateTime` is already covered by `apps/web/test/format.test.ts`, so this task's gate is typecheck, build, and a look at the panel.

- [ ] **Step 1: Add the translation keys**

In `apps/web/src/i18n/locales/en.json`, inside the existing `quota` object:

```json
    "asOf": "as of {{at}}"
```

In `apps/web/src/i18n/locales/es.json`, inside the existing `quota` object:

```json
    "asOf": "a fecha de {{at}}"
```

- [ ] **Step 2: Render the line**

Replace the whole of `apps/web/src/components/quota-meters.tsx`. The `map`
callback gains a block body so the formatted instant is computed once per
snapshot rather than once per reference; everything below `quota-source` is
unchanged apart from indentation.

```tsx
import { useTranslation } from "react-i18next";
import type { UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { formatDateTime, formatWholePercent, type QuotaStatus } from "../model/format.ts";
import { QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";

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
  const { t } = useTranslation();
  if (!snapshots.length) return <p className="empty-state">{t("common.notReported")}</p>;
  return (
    <div className="quota-groups">
      {snapshots.map((snapshot) => {
        const observedAt = formatDateTime(snapshot.observedAt);
        return (
          <div className="quota-group" key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}>
            <p className="quota-source">
              <span>
                {harnessLabel(snapshot.usageSourceId)}
                {snapshot.plan ? ` · ${snapshot.plan}` : ""}
              </span>
              {/*
                These figures are caches refreshed only while their harness is
                running, so the age of the reading is part of the claim. A bare
                percentage with no date asserts more than the source supports.
              */}
              {observedAt && (
                <span className="quota-observed">{t("quota.asOf", { at: observedAt })}</span>
              )}
            </p>
            {snapshot.windows.map((window) => {
              const { status, shown, width } = quotaMeterView(window);
              const resets = window.resetsAt ? formatDateTime(window.resetsAt) : null;
              return (
                <div className="quota-window" key={window.id}>
                  <p className="quota-head">
                    <b>{window.label}</b>
                    <span className={`quota-value ${status}`}>
                      {shown === null
                        ? t("common.notReported")
                        : `${QUOTA_GLYPH[status]} ${formatWholePercent(shown)}`.trim()}
                    </span>
                  </p>
                  {/*
                    No track at all when nothing was reported. An empty meter is
                    indistinguishable from a meter reading zero, and this dashboard
                    treats "did not say" and "said none" as different facts.
                  */}
                  {shown !== null && (
                    <div
                      className="meter"
                      role="meter"
                      aria-valuenow={shown}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuetext={t("quota.used", { percent: formatWholePercent(shown) })}
                      aria-label={window.label}
                    >
                      <i style={{ width: `${width}%`, background: FILL[status] }} />
                    </div>
                  )}
                  {resets && <p className="quota-reset">{t("quota.resets", { at: resets })}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Style it**

In `apps/web/src/styles.css`, replace the `.quota-source` rule and add one after it:

```css
.quota-source {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 10px;
  margin: 0 0 5px;
  color: var(--muted);
  font-size: var(--size-meta);
}
.quota-observed {
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun run lint && bun run build:web`
Expected: all pass.

Then run the app and look at the panel:

```bash
node apps/server/dist/cli.mjs start --open
```

Expected: the Plan limits panel shows a Claude Code group with its plan, its windows, and an "as of" time; the Codex group shows an "as of" time too; the group header wraps rather than overflowing at narrow widths.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/quota-meters.tsx apps/web/src/styles.css apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/es.json
git commit -m "Show how old each quota reading is

The numbers are caches refreshed only while their harness runs, so a
bare percentage asserts more than the source supports."
```

---

### Task 8: User-facing documentation

**Files:**

- Modify: `README.md` (the "Current capabilities" list)
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the finished feature.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update the README capability list**

In `README.md`, the bullet reading "Shows API-equivalent spend as a single headline figure ... plus token composition and per-source plan limits." stays. Add after it:

```markdown
- Reads plan limits for each harness from what it already stores locally: Codex's session rate-limit events and Claude Code's own cached utilization block. Each meter is stamped with the time the reading was taken, and a window whose reset time has passed is withheld rather than shown at a percentage that no longer applies.
```

The existing claim "it calls no vendor account servers" stays exactly as it is and is still true — this reads a file Claude Code already wrote.

- [ ] **Step 2: Add the changelog entry**

In `CHANGELOG.md`, add a new section directly under `# Changelog`:

```markdown
## Unreleased

- Plan limits now include Claude Code, read from the utilization block Claude Code caches locally. Its session and weekly windows appear beside Codex's, with per-model weekly caps shown separately when a plan has them.
- Each plan limit states when its reading was taken, because these figures are caches that refresh only while their harness is running. A window whose reset time has already passed is withheld rather than shown at a percentage that no longer applies.
```

- [ ] **Step 3: Run the full verification**

Run: `vp run check`
Expected: format:check, lint, typecheck, test, and build all pass.

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document Claude plan limits"
```

---

## Completion gate

- `vp run check` passes.
- On a machine where Claude Code has run, the Plan limits panel shows a Claude Code group with its plan, windows, and as-of time.
- On a machine where it has not, the panel still reads "Not reported" rather than showing an empty meter.
- No persisted snapshot contains an email address or account UUID.

# Web Dashboard Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `apps/web` dashboard render in English or Spanish, with numbers, dates, and currency following the chosen language.

**Architecture:** `i18next` + `react-i18next` initialise once at startup from statically bundled JSON. The active locale is module-level state inside `model/format.ts`, updated by an `i18n.on("languageChanged")` listener registered before any component mounts. The `model/` layer never imports `t` — it takes translated strings as parameters or returns `{ key, params }` for the caller to render.

**Tech Stack:** TypeScript 5.9, React 19, Vite 7, i18next, react-i18next, `node --test` with `--experimental-strip-types`, oxlint, oxfmt, bun workspaces.

**Spec:** `docs/superpowers/specs/2026-07-26-web-dashboard-i18n-design.md`

## Global Constraints

- Scope is `apps/web` only. Never modify `apps/vscode-extension`, `apps/server`, `apps/source-host-agent`, or `packages/*`.
- Only two new runtime dependencies are permitted: `i18next` and `react-i18next`. Do not add `i18next-http-backend`, `i18next-browser-languagedetector`, or any other i18n plugin.
- Locale resources are imported statically and bundled. Never fetch them over HTTP.
- Nothing may read the OS/runtime default locale. Every `Intl` call receives an explicit locale resolved by the app.
- **CLDR separates a currency code, a compact unit (`mil`, `M`), and the `%` sign from their number with U+00A0 NO-BREAK SPACE, not an ASCII space.** Spanish output is full of them; English output has one, between `USD` and the amount. Every expected string in this plan that contains one is written `\u00a0`, and tests must keep the escape rather than pasting the literal character — U+00A0 is invisible in an editor and silently "tidied" into a space by a well-meaning edit, turning a passing test into a baffling one. This follows the same convention `model/quota-meter.ts` documents for its U+FE0E variation selectors.
- `apps/web/src/model/**` must never import `t`, `i18next`, or `react-i18next`.
- Product names are never translated, in any locale: `Codex`, `Claude Code`, `Usage Monitor`, `Teloverge`.
- Supported languages are exactly `en` and `es`. `en` is the source of truth.
- Run tests with `bun run test`. Run the full gate with `bun run check` (`format:check && lint && typecheck && test && build`).
- Every task ends with a commit. Do not amend previous commits.
- Work on branch `feature/i18n-i18next`.

---

### Task 1: Locale-aware formatter core

Replaces the pinned `LOCALE` constant with per-locale formatter caching plus a setter. This task covers `formatMoney`, `formatTokens`, `formatCount`, and `formatDateTime`. The other helpers follow in Tasks 2–4.

**Files:**

- Modify: `apps/web/src/model/format.ts:1-46` (locale constant, formatter construction, money/tokens/count) and `:106-113` (`formatDateTime`)
- Test: `apps/web/test/format.test.ts:14-32`, `:67-92`

**Interfaces:**

- Consumes: nothing
- Produces:
  - `export type SupportedLocale = "en" | "es"`
  - `export function setFormatLocale(locale: string): void`
  - `export function currentFormatLocale(): SupportedLocale`
  - `formatMoney(value: number): string`, `formatTokens(value: number): string`, `formatCount(value: number): string` — signatures unchanged
  - `formatDateTime(value: string, timeZone?: string): string | null` — signature unchanged

- [ ] **Step 1: Write the failing tests**

Replace the `describe("Formatters", ...)` block at `apps/web/test/format.test.ts:14-42` with the version below. Leave the `Axis formatting`, `Absolute instants`, and `Quota thresholds` blocks untouched for now — Tasks 2–4 rewrite them.

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBucketLabel,
  formatCoverage,
  formatCount,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatTokens,
  quotaStatus,
  setFormatLocale,
} from "../src/model/format.ts";

/**
 * Every locale-sensitive assertion runs through this helper. The locale is set
 * explicitly and always restored, so no test depends on the machine's default
 * and no test leaks a locale into the next one.
 */
function inLocale(locale: string, body: () => void): void {
  try {
    setFormatLocale(locale);
    body();
  } finally {
    setFormatLocale("en");
  }
}

describe("Formatters", () => {
  it("formats money to cents with an explicit currency code", () => {
    inLocale("en", () => {
      assert.equal(formatMoney(142.3), "USD\u00a0142.30");
      assert.equal(formatMoney(0), "USD\u00a00.00");
    });
    // Spanish puts the code after the amount and uses a comma decimal.
    inLocale("es", () => {
      assert.equal(formatMoney(142.3), "142,30\u00a0USD");
      assert.equal(formatMoney(0), "0,00\u00a0USD");
    });
  });

  it("formats token counts compactly from a thousand upward", () => {
    inLocale("en", () => {
      assert.equal(formatTokens(645_000), "645K");
      assert.equal(formatTokens(1_240_000), "1.2M");
      assert.equal(formatTokens(812), "812");
      // Pins the exact transition. Without these two, `< 1_000` and `<= 1_000` are
      // indistinguishable to the suite and a refactor can flip the boundary silently.
      assert.equal(formatTokens(999), "999");
      assert.equal(formatTokens(1_000), "1K");
    });
    inLocale("es", () => {
      assert.equal(formatTokens(645_000), "645\u00a0mil");
      assert.equal(formatTokens(1_240_000), "1,2\u00a0M");
      assert.equal(formatTokens(999), "999");
      assert.equal(formatTokens(1_000), "1\u00a0mil");
    });
  });

  it("groups exact counts as the locale does, not as English does", () => {
    inLocale("en", () => {
      assert.equal(formatCount(4900), "4,900");
      assert.equal(formatCount(10_000), "10,000");
    });
    // Spanish CLDR does not group four-digit integers and does group five.
    // This asymmetry is correct and must not be overridden with useGrouping.
    inLocale("es", () => {
      assert.equal(formatCount(4900), "4900");
      assert.equal(formatCount(10_000), "10.000");
    });
  });

  it("rejects an unsupported locale rather than formatting in it", () => {
    inLocale("en", () => {
      setFormatLocale("fr-CA");
      assert.equal(
        formatMoney(142.3),
        "USD\u00a0142.30",
        "falls back to en, never to the OS locale",
      );
    });
  });
});
```

Then replace the `describe("Absolute instants", ...)` block at `:67-92`:

```ts
describe("Absolute instants", () => {
  // The time zone is passed explicitly here and nowhere else: real callers want
  // the reader's own zone, but a suite that depended on it would pass or fail
  // according to the machine running it.
  it("renders an ISO instant in the active locale", () => {
    inLocale("en", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "UTC"),
        "Jul 23, 2026, 12:06 PM",
        "month-first wording with a 12-hour clock",
      );
    });
    inLocale("es", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "UTC"),
        "23 jul 2026, 12:06",
        "day-first wording with a 24-hour clock",
      );
    });
  });

  it("converts into the requested zone rather than reporting UTC", () => {
    inLocale("en", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "America/Chicago"),
        "Jul 23, 2026, 7:06 AM",
      );
    });
    inLocale("es", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "America/Chicago"),
        "23 jul 2026, 7:06",
      );
    });
  });

  it("returns null for an unparseable instant instead of the words Invalid Date", () => {
    // A caller splices this into "resets {value}"; the literal string
    // "Invalid Date" reads as a real reset time to anyone skimming.
    assert.equal(formatDateTime("not-a-date"), null);
    assert.equal(formatDateTime(""), null);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `setFormatLocale` is not exported from `format.ts` (`SyntaxError` or `TypeError: setFormatLocale is not a function`).

- [ ] **Step 3: Rewrite the head of `format.ts`**

Replace `apps/web/src/model/format.ts:1-46` with:

```ts
export type SupportedLocale = "en" | "es";

const SUPPORTED: readonly SupportedLocale[] = ["en", "es"];
const DEFAULT_LOCALE: SupportedLocale = "en";

/**
 * The locale every formatter below uses. Module-level rather than a parameter so
 * `model/` stays free of a locale argument its pure functions do not
 * conceptually need.
 *
 * It is NEVER initialised from the runtime default. An unsupported value falls
 * back to `en` instead of to the OS locale, so contributor and CI machines with
 * a non-English default produce identical output — the determinism the previous
 * hardcoded `en-US` pin existed to protect.
 *
 * `i18n/index.ts` keeps this in step with the UI language, and the ordering of
 * that listener registration is load-bearing — see the comment there.
 */
let activeLocale: SupportedLocale = DEFAULT_LOCALE;

export function setFormatLocale(locale: string): void {
  const base = locale.split("-")[0];
  activeLocale = SUPPORTED.find((candidate) => candidate === base) ?? DEFAULT_LOCALE;
}

export function currentFormatLocale(): SupportedLocale {
  return activeLocale;
}

/**
 * Formatters are cached per locale and built on first use, never captured at
 * module load. Constructing an `Intl` object is comparatively expensive and
 * these run once per table cell, so the cache is not premature — but a formatter
 * captured in a module-level const would keep formatting in whichever locale was
 * active at import time, silently, forever.
 */
function cached<T>(store: Map<SupportedLocale, T>, build: (locale: SupportedLocale) => T): T {
  const existing = store.get(activeLocale);
  if (existing) return existing;
  const created = build(activeLocale);
  store.set(activeLocale, created);
  return created;
}

const moneyCache = new Map<SupportedLocale, Intl.NumberFormat>();
const plainCache = new Map<SupportedLocale, Intl.NumberFormat>();
const compactCache = new Map<SupportedLocale, Intl.NumberFormat>();

/**
 * The ISO code rather than a symbol, in every locale. This dashboard reports
 * US-dollar API rates to readers who may not be in the US, and a bare "$" is
 * ambiguous across a dozen currencies. Note that CLDR places the code before the
 * amount in English and after it in Spanish; both are correct and neither is
 * overridden here.
 */
const money = () =>
  cached(
    moneyCache,
    (locale) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "code",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
  );

const plain = () => cached(plainCache, (locale) => new Intl.NumberFormat(locale));

const compact = () =>
  cached(
    compactCache,
    (locale) => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
  );

export function formatMoney(value: number): string {
  return money().format(value);
}

export function formatTokens(value: number): string {
  return value < 1_000 ? plain().format(value) : compact().format(value);
}

/**
 * Exact counts of things — tasks, models, records. Grouped rather than
 * `String(value)`, so a count reads the way every other number on the page does.
 * Never compacted: a count of tasks is something you might reconcile against a
 * list, so it keeps every digit.
 *
 * Grouping is the locale's decision, not ours. English groups from four digits
 * ("4,900"); Spanish groups only from five ("4900", but "10.000"). Forcing
 * `useGrouping: "always"` to make the two agree would render Spanish
 * incorrectly, so the outputs are allowed to differ.
 */
export function formatCount(value: number): string {
  return plain().format(value);
}
```

- [ ] **Step 4: Update `formatDateTime` to use the active locale**

Replace `apps/web/src/model/format.ts:92-113` (the `formatDateTime` doc comment and body) with:

```ts
/**
 * Absolute instants rendered in the reader's own time zone — "resets at 3pm" is
 * only useful in the zone they are sitting in — but under the active UI locale,
 * so the wording and ordering stay consistent with every other string on the
 * page. Calling `Date#toLocaleString()` directly would take BOTH from the OS and
 * is the bypass this module exists to prevent.
 *
 * `timeZone` is an override for tests only: without it the output depends on the
 * machine running the suite, which is exactly the non-determinism this module
 * guards against.
 *
 * Returns null rather than the string "Invalid Date" when the input cannot be
 * parsed, so a caller renders nothing instead of pasting that into a sentence.
 */
export function formatDateTime(value: string, timeZone?: string): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(
    currentFormatLocale(),
    timeZone ? { ...options, timeZone } : options,
  ).format(instant);
}
```

Note: `formatDateTime` is deliberately NOT cached — the optional `timeZone` argument varies per call, so a per-locale cache would be wrong.

- [ ] **Step 5: Run the tests**

Run: `bun run test`
Expected: The `Formatters` and `Absolute instants` blocks PASS. The `Axis formatting` block still FAILS — Tasks 2 and 3 fix it. Confirm the failures are only `formatPercent`, `formatMoneyCompact`, and `formatBucketLabel`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/model/format.ts apps/web/test/format.test.ts
git commit -m "Format money, tokens, counts, and instants in the active locale"
```

---

### Task 2: Percent and compact-number formatting

`formatPercent` currently bypasses `Intl` entirely. `formatMoneyCompact` is renamed and loses its currency, because axis ticks cannot carry a currency code within the gutter.

**Files:**

- Modify: `apps/web/src/model/format.ts` (`formatPercent`, and the `moneyCompact` formatter plus `formatMoneyCompact`)
- Modify: `apps/web/src/components/headline.tsx:17`, `:45`
- Test: `apps/web/test/format.test.ts` (`Axis formatting` block, percent assertion)

**Interfaces:**

- Consumes: `setFormatLocale` from Task 1
- Produces:
  - `formatPercent(ratio: number): string` — signature unchanged, output now locale-formatted, one decimal
  - `formatWholePercent(percent: number): string` — takes an ALREADY-whole percentage, renders no decimal
  - `formatNumberCompact(value: number): string` — **replaces** `formatMoneyCompact`, which is deleted

- [ ] **Step 1: Write the failing tests**

Replace the percent assertion (the `it("formats a ratio as a percent with one decimal", ...)` block) and the whole `describe("Axis formatting", ...)` block's first test:

```ts
it("formats a ratio as a percent in the active locale", () => {
  inLocale("en", () => {
    assert.equal(formatPercent(0.682), "68.2%");
  });
  // Spanish uses a comma decimal and a NO-BREAK SPACE before the sign.
  inLocale("es", () => {
    assert.equal(formatPercent(0.682), "68,2\u00a0%");
  });
});

/**
 * Quota meters and token-mix shares arrive already whole and are read at a
 * glance, so they keep no decimal — "82%", not "82.0%". Separate from
 * `formatPercent` rather than a flag on it, because the two also differ in
 * what they take: a ratio there, a percentage here. One function taking
 * either would be a transposition waiting to happen.
 */
it("formats an already-whole percentage without a decimal", () => {
  inLocale("en", () => {
    assert.equal(formatWholePercent(82), "82%");
    assert.equal(formatWholePercent(0), "0%");
    assert.equal(formatWholePercent(100), "100%");
  });
  inLocale("es", () => {
    assert.equal(formatWholePercent(82), "82\u00a0%");
  });
});
```

Add `formatWholePercent` to the test file's import list alongside `formatNumberCompact`.

```ts
describe("Axis formatting", () => {
  it("keeps axis numbers short enough for the gutter", () => {
    // The 48px/11px gutter holds about seven characters. Currency is stated once
    // on the measure toggle instead, because "USD 8.9K" (8) and "8,9 mil USD"
    // (11) both clip — which turns a precise figure into a misread one.
    inLocale("en", () => {
      assert.equal(formatNumberCompact(8947), "8.9K");
      assert.equal(formatNumberCompact(1_240_000), "1.2M");
      assert.equal(formatNumberCompact(142.3), "142.3");
      assert.equal(formatNumberCompact(0), "0");
    });
    inLocale("es", () => {
      assert.equal(formatNumberCompact(8947), "8,9\u00a0mil");
      assert.equal(formatNumberCompact(1_240_000), "1,2\u00a0M");
      assert.equal(formatNumberCompact(142.3), "142,3");
      assert.equal(formatNumberCompact(0), "0");
    });
  });
```

Update the import block at the top of the test file: replace `formatMoneyCompact` with `formatNumberCompact`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `formatNumberCompact` is not exported, and the Spanish percent assertion fails against the current `toFixed` implementation.

- [ ] **Step 3: Implement both helpers**

In `apps/web/src/model/format.ts`, add a percent cache beside the others:

```ts
const percentCache = new Map<SupportedLocale, Intl.NumberFormat>();
const wholePercentCache = new Map<SupportedLocale, Intl.NumberFormat>();

const percent = () =>
  cached(
    percentCache,
    (locale) =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
  );

const wholePercent = () =>
  cached(
    wholePercentCache,
    (locale) => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }),
  );
```

Replace the existing `formatPercent` (currently `return \`${(ratio * 100).toFixed(1)}%\`;`) with:

```ts
/**
 * Takes a ratio, not a percentage. `style: "percent"` performs the ×100 itself,
 * so callers must not pre-multiply. Going through `Intl` rather than
 * `toFixed(1) + "%"` is what gets the decimal separator and the space before the
 * sign right — Spanish writes "68,2 %".
 */
export function formatPercent(ratio: number): string {
  return percent().format(ratio);
}

/**
 * Takes an ALREADY-whole percentage (82, not 0.82) and renders it without a
 * decimal, for figures read at a glance: quota meters and token-mix shares.
 *
 * Deliberately a second function rather than a flag on `formatPercent`, because
 * the two differ in what they consume as well as how they render. A single
 * function taking either would make `formatPercent(82)` — meaning 8,200% —
 * type-check and render silently.
 */
export function formatWholePercent(percentage: number): string {
  return wholePercent().format(percentage / 100);
}
```

Delete the `moneyCompact` formatter and `formatMoneyCompact`, and add in their place:

```ts
/**
 * A number for a chart axis, where `formatMoney` does not fit. A 48px-wide axis
 * gutter at 11px type holds roughly seven characters; "USD 8,947.32" is twelve
 * and gets clipped. Ticks are for scale, so they lose both the cents and the
 * currency — the unit is stated once on the measure toggle above the chart, and
 * the hero figure beside it carries the full "USD 8,947.32".
 */
export function formatNumberCompact(value: number): string {
  return compact().format(value);
}
```

- [ ] **Step 4: Update the only call site**

In `apps/web/src/components/headline.tsx`, change the import at line 17 from `formatMoneyCompact` to `formatNumberCompact`, and line 45 from:

```tsx
const axisFormat = measure === "cost" ? formatMoneyCompact : formatTokens;
```

to:

```tsx
const axisFormat = measure === "cost" ? formatNumberCompact : formatTokens;
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `bun run test && bun run typecheck`
Expected: `Formatters`, `Absolute instants`, and the axis-number test PASS. Only `formatBucketLabel` still fails (Task 3). Typecheck passes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/model/format.ts apps/web/src/components/headline.tsx apps/web/test/format.test.ts
git commit -m "Format percentages through Intl and drop currency from axis ticks"
```

---

### Task 3: Locale-correct timeline bucket labels

The current implementation slices fixed-width ISO strings positionally. Spanish orders day before month, so this must go through `Intl`.

**Files:**

- Modify: `apps/web/src/model/format.ts:58-70` (`formatBucketLabel`)
- Test: `apps/web/test/format.test.ts` (bucket label tests in `Axis formatting`)

**Interfaces:**

- Consumes: `setFormatLocale`, `currentFormatLocale` from Task 1
- Produces: `formatBucketLabel(bucket: string): string` — signature unchanged

- [ ] **Step 1: Write the failing tests**

Replace the two bucket-label tests at the end of the `Axis formatting` block:

```ts
  /**
   * The two bucket shapes need DIFFERENT time zones, and conflating them is an
   * off-by-one-day bug that still renders a plausible date.
   *
   * A date-only bucket is a calendar day the server already decided; it parses as
   * UTC midnight, so formatting it in a negative-offset zone would render the
   * PREVIOUS day. It is pinned here under America/Chicago precisely to catch that.
   */
  it("labels a daily bucket as a calendar day, without its year", () => {
    inLocale("en", () => {
      assert.equal(formatBucketLabel("2026-07-20"), "Jul 20");
      assert.equal(formatBucketLabel("2026-07-20", "America/Chicago"), "Jul 20");
    });
    inLocale("es", () => {
      assert.equal(formatBucketLabel("2026-07-20"), "20 jul");
      assert.equal(formatBucketLabel("2026-07-20", "America/Chicago"), "20 jul");
    });
  });

  it("labels an hourly bucket with the hour, in the reader's zone", () => {
    // The `last24` timeframe is the only one producing this shape. Unlike a
    // daily bucket this IS an instant, so it converts into the reader's zone.
    inLocale("en", () => {
      assert.equal(formatBucketLabel("2026-07-20T09:00:00.000Z", "UTC"), "Jul 20, 9 AM");
      assert.equal(formatBucketLabel("2026-07-20T21:00:00.000Z", "UTC"), "Jul 20, 9 PM");
    });
    // Spanish uses a 24-hour clock, so the hour carries no AM/PM marker.
    inLocale("es", () => {
      assert.equal(formatBucketLabel("2026-07-20T09:00:00.000Z", "UTC"), "20 jul, 9");
      assert.equal(formatBucketLabel("2026-07-20T21:00:00.000Z", "UTC"), "20 jul, 21");
    });
  });

  it("passes an unparseable bucket through rather than rendering Invalid Date", () => {
    inLocale("en", () => {
      assert.equal(formatBucketLabel("not-a-bucket"), "not-a-bucket");
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `formatBucketLabel("2026-07-20")` returns `"07-20"`, not `"Jul 20"`, and the function takes only one argument.

- [ ] **Step 3: Implement**

Replace `apps/web/src/model/format.ts:58-70` with:

```ts
const dayLabelCache = new Map<SupportedLocale, Intl.DateTimeFormat>();

/**
 * Renders an analysis timeline bucket as an axis label. Buckets are ISO and come
 * in exactly two shapes from `timelineBucket`: `2026-07-20` for every timeframe
 * except `last24`, and a full `2026-07-20T09:00:00.000Z` for that one. The year
 * is dropped because every bucket on an axis shares it.
 *
 * The two shapes take DIFFERENT time zones on purpose:
 *
 * - A date-only bucket is a calendar day the server already decided. It parses
 *   as UTC midnight, so formatting it in the reader's zone would render the
 *   PREVIOUS day for anyone west of Greenwich — a wrong label that still looks
 *   like a date. It is therefore always formatted in UTC.
 * - An hourly bucket is a real instant, and is converted into the reader's zone
 *   for the same reason `formatDateTime` does: an hour is only useful in the
 *   zone the reader is sitting in.
 *
 * `timeZone` overrides the hourly branch for tests only; the daily branch
 * ignores it, which the suite pins.
 */
export function formatBucketLabel(bucket: string, timeZone?: string): string {
  const instant = new Date(bucket);
  // Anything the server did not produce is passed through untouched rather than
  // rendered as "Invalid Date", which reads as a real label on an axis.
  if (Number.isNaN(instant.getTime())) return bucket;

  const hourly = bucket.length > 10;
  if (!hourly) {
    const formatter = cached(
      dayLabelCache,
      (locale) =>
        new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" }),
    );
    return formatter.format(instant);
  }

  // Not cached: the zone varies per call, so a per-locale cache would be wrong.
  return new Intl.DateTimeFormat(currentFormatLocale(), {
    month: "short",
    day: "numeric",
    hour: "numeric",
    ...(timeZone ? { timeZone } : {}),
  }).format(instant);
}
```

- [ ] **Step 4: Update the chart call sites**

`headline.tsx` passes `formatBucketLabel` as a `tickFormatter` and inside a `labelFormatter`. Both now pass a single string, which still matches the signature — but recharts calls `tickFormatter(value, index)`, and the second argument is a number, which would land in `timeZone`. Change `apps/web/src/components/headline.tsx:87` from:

```tsx
tickFormatter = { formatBucketLabel };
```

to:

```tsx
              // Wrapped, not passed by reference: recharts calls tickFormatter
              // with (value, index), and the index would land in the timeZone
              // parameter.
              tickFormatter={(value) => formatBucketLabel(String(value))}
```

Line 102 (`labelFormatter`) already wraps and needs no change.

- [ ] **Step 5: Run the full suite**

Run: `bun run test && bun run typecheck`
Expected: PASS — all of `apps/web/test/format.test.ts` is green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/model/format.ts apps/web/src/components/headline.tsx apps/web/test/format.test.ts
git commit -m "Render timeline bucket labels through Intl with per-shape time zones"
```

---

### Task 4: Coverage message returns a key, not prose

`formatCoverage` returns one of three English sentences. It becomes a key-and-params pair so the sentence lives in the translation files while the branching stays pure and tested.

**Files:**

- Modify: `apps/web/src/model/format.ts:76-90` (delete `formatCoverage`)
- Create: `apps/web/src/model/coverage.ts`
- Modify: `apps/web/src/components/headline.tsx:15`, `:53-59` (deferred to Task 9 — this task leaves a compile error only if the old export is removed without updating the caller, so update the caller here too)
- Test: `apps/web/test/coverage.test.ts`
- Test: `apps/web/test/format.test.ts` (remove the two `formatCoverage` tests and its import)

**Interfaces:**

- Consumes: nothing from earlier tasks
- Produces:
  - `export type CoverageMessage = { key: "headline.coverage.none" | "headline.coverage.all" | "headline.coverage.partial"; params: { records: number; priced: number } }`
  - `export function coverageMessage(input: { records: number; priced: number }): CoverageMessage`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/coverage.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageMessage } from "../src/model/coverage.ts";

describe("Coverage message", () => {
  /**
   * Named fields rather than two positional numbers: a transposed positional
   * call type-checks and yields plausible-but-wrong text ("4,900 of 4,812
   * records priced") directly under the hero figure, where a reader would trust
   * it.
   */
  it("reports full coverage without a qualifier", () => {
    assert.deepEqual(coverageMessage({ records: 4900, priced: 4900 }), {
      key: "headline.coverage.all",
      params: { records: 4900, priced: 4900 },
    });
  });

  it("discloses the shortfall when some records are unpriced", () => {
    assert.deepEqual(coverageMessage({ records: 4900, priced: 4812 }), {
      key: "headline.coverage.partial",
      params: { records: 4900, priced: 4812 },
    });
  });

  /**
   * An empty period is a DIFFERENT message, not a plural form of the others.
   * Neither English nor Spanish has a CLDR "zero" plural category, so relying on
   * a plural suffix here would be wrong in both.
   */
  it("describes an empty period with its own message", () => {
    assert.deepEqual(coverageMessage({ records: 0, priced: 0 }), {
      key: "headline.coverage.none",
      params: { records: 0, priced: 0 },
    });
  });

  // Always returns a renderable message, never null — the sole consumer splices
  // it into a sentence with no conditional, so the empty case belongs here
  // rather than duplicated as a null-guard at the call site.
  it("always returns a key", () => {
    for (const input of [
      { records: 0, priced: 0 },
      { records: 1, priced: 0 },
      { records: 1, priced: 1 },
    ]) {
      assert.ok(coverageMessage(input).key.startsWith("headline.coverage."));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test`
Expected: FAIL — `Cannot find module '../src/model/coverage.ts'`.

- [ ] **Step 3: Create the module**

Create `apps/web/src/model/coverage.ts`:

```ts
export type CoverageKey =
  "headline.coverage.none" | "headline.coverage.all" | "headline.coverage.partial";

export interface CoverageMessage {
  key: CoverageKey;
  params: { records: number; priced: number };
}

/**
 * Chooses which sentence describes pricing coverage, without composing it.
 *
 * Returns a key and params rather than prose so the wording lives in the
 * translation files while the branching stays here, pure and independently
 * tested. `model/` never imports `t`.
 *
 * Named fields rather than two positional numbers: a transposed positional call
 * type-checks and yields plausible-but-wrong text ("4,900 of 4,812 records
 * priced") directly under the hero figure, where a reader would trust it.
 *
 * Always returns a message, never null — the sole consumer splices it into a
 * sentence with no conditional, so the empty case belongs here rather than
 * duplicated as a null-guard at the call site.
 */
export function coverageMessage({
  records,
  priced,
}: {
  records: number;
  priced: number;
}): CoverageMessage {
  const params = { records, priced };
  if (records === 0) return { key: "headline.coverage.none", params };
  return priced === records
    ? { key: "headline.coverage.all", params }
    : { key: "headline.coverage.partial", params };
}
```

- [ ] **Step 4: Remove `formatCoverage` and its tests**

Delete `formatCoverage` and its doc comment from `apps/web/src/model/format.ts:76-90`. Remove `formatCoverage` from the import list in `apps/web/test/format.test.ts`, and delete the two tests that call it (`"reports priced coverage only when some records are unpriced"` and `"describes an empty period in prose when there are no records"`) — `coverage.test.ts` now owns that behaviour.

- [ ] **Step 5: Keep `headline.tsx` compiling**

`headline.tsx` still imports `formatCoverage`. Replace the import at line 15 and the usage at lines 53-59 with a temporary literal rendering; Task 9 replaces it with `t`.

In the import block, drop `formatCoverage` and add:

```tsx
import { coverageMessage } from "../model/coverage.ts";
```

Replace lines 53-59 with:

```tsx
<p className="panel-label">
  {/* Rendered through t() in the string-extraction task; this keeps the
                component compiling in the meantime. */}
  {
    coverageMessage({
      records: data.totals.records,
      priced: data.totals.pricedRecords,
    }).key
  }{" "}
  · estimated at your configured API rates, not a bill
</p>
```

- [ ] **Step 6: Run the suite and commit**

Run: `bun run test && bun run typecheck`
Expected: PASS.

```bash
git add apps/web/src/model/coverage.ts apps/web/src/model/format.ts apps/web/src/components/headline.tsx apps/web/test/coverage.test.ts apps/web/test/format.test.ts
git commit -m "Return a coverage message key from the model instead of English prose"
```

---

### Task 5: Harness label takes its unknown-state wording as a parameter

**Files:**

- Modify: `apps/web/src/model/harness.ts:24-56`
- Modify: `apps/web/src/views/overview.tsx:20`, `apps/web/src/views/breakdown.tsx:42`, `apps/web/src/views/history.tsx:95` (call sites, temporary literal until their extraction tasks)
- Test: `apps/web/test/harness.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks
- Produces:
  - `harnessLabel(harnessId: string, unknownLabel: string): string` — **second parameter is new and required**
  - `usageSourceLabel(usageSourceId: string): string` — signature unchanged
  - `isUnknownHarness(harnessId: string): boolean` — unchanged
  - `harnessColor(harnessId: string): string` — unchanged

- [ ] **Step 1: Write the failing tests**

Replace the whole of `apps/web/test/harness.test.ts` with:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { harnessLabel, isUnknownHarness, usageSourceLabel } from "../src/model/harness.ts";

// The translated wording is injected, exactly as the component will inject it.
const UNKNOWN = "Unknown harness";

describe("Harness labels", () => {
  it("names the harnesses it knows", () => {
    assert.equal(harnessLabel("codex", UNKNOWN), "Codex");
    assert.equal(harnessLabel("claude-code", UNKNOWN), "Claude Code");
  });

  // Product names are never translated, so the injected wording must not reach
  // a harness the table can name.
  it("ignores the injected wording for a known harness", () => {
    assert.equal(harnessLabel("codex", "Entorno desconocido"), "Codex");
  });

  it("renders the unknown sentinel as the caller's wording, not a raw token", () => {
    assert.equal(harnessLabel("unknown", UNKNOWN), "Unknown harness");
    assert.equal(harnessLabel("unknown", "Entorno desconocido"), "Entorno desconocido");
  });

  it("passes an unrecognised id through rather than inventing a name", () => {
    assert.equal(harnessLabel("windsurf", UNKNOWN), "windsurf");
  });

  it("flags anything it cannot name so callers can style it apart", () => {
    assert.equal(isUnknownHarness("codex"), false);
    assert.equal(isUnknownHarness("claude-code"), false);
    assert.equal(isUnknownHarness("unknown"), true);
    assert.equal(isUnknownHarness("windsurf"), true);
  });
});

describe("Usage source labels", () => {
  it("names a registered source through its harness", () => {
    assert.equal(usageSourceLabel("codex-local"), "Codex");
    assert.equal(usageSourceLabel("claude-code-local"), "Claude Code");
  });

  // `harnessForSource` maps every unregistered source to the same "unknown"
  // sentinel. Labelling by harness would render two different accounts' quota
  // meters identically while they showed different percentages.
  it("keeps unregistered sources distinguishable from each other", () => {
    assert.equal(usageSourceLabel("windsurf-local"), "windsurf-local");
    assert.equal(usageSourceLabel("aider-local"), "aider-local");
    assert.notEqual(usageSourceLabel("windsurf-local"), usageSourceLabel("aider-local"));
  });

  // It resolves only to names the table holds, so it needs no translated
  // wording and takes no such parameter.
  it("never renders an unregistered source as a named harness", () => {
    assert.notEqual(usageSourceLabel("windsurf-local"), "Unknown harness");
    assert.notEqual(usageSourceLabel("windsurf-local"), "Codex");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun run test`
Expected: FAIL — `harnessLabel("unknown", "Entorno desconocido")` returns `"Unknown harness"`, because the current implementation ignores the second argument.

- [ ] **Step 3: Implement**

Replace `apps/web/src/model/harness.ts:24-56` with:

```ts
/**
 * Display label for a harness id. An id we do not recognise — including the
 * "unknown" sentinel a legacy or unregistered usage source decodes to — renders
 * as the caller's `unknownLabel` rather than a bare token, so it reads as a
 * state rather than as the name of something the user installed.
 *
 * The wording is injected rather than held here because it is translated and
 * `model/` never imports `t`. This is the same idiom `RankList` uses for its
 * `emptyLabel` prop. The names IN the table are product names and are never
 * translated in any locale.
 */
export function harnessLabel(harnessId: string, unknownLabel: string): string {
  return HARNESS_LABELS[harnessId] ?? (harnessId === "unknown" ? unknownLabel : harnessId);
}

/** True when the id is not a harness we know how to name. Callers style these apart. */
export function isUnknownHarness(harnessId: string): boolean {
  return !(harnessId in HARNESS_LABELS);
}

/**
 * Display label for a USAGE SOURCE id, for panels keyed by source rather than by
 * harness — the quota meters, where each row is one account on one host.
 *
 * Reads the same `HARNESS_LABELS` table as `harnessLabel`, so the two cannot
 * drift into disagreeing about what "Codex" is called. It resolves only to names
 * that table holds, never to the unknown state, so it needs no translated
 * wording and takes no such parameter.
 *
 * Unregistered sources fall back to the raw source id, NOT to the unknown label.
 * `harnessForSource` maps every unregistered source to the same "unknown"
 * sentinel, so labelling by harness would render two different accounts' quota
 * meters identically while showing different percentages — the reader could not
 * tell which was which. The raw id is ugly on purpose: it stays distinguishable
 * and still reads as something needing registration.
 */
export function usageSourceLabel(usageSourceId: string): string {
  return HARNESS_LABELS[harnessForSource(usageSourceId)] ?? usageSourceId;
}
```

- [ ] **Step 4: Update the three call sites**

These take a literal for now; their extraction tasks replace it with `t("common.unknownHarness")`.

`apps/web/src/views/overview.tsx:20`:

```tsx
const harnessRows = data.byHarness.map((row) => ({
  ...row,
  key: harnessLabel(row.key, "Unknown harness"),
}));
```

`apps/web/src/views/breakdown.tsx:42`:

```tsx
      ? data.byHarness.map((row) => ({ ...row, key: harnessLabel(row.key, "Unknown harness") }))
```

`apps/web/src/views/history.tsx:95`:

```tsx
{
  harnessLabel(harness, "Unknown harness");
}
```

- [ ] **Step 5: Run the suite and commit**

Run: `bun run test && bun run typecheck`
Expected: PASS.

```bash
git add apps/web/src/model/harness.ts apps/web/src/views/overview.tsx apps/web/src/views/breakdown.tsx apps/web/src/views/history.tsx apps/web/test/harness.test.ts
git commit -m "Inject the unknown-harness wording rather than holding it in the model"
```

---

### Task 6: Language resolution

Pure resolution logic, testable without a browser. No i18next yet.

**Files:**

- Create: `apps/web/src/i18n/language.ts`
- Test: `apps/web/test/language.test.ts`

**Interfaces:**

- Consumes: `SupportedLocale` from `model/format.ts` (Task 1)
- Produces:
  - `export const SUPPORTED_LANGUAGES: readonly [{ value: "en"; label: "English" }, { value: "es"; label: "Español" }]`
  - `export const LANGUAGE_STORAGE_KEY = "llm-usage-monitor.language"`
  - `export function resolveLanguage(stored: string | null, preferred: readonly string[]): SupportedLocale`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/language.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLanguage, SUPPORTED_LANGUAGES } from "../src/i18n/language.ts";

describe("Language resolution", () => {
  it("prefers a stored choice over the browser's preference", () => {
    assert.equal(resolveLanguage("es", ["en-GB", "en"]), "es");
    assert.equal(resolveLanguage("en", ["es-ES"]), "en");
  });

  it("falls back to the browser's preference when nothing is stored", () => {
    assert.equal(resolveLanguage(null, ["es-ES", "en"]), "es");
    assert.equal(resolveLanguage(null, ["en-US"]), "en");
  });

  // A stale or hand-edited localStorage value must not wedge the UI into a
  // language with no resources behind it.
  it("ignores a stored value that is not supported", () => {
    assert.equal(resolveLanguage("fr", ["es-ES"]), "es");
    assert.equal(resolveLanguage("", ["es-ES"]), "es");
  });

  // Regional Spanish is still Spanish. Matching on the base subtag is what makes
  // es-419, es-MX, and es-AR all resolve rather than silently landing on English.
  it("matches on the base subtag, not the full tag", () => {
    assert.equal(resolveLanguage(null, ["es-419"]), "es");
    assert.equal(resolveLanguage(null, ["es-MX"]), "es");
    assert.equal(resolveLanguage("es-AR", []), "es");
  });

  it("walks the browser list in order and takes the first supported entry", () => {
    assert.equal(resolveLanguage(null, ["fr-FR", "de", "es-ES", "en"]), "es");
  });

  it("defaults to English when nothing matches", () => {
    assert.equal(resolveLanguage(null, ["fr-FR", "de"]), "en");
    assert.equal(resolveLanguage(null, []), "en");
  });

  it("offers each supported language under its own endonym", () => {
    assert.deepEqual(SUPPORTED_LANGUAGES, [
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
    ]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun run test`
Expected: FAIL — `Cannot find module '../src/i18n/language.ts'`.

- [ ] **Step 3: Implement**

Create `apps/web/src/i18n/language.ts`:

```ts
import type { SupportedLocale } from "../model/format.ts";

/**
 * Each language is offered under its OWN name, not translated into the current
 * UI language. Someone who has landed in a language they cannot read needs to
 * recognise their own in the list to get out again.
 */
export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
] as const satisfies ReadonlyArray<{ value: SupportedLocale; label: string }>;

export const LANGUAGE_STORAGE_KEY = "llm-usage-monitor.language";

const DEFAULT_LANGUAGE: SupportedLocale = "en";

function supported(tag: string | null | undefined): SupportedLocale | undefined {
  if (!tag) return undefined;
  // Base subtag only: es-419, es-MX, and es-AR are all Spanish, and matching the
  // full tag would drop every one of them to English.
  const base = tag.split("-")[0]?.toLowerCase();
  return SUPPORTED_LANGUAGES.find((language) => language.value === base)?.value;
}

/**
 * Resolves the UI language from an explicit stored choice and the browser's
 * ordered preference list, in that order of precedence.
 *
 * Pure, and takes both inputs as parameters rather than reading `localStorage`
 * and `navigator` itself, so the whole decision is testable under `node --test`
 * with no DOM. `i18n/index.ts` supplies the real values.
 *
 * An unsupported stored value is ignored rather than honoured: it would
 * otherwise wedge the UI into a language with no resources behind it, and the
 * value is user-editable.
 */
export function resolveLanguage(
  stored: string | null,
  preferred: readonly string[],
): SupportedLocale {
  const chosen = supported(stored);
  if (chosen) return chosen;
  for (const tag of preferred) {
    const match = supported(tag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}
```

- [ ] **Step 4: Run the test**

Run: `bun run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/language.ts apps/web/test/language.test.ts
git commit -m "Resolve the UI language from stored choice and browser preference"
```

---

### Task 7: i18next runtime

Wires i18next up with typed resources. After this task, `bun run typecheck` verifies that every `t()` key used anywhere exists in `en.json` — which is what makes the string-extraction tasks that follow verifiable without a React test runner.

**Files:**

- Modify: `apps/web/package.json` (dependencies)
- Create: `apps/web/src/i18n/locales/en.json`
- Create: `apps/web/src/i18n/locales/es.json`
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/i18n/i18next.d.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**

- Consumes: `setFormatLocale` (Task 1), `resolveLanguage`, `LANGUAGE_STORAGE_KEY`, `SUPPORTED_LANGUAGES` (Task 6)
- Produces:
  - default export `i18n` from `apps/web/src/i18n/index.ts`
  - `export function changeLanguage(language: SupportedLocale): void`
  - Typed `t` keys via module augmentation — `useTranslation()` from `react-i18next` now autocompletes and type-checks against `en.json`

- [ ] **Step 1: Add the dependencies**

```bash
bun add --cwd apps/web i18next react-i18next
```

Verify `apps/web/package.json` gained both under `dependencies`, and that nothing else was added.

- [ ] **Step 2: Create the seed resource files**

Create `apps/web/src/i18n/locales/en.json` with the keys Task 4 already depends on plus the shared ones. Later tasks append to this file.

```json
{
  "common": {
    "unknownHarness": "Unknown harness",
    "notReported": "Not reported",
    "unpriced": "Unpriced"
  },
  "headline": {
    "coverage": {
      "none": "No records in this period",
      "all": "{{records}} records priced",
      "partial": "{{priced}} of {{records}} records priced"
    }
  },
  "settings": {
    "language": {
      "tab": "Language",
      "heading": "Language",
      "hint": "Applies to this browser only. Numbers, dates, and currency follow the language you choose."
    }
  }
}
```

Interpolated numbers are always passed in **already formatted** by `model/format.ts`. Do not use i18next's built-in `{{value, number}}` formatter anywhere in this plan: it would open a second formatting path with its own locale state, and the two could disagree. Never name an interpolation parameter `count` either — i18next reserves it to select plural forms, and a pre-formatted string in that slot selects the wrong one.

Create `apps/web/src/i18n/locales/es.json`:

```json
{
  "common": {
    "unknownHarness": "Entorno desconocido",
    "notReported": "No informado",
    "unpriced": "Sin tarifa"
  },
  "headline": {
    "coverage": {
      "none": "No hay registros en este periodo",
      "all": "{{records}} registros con tarifa",
      "partial": "{{priced}} de {{records}} registros con tarifa"
    }
  },
  "settings": {
    "language": {
      "tab": "Idioma",
      "heading": "Idioma",
      "hint": "Se aplica solo a este navegador. Los números, las fechas y la moneda siguen el idioma que elijas."
    }
  }
}
```

- [ ] **Step 3: Create the runtime**

Create `apps/web/src/i18n/index.ts`:

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { setFormatLocale, type SupportedLocale } from "../model/format.ts";
import { LANGUAGE_STORAGE_KEY, resolveLanguage } from "./language.ts";
import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * Resources are bundled, not fetched. This dashboard's premise is that
 * everything stays on the machine, and at roughly a hundred strings per locale
 * there is nothing to code-split — an HTTP backend would buy a loading flash and
 * an async init for no benefit.
 */
const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

function storedLanguage(): string | null {
  // Private-mode and embedded webviews can throw on access rather than return
  // null, and a language preference is not worth failing to boot over.
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

const initial = resolveLanguage(storedLanguage(), navigator.languages ?? [navigator.language]);

/**
 * Registered BEFORE `initReactI18next` and before any component mounts, and the
 * ordering is load-bearing rather than incidental.
 *
 * i18next fires `languageChanged` listeners in registration order, and
 * react-i18next's listener is what triggers the re-render. Registering this
 * one first guarantees the module-level locale inside `model/format.ts` is
 * already current when components re-render. Reversed, every formatted number,
 * date, and currency on the page would lag one language change behind — visible
 * only as stale output, with nothing failing.
 */
i18n.on("languageChanged", (language) => {
  setFormatLocale(language);
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  // The dashboard uses one namespace; splitting buys nothing at this volume.
  defaultNS: "translation",
  interpolation: {
    // React escapes on render already, and double-escaping mangles the "→" and
    // "·" that several labels contain.
    escapeValue: false,
  },
});

// `init` does not fire `languageChanged`, so the initial locale is applied here.
setFormatLocale(initial);
document.documentElement.lang = initial;

export function changeLanguage(language: SupportedLocale): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A browser that refuses storage still gets the language change for this
    // session; only persistence is lost.
  }
  void i18n.changeLanguage(language);
}

export default i18n;
```

- [ ] **Step 4: Type the translation keys**

Create `apps/web/src/i18n/i18next.d.ts`:

```ts
import type en from "./locales/en.json";

/**
 * Binds `t()` to the English resource file, which makes `bun run typecheck` fail
 * on a key that does not exist. That is the only automated check standing behind
 * the string-extraction work — the repo has no React test runner — so it is
 * doing real load-bearing work, not just improving autocomplete.
 *
 * It checks keys against `en` only. A key MISSING from `es.json` still falls
 * back to English silently at runtime; see the spec's non-goals.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}
```

- [ ] **Step 5: Import it before the app renders**

Replace `apps/web/src/main.tsx` with:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
// Imported for its side effect, and BEFORE App: i18next must be initialised and
// the document language set before the first render, or the first paint is in
// the wrong language.
import "./i18n/index.ts";
import { App } from "./app.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Verify the whole gate**

Run: `bun run check`
Expected: PASS. If `format:check` fails, run `bun run format` and re-run.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json apps/web/src/i18n apps/web/src/main.tsx bun.lock
git commit -m "Initialise i18next with bundled, type-checked locale resources"
```

---

### Task 8: App shell strings

**Files:**

- Modify: `apps/web/src/app.tsx:25-38`, `:132-236`
- Modify: `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/locales/es.json`

**Interfaces:**

- Consumes: `useTranslation` (typed via Task 7)
- Produces: keys `nav.*`, `filters.*`, `period.select.*`, `app.*`

- [ ] **Step 1: Add the keys to `en.json`**

Merge into the existing object:

```json
  "app": {
    "brand": "Usage Monitor",
    "sections": "Dashboard sections",
    "viewHeading": "Usage Monitor — {{view}}",
    "footer": "Everything stays on this machine · API-equivalent estimates are not billing claims"
  },
  "nav": {
    "overview": "Overview",
    "breakdown": "Breakdown",
    "history": "History"
  },
  "filters": {
    "period": "Period",
    "host": "Host",
    "allHosts": "All",
    "searchTasks": "Filter tasks",
    "refresh": "Refresh sources",
    "refreshing": "Refreshing…",
    "settings": "Settings"
  },
  "period": {
    "select": {
      "today": "Today",
      "last24": "Last 24 hours",
      "7": "Last 7 days",
      "30": "Last 30 days",
      "90": "Last 90 days",
      "all": "All retained"
    }
  }
```

- [ ] **Step 2: Add the same keys to `es.json`**

```json
  "app": {
    "brand": "Usage Monitor",
    "sections": "Secciones del panel",
    "viewHeading": "Usage Monitor — {{view}}",
    "footer": "Todo permanece en este equipo · Las estimaciones equivalentes de API no son cargos reales"
  },
  "nav": {
    "overview": "Resumen",
    "breakdown": "Desglose",
    "history": "Historial"
  },
  "filters": {
    "period": "Periodo",
    "host": "Host",
    "allHosts": "Todos",
    "searchTasks": "Filtrar tareas",
    "refresh": "Actualizar fuentes",
    "refreshing": "Actualizando…",
    "settings": "Ajustes"
  },
  "period": {
    "select": {
      "today": "Hoy",
      "last24": "Últimas 24 horas",
      "7": "Últimos 7 días",
      "30": "Últimos 30 días",
      "90": "Últimos 90 días",
      "all": "Todo el historial"
    }
  }
```

Note `app.brand` is the product name and is identical in both files on purpose.

- [ ] **Step 3: Convert the static label arrays to id lists**

In `apps/web/src/app.tsx`, replace lines 25-38 with:

```tsx
/** Ids only. The labels are looked up per render so they follow the language. */
const VIEWS: readonly View[] = ["overview", "breakdown", "history"];

const TIMEFRAMES = ["today", "last24", "7", "30", "90", "all"] as const;
```

- [ ] **Step 4: Translate the shell**

Add to the imports in `app.tsx`:

```tsx
import { useTranslation } from "react-i18next";
```

Inside `App()`, add as the first line of the body:

```tsx
const { t } = useTranslation();
```

Replace the `<nav>` block (lines 135-157) with:

```tsx
<nav aria-label={t("app.sections")}>
  {VIEWS.map((item) => {
    // Settings renders over the top of whichever view is selected, so while
    // it is open no nav item is current. Without this the nav would keep
    // highlighting Overview — visually and to assistive tech — while
    // Settings is on screen.
    const current = !settingsOpen && view === item;
    return (
      <button
        key={item}
        type="button"
        className={current ? "active" : ""}
        aria-current={current ? "true" : undefined}
        onClick={() => {
          setSettingsOpen(false);
          setView(item);
        }}
      >
        {t(`nav.${item}`)}
      </button>
    );
  })}
</nav>
```

Replace the `<div className="chips">` block (lines 158-196) with:

```tsx
<div className="chips">
  <SelectChip
    label={t("filters.period")}
    value={filters.timeframe}
    options={TIMEFRAMES.map((value) => ({ value, label: t(`period.select.${value}`) }))}
    onChange={(value) => change("timeframe", value)}
  />
  <SelectChip
    label={t("filters.host")}
    value={filters.sourceHostId ?? ""}
    options={[
      { value: "", label: t("filters.allHosts") },
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
    placeholder={t("filters.searchTasks")}
    onChange={(value) => change("query", value)}
  />
  <button type="button" className="primary" disabled={busy} onClick={refreshSources}>
    {busy ? t("filters.refreshing") : t("filters.refresh")}
  </button>
  <button
    type="button"
    className="gear"
    aria-label={t("filters.settings")}
    aria-expanded={settingsOpen ? "true" : "false"}
    onClick={() => setSettingsOpen(!settingsOpen)}
  >
    ⚙
  </button>
</div>
```

Replace the brand at line 134 with `<strong className="brand-name">{t("app.brand")}</strong>`.

Replace the `<h1>` (lines 211-213) with:

```tsx
<h1 className="sr-only">{t("app.viewHeading", { view: t(`nav.${view}`) })}</h1>
```

Replace the footer (lines 234-236) with:

```tsx
<footer>{t("app.footer")}</footer>
```

- [ ] **Step 5: Verify**

Run: `bun run check`
Expected: PASS. A typo in any key fails `typecheck` — that is the check doing its job.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app.tsx apps/web/src/i18n/locales
git commit -m "Translate the dashboard shell, navigation, and filter chips"
```

---

### Task 9: Headline

Includes the temporary literals left by Task 4, and moves the currency unit onto the measure toggle.

**Files:**

- Modify: `apps/web/src/components/headline.tsx:23-36`, `:47-73`, `:79-80`, `:117`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `coverageMessage` (Task 4), `formatNumberCompact` (Task 2), `useTranslation`
- Produces: keys `headline.*`, `period.inline.*`

- [ ] **Step 1: Add the keys**

To `en.json`, merging into the existing `headline` object (which already holds `coverage`):

```json
  "headline": {
    "coverage": {
      "none": "No records in this period",
      "all": "{{records}} records priced",
      "partial": "{{priced}} of {{records}} records priced"
    },
    "title": "API-equivalent cost of work · {{period}}",
    "disclaimer": "{{coverage}} · estimated at your configured API rates, not a bill",
    "measureGroup": "Trend measure",
    "cost": "Cost (USD)",
    "tokens": "Tokens",
    "seriesCost": "Estimated cost",
    "empty": "No activity in this period"
  },
  "period": {
    "select": {
      "today": "Today",
      "last24": "Last 24 hours",
      "7": "Last 7 days",
      "30": "Last 30 days",
      "90": "Last 90 days",
      "all": "All retained"
    },
    "inline": {
      "today": "today",
      "last24": "last 24 hours",
      "7": "last 7 days",
      "30": "last 30 days",
      "90": "last 90 days",
      "all": "all retained history",
      "custom": "the selected range"
    }
  }
```

The `period.select` block is unchanged from Task 8 — it is repeated in full here only so the surrounding structure is unambiguous. Do not duplicate it in the file.

To `es.json`:

```json
  "headline": {
    "coverage": {
      "none": "No hay registros en este periodo",
      "all": "{{records}} registros con tarifa",
      "partial": "{{priced}} de {{records}} registros con tarifa"
    },
    "title": "Coste equivalente de API del trabajo · {{period}}",
    "disclaimer": "{{coverage}} · estimado según tus tarifas de API configuradas, no es una factura",
    "measureGroup": "Medida de la tendencia",
    "cost": "Coste (USD)",
    "tokens": "Tokens",
    "seriesCost": "Coste estimado",
    "empty": "No hay actividad en este periodo"
  },
  "period": {
    "inline": {
      "today": "hoy",
      "last24": "últimas 24 horas",
      "7": "últimos 7 días",
      "30": "últimos 30 días",
      "90": "últimos 90 días",
      "all": "todo el historial conservado",
      "custom": "el rango seleccionado"
    }
  }
```

- [ ] **Step 2: Rewrite the component head**

In `apps/web/src/components/headline.tsx`, delete `TIMEFRAME_LABEL` (lines 23-31) and `MEASURES` (lines 33-36), replacing them with:

```tsx
const MEASURES = ["cost", "tokens"] as const;

/**
 * The inline period labels are a SEPARATE key set from the Period dropdown's,
 * not a case transformation of it. English wants "Last 7 days" in a chip and
 * "last 7 days" mid-sentence; Spanish title-cases neither, and other languages
 * differ again. Sentence-position casing is a per-locale decision, so both forms
 * are authored per locale rather than derived.
 */
const INLINE_PERIODS = ["today", "last24", "7", "30", "90", "all"] as const;

type InlinePeriod = (typeof INLINE_PERIODS)[number];

/**
 * Narrows the server-supplied timeframe to a key that exists, rather than
 * casting. `filters.timeframe` is a plain string, so an unrecognised value
 * would otherwise interpolate into a missing key and render the key itself.
 * The `custom` fallback is the same one the old TIMEFRAME_LABEL lookup used.
 */
function inlinePeriodKey(timeframe: string): `period.inline.${InlinePeriod | "custom"}` {
  const match = INLINE_PERIODS.find((period) => period === timeframe);
  return match ? `period.inline.${match}` : "period.inline.custom";
}
```

- [ ] **Step 3: Translate the body**

Add `import { useTranslation } from "react-i18next";` to the imports, and add `formatCount` to the `format.ts` import list.

Replace lines 38-46 (the function head through `exactFormat`) with:

```tsx
export function Headline({ data }: { data: OverviewView }) {
  const { t } = useTranslation();
  const [measure, setMeasure] = useState<Measure>("cost");
  const period = t(inlinePeriodKey(data.filters.timeframe));
  const key = measure === "cost" ? "estimatedCost" : "totalTokens";
  // The axis and the tooltip format the same number differently on purpose: the
  // axis gutter is 48px and clips anything longer than about seven characters,
  // while the tooltip has room for the exact figure including its currency.
  const axisFormat = measure === "cost" ? formatNumberCompact : formatTokens;
  const exactFormat = measure === "cost" ? formatMoney : formatTokens;
  const coverage = coverageMessage({
    records: data.totals.records,
    priced: data.totals.pricedRecords,
  });
```

Replace lines 49-73 (`headline-head`) with:

```tsx
<div className="headline-head">
  <div>
    <p className="panel-label">{t("headline.title", { period })}</p>
    <p className="hero">{formatMoney(data.totals.estimatedCost)}</p>
    <p className="panel-label">
      {t("headline.disclaimer", {
        // Both numbers are formatted here, not by i18next: one formatting
        // path, and "4,900" beside the hero's "USD 8,947.32" rather than a
        // bare "4900".
        coverage: t(coverage.key, {
          records: formatCount(coverage.params.records),
          priced: formatCount(coverage.params.priced),
        }),
      })}
    </p>
  </div>
  <div className="segmented" role="group" aria-label={t("headline.measureGroup")}>
    {MEASURES.map((item) => (
      <button
        type="button"
        key={item}
        className={measure === item ? "on" : ""}
        aria-pressed={measure === item}
        onClick={() => setMeasure(item)}
      >
        {t(`headline.${item}`)}
      </button>
    ))}
  </div>
</div>
```

Replace line 80 with `<p className="empty-state">{t("headline.empty")}</p>` and line 117 with:

```tsx
              name={measure === "cost" ? t("headline.seriesCost") : t("headline.tokens")}
```

- [ ] **Step 4: Verify**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/headline.tsx apps/web/src/i18n/locales
git commit -m "Translate the headline panel and move the currency onto the measure toggle"
```

---

### Task 10: Overview rail and shared components

Covers `overview.tsx`, `stat-strip.tsx`, `token-mix.tsx`, `quota-meters.tsx`, and `rank-list.tsx`. Also removes the user-facing labels from `theme/palette.ts`, which is a colour module and should not hold copy.

**Files:**

- Modify: `apps/web/src/views/overview.tsx`
- Modify: `apps/web/src/components/stat-strip.tsx`, `token-mix.tsx`, `quota-meters.tsx`, `rank-list.tsx`
- Modify: `apps/web/src/theme/palette.ts:42-47`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `harnessLabel(id, unknownLabel)` (Task 5), `formatPercent` (Task 2), `useTranslation`
- Produces:
  - keys `overview.*`, `tokenMix.*`, `quota.*`, `rank.*`
  - `TOKEN_MIX` in `palette.ts` becomes `Record<TokenMixKeyBase, string>` — colours only, no `label`

- [ ] **Step 1: Add the keys**

`en.json`:

```json
  "overview": {
    "drivers": "What drove it",
    "context": "Context",
    "byHarness": "By harness",
    "byModel": "By model",
    "byTask": "By task",
    "tokenMix": "Token mix",
    "planLimits": "Plan limits",
    "hosts": "Hosts",
    "tokens": "Tokens",
    "cachedInput": "Cached input",
    "cacheCoverage": "of {{tokens}} reporting tokens",
    "tasks": "Tasks",
    "models": "Models"
  },
  "tokenMix": {
    "composition": "Token composition",
    "empty": "No tokens in this period",
    "fresh": "Fresh input",
    "cached": "Cached",
    "output": "Output",
    "unreported": "Cache not reported"
  },
  "quota": {
    "used": "{{percent}} used",
    "resets": "resets {{at}}"
  },
  "rank": {
    "empty": "No usage in this period",
    "more": "{{remaining}} more",
    "moreLink": "{{remaining}} more →"
  }
```

`es.json`:

```json
  "overview": {
    "drivers": "Qué lo generó",
    "context": "Contexto",
    "byHarness": "Por entorno",
    "byModel": "Por modelo",
    "byTask": "Por tarea",
    "tokenMix": "Mezcla de tokens",
    "planLimits": "Límites del plan",
    "hosts": "Hosts",
    "tokens": "Tokens",
    "cachedInput": "Entrada en caché",
    "cacheCoverage": "de {{tokens}} tokens que informan",
    "tasks": "Tareas",
    "models": "Modelos"
  },
  "tokenMix": {
    "composition": "Composición de tokens",
    "empty": "No hay tokens en este periodo",
    "fresh": "Entrada nueva",
    "cached": "En caché",
    "output": "Salida",
    "unreported": "Caché no informada"
  },
  "quota": {
    "used": "{{percent}} usado",
    "resets": "se restablece {{at}}"
  },
  "rank": {
    "empty": "No hay uso en este periodo",
    "more": "{{remaining}} más",
    "moreLink": "{{remaining}} más →"
  }
```

- [ ] **Step 2: Strip labels out of the palette**

In `apps/web/src/theme/palette.ts`, replace lines 42-47 with:

```ts
/**
 * Token-mix segment colours, keyed for lookup without assertions. Colours only —
 * the segment names are copy and live in the translation files, because a theme
 * module that also holds English prose cannot be reused in another language.
 */
export const TOKEN_MIX = {
  fresh: SERIES.blue,
  cached: SERIES.teal,
  output: SERIES.orange,
} as const;
```

`apps/web/test/palette.test.ts` does not assert on `TOKEN_MIX`, so it needs no change. `model/token-mix.ts` uses only `TOKEN_MIX_ORDER`, which is untouched.

- [ ] **Step 3: Translate `token-mix.tsx`**

Replace lines 1-20 of `apps/web/src/components/token-mix.tsx` with:

```tsx
import { useTranslation } from "react-i18next";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { CHART_INK, TOKEN_MIX } from "../theme/palette.ts";
import { formatTokens } from "../model/format.ts";
import { tokenMixSegments, type TokenMixKey } from "../model/token-mix.ts";

/**
 * `unreported` deliberately borrows the track colour rather than taking a fourth
 * series slot. It is an absence, not a category: giving it a data hue would put
 * it in the same visual language as measured values, and the palette's three
 * series colours are validated as a categorical set that a fourth would change.
 */
const SEGMENT_COLOR: Record<TokenMixKey, string> = {
  ...TOKEN_MIX,
  unreported: CHART_INK.track,
};

export function TokenMix({ totals }: { totals: UsageTotals }) {
  const { t } = useTranslation();
  const segments = tokenMixSegments(totals);
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (!total) return <p className="empty-state">{t("tokenMix.empty")}</p>;
```

Replace the render block (lines 31-55) with:

```tsx
return (
  <>
    <div className="stack" role="img" aria-label={t("tokenMix.composition")}>
      {drawn.map((segment) => (
        <span
          key={segment.key}
          style={{
            width: `${(segment.tokens / total) * 100}%`,
            background: SEGMENT_COLOR[segment.key],
          }}
        />
      ))}
    </div>
    <ul className="legend">
      {listed.map((segment) => (
        <li key={segment.key}>
          <i className="dot" style={{ background: SEGMENT_COLOR[segment.key] }} />
          <span>{t(`tokenMix.${segment.key}`)}</span>
          <span className="legend-count">{formatTokens(segment.tokens)}</span>
          <span className="legend-share">{formatWholePercent(segment.percent)}</span>
        </li>
      ))}
    </ul>
  </>
);
```

Add `formatWholePercent` to the `format.ts` import. `segment.percent` is already a whole percentage, which is exactly what `formatWholePercent` takes — do not pre-divide it.

- [ ] **Step 4: Translate `stat-strip.tsx`**

Replace lines 1-19 with:

```tsx
import { useTranslation } from "react-i18next";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { formatCount, formatPercent, formatTokens } from "../model/format.ts";
import { cacheStat } from "../model/stat-strip.ts";

export function StatStrip({ totals }: { totals: UsageTotals }) {
  const { t } = useTranslation();
  const cache = cacheStat(totals);
  const stats = [
    { key: "tokens", label: t("overview.tokens"), value: formatTokens(totals.totalTokens), note: "" },
    {
      key: "cached",
      label: t("overview.cachedInput"),
      value: cache.ratio === null ? t("common.notReported") : formatPercent(cache.ratio),
      // Coverage is stated in tokens because the ratio is token-weighted — see
      // `cacheStat`. Shown only when coverage is partial: with nothing to
      // qualify, the line is noise.
      note:
        cache.partialOf === null
          ? ""
          : t("overview.cacheCoverage", { tokens: formatTokens(cache.partialOf) }),
    },
    { key: "tasks", label: t("overview.tasks"), value: formatCount(totals.tasks), note: "" },
    { key: "models", label: t("overview.models"), value: formatCount(totals.models), note: "" },
  ];
```

Change the map key at line 23 from `key={stat.label}` to `key={stat.key}` — a translated label is not a stable React key.

- [ ] **Step 5: Translate `quota-meters.tsx`**

Add `import { useTranslation } from "react-i18next";`. Add `const { t } = useTranslation();` as the first line of the component body, and replace line 20:

```tsx
if (!snapshots.length) return <p className="empty-state">{t("common.notReported")}</p>;
```

Replace lines 36-38:

```tsx
<span className={`quota-value ${status}`}>
  {shown === null
    ? t("common.notReported")
    : `${QUOTA_GLYPH[status]} ${formatWholePercent(shown)}`.trim()}
</span>
```

Replace line 52 and line 58:

```tsx
                    aria-valuetext={t("quota.used", { percent: formatWholePercent(shown) })}
```

```tsx
{
  resets && <p className="quota-reset">{t("quota.resets", { at: resets })}</p>;
}
```

Add `formatWholePercent` to the `format.ts` import. `quotaMeterView` already rounds `shown` to a whole percent, so it is passed through unchanged. `window.label` is source-owned data from the server and is deliberately NOT translated.

- [ ] **Step 6: Translate `rank-list.tsx`**

Replace lines 1-19 with:

```tsx
import { useTranslation } from "react-i18next";
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatMoney } from "../model/format.ts";
import { rankBarWidth, rankView } from "../model/rank-scale.ts";

export function RankList({
  rows,
  limit = 4,
  onMore,
  emptyLabel,
}: {
  rows: RankedUsage[];
  limit?: number;
  onMore?: () => void;
  /** Defaults to the generic empty wording; callers override for a narrower one. */
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  // Keyed off the data, not off what survived the cap: a list that has rows but
  // shows none of them is truncated, not empty, and saying "No usage in this
  // period" over real usage is the worst thing this component could do.
  if (!rows.length) return <p className="empty-state">{emptyLabel ?? t("rank.empty")}</p>;
```

Replace lines 44-51 with:

```tsx
{
  remaining > 0 &&
    (onMore ? (
      <button type="button" className="link" onClick={onMore}>
        {t("rank.moreLink", { remaining: formatCount(remaining) })}
      </button>
    ) : (
      <p className="link link-static">{t("rank.more", { remaining: formatCount(remaining) })}</p>
    ));
}
```

Add `formatCount` to the `format.ts` import in `rank-list.tsx`.

- [ ] **Step 7: Translate `overview.tsx`**

Add `import { useTranslation } from "react-i18next";`, add `const { t } = useTranslation();` as the first line of the body, and replace line 20 and the panel labels:

```tsx
const { t } = useTranslation();
// Relabelled here rather than inside RankList: the list ranks rows by cost and
// knows nothing about harnesses, and a `byHarness` row's key IS its harness id.
const harnessRows = data.byHarness.map((row) => ({
  ...row,
  key: harnessLabel(row.key, t("common.unknownHarness")),
}));
```

Replace `<Zone>What drove it</Zone>` with `<Zone>{t("overview.drivers")}</Zone>`, `<Zone>Context</Zone>` with `<Zone>{t("overview.context")}</Zone>`, and each `<Panel label="...">` with the matching key: `t("overview.byHarness")`, `t("overview.byModel")`, `t("overview.byTask")`, `t("overview.tokenMix")`, `t("overview.planLimits")`, `t("overview.hosts")`.

- [ ] **Step 8: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add apps/web/src/views/overview.tsx apps/web/src/components apps/web/src/theme/palette.ts apps/web/src/i18n/locales
git commit -m "Translate the overview panels and move segment names out of the palette"
```

---

### Task 11: Breakdown and rollup

**Files:**

- Modify: `apps/web/src/views/breakdown.tsx:19-25`, `:42`, `:44-88`, `:98-107`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `harnessLabel(id, unknownLabel)` (Task 5), `useTranslation`
- Produces: keys `breakdown.*`, `table.*`

`rollup.tsx` contains no user-facing strings and needs no change — verify this before assuming it does.

- [ ] **Step 1: Add the keys**

`en.json`:

```json
  "breakdown": {
    "groupBy": "Group by",
    "byHarness": "Harness",
    "byModel": "Model → Reasoning",
    "byTask": "Task → Session",
    "bySourceHost": "Host",
    "byHostGroup": "Host Group",
    "treeView": "⊟ Tree view",
    "tableView": "⊞ Table view",
    "empty": "No usage matches the current filters."
  },
  "table": {
    "group": "Group",
    "records": "Records",
    "tokens": "Tokens",
    "cost": "Cost"
  }
```

`es.json`:

```json
  "breakdown": {
    "groupBy": "Agrupar por",
    "byHarness": "Entorno",
    "byModel": "Modelo → Razonamiento",
    "byTask": "Tarea → Sesión",
    "bySourceHost": "Host",
    "byHostGroup": "Grupo de hosts",
    "treeView": "⊟ Vista de árbol",
    "tableView": "⊞ Vista de tabla",
    "empty": "Ningún uso coincide con los filtros actuales."
  },
  "table": {
    "group": "Grupo",
    "records": "Registros",
    "tokens": "Tokens",
    "cost": "Coste"
  }
```

- [ ] **Step 2: Convert `DIMENSIONS` to an id list**

Replace lines 19-25 of `apps/web/src/views/breakdown.tsx` with:

```tsx
/** Ids only; labels are looked up per render so they follow the language. */
const DIMENSIONS: readonly BreakdownDimension[] = [
  "byHarness",
  "byModel",
  "byTask",
  "bySourceHost",
  "byHostGroup",
];
```

- [ ] **Step 3: Translate the component**

Add `import { useTranslation } from "react-i18next";`. Add `const { t } = useTranslation();` as the first line of the `Breakdown` body, and update line 42:

```tsx
      ? data.byHarness.map((row) => ({
          ...row,
          key: harnessLabel(row.key, t("common.unknownHarness")),
        }))
```

Replace the `group-by` block (lines 46-73) with:

```tsx
<div className="group-by">
  <span className="panel-label">{t("breakdown.groupBy")}</span>
  {DIMENSIONS.map((item) => (
    <button
      type="button"
      key={item}
      className={`chip ${dimension === item ? "on" : ""}`}
      aria-pressed={dimension === item}
      onClick={() => onDimensionChange(item)}
    >
      {t(`breakdown.${item}`)}
    </button>
  ))}
  {/*
          Labelled with the view it switches TO, not the one being shown. The
          static "Table view" label read as a state, so once pressed it claimed to
          be the tree while showing the table — and the table's rows do not
          collapse, which made the tree itself look broken.
        */}
  <button
    type="button"
    className="chip table-toggle"
    aria-pressed={asTable}
    onClick={() => setAsTable(!asTable)}
  >
    {asTable ? t("breakdown.treeView") : t("breakdown.tableView")}
  </button>
</div>
```

Replace line 76 with `<p className="empty-state">{t("breakdown.empty")}</p>`.

- [ ] **Step 4: Translate the table headers**

`BreakdownTable` is a separate component, so it needs its own hook. Add `const { t } = useTranslation();` as the first line of its body and replace lines 101-106 with:

```tsx
<tr>
  <th>{t("table.group")}</th>
  <th className="n">{t("table.records")}</th>
  <th className="n">{t("table.tokens")}</th>
  <th className="n">{t("table.cost")}</th>
</tr>
```

- [ ] **Step 5: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add apps/web/src/views/breakdown.tsx apps/web/src/i18n/locales
git commit -m "Translate the breakdown view and its table headers"
```

---

### Task 12: History

**Files:**

- Modify: `apps/web/src/views/history.tsx:28-34`, `:43-55`, `:63-107`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `harnessLabel(id, unknownLabel)` (Task 5), `useTranslation`
- Produces: keys `history.*`

- [ ] **Step 1: Add the keys**

`en.json`:

```json
  "history": {
    "empty": "No usage history matches the filters.",
    "summary": "{{tasks}} tasks · {{sessions}} sessions · {{records}} records",
    "groupSessions": "{{sessions}} sessions · {{tokens}}",
    "lastActive": "Last active",
    "harness": "Harness",
    "model": "Model",
    "reasoning": "Reasoning",
    "host": "Host"
  }
```

`es.json`:

```json
  "history": {
    "empty": "Ningún historial de uso coincide con los filtros.",
    "summary": "{{tasks}} tareas · {{sessions}} sesiones · {{records}} registros",
    "groupSessions": "{{sessions}} sesiones · {{tokens}}",
    "lastActive": "Última actividad",
    "harness": "Entorno",
    "model": "Modelo",
    "reasoning": "Razonamiento",
    "host": "Host"
  }
```

The record/token/cost column headers reuse `table.*` from Task 11.

- [ ] **Step 2: Translate `History`**

Add `import { useTranslation } from "react-i18next";` and `const { t } = useTranslation();` as the first line of the body.

Replace line 28:

```tsx
if (!groups.length) return <p className="empty-state">{t("history.empty")}</p>;
```

Replace the `<Zone>` block (lines 31-34):

```tsx
<Zone>
  {t("history.summary", {
    tasks: formatCount(groups.length),
    sessions: formatCount(sessions),
    records: formatCount(records.length),
  })}
</Zone>
```

Replace lines 47-53:

```tsx
              <span className="rollup-tokens">
                {t("history.groupSessions", {
                  sessions: formatCount(group.sessions.length),
                  tokens: formatTokens(group.totalTokens),
                })}
              </span>
              <span className="rollup-tokens">{formatDateTime(group.lastActiveAt)}</span>
              <span className="rank-value">
                {group.estimatedCost === null ? t("common.unpriced") : formatMoney(group.estimatedCost)}
              </span>
```

- [ ] **Step 3: Translate `SessionTable`**

Add `const { t } = useTranslation();` as the first line of its body. Replace the header row (lines 67-76):

```tsx
<tr>
  <th>{t("history.lastActive")}</th>
  <th>{t("history.harness")}</th>
  <th>{t("history.model")}</th>
  <th>{t("history.reasoning")}</th>
  <th>{t("history.host")}</th>
  <th className="n">{t("table.records")}</th>
  <th className="n">{t("table.tokens")}</th>
  <th className="n">{t("table.cost")}</th>
</tr>
```

Replace line 95 with `{harnessLabel(harness, t("common.unknownHarness"))}` and line 105 with:

```tsx
{
  session.estimatedCost === null ? t("common.unpriced") : formatMoney(session.estimatedCost);
}
```

- [ ] **Step 4: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add apps/web/src/views/history.tsx apps/web/src/i18n/locales
git commit -m "Translate the history view and its session table"
```

---

### Task 13: Settings shell and Model rates

**Files:**

- Modify: `apps/web/src/views/settings/index.tsx:11-51`
- Modify: `apps/web/src/views/settings/rates.tsx:41-111`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `useTranslation`
- Produces: keys `settings.tabs.*`, `settings.rates.*`; `SettingsTab` gains `"language"` (its view arrives in Task 15)

- [ ] **Step 1: Add the keys**

Merge into the existing `settings` object in `en.json` (which already holds `language` from Task 7):

```json
  "settings": {
    "sections": "Settings sections",
    "tabs": {
      "rates": "Model rates",
      "host-groups": "Host groups",
      "language": "Language"
    },
    "rates": {
      "heading": "Model rates",
      "subtitle": "USD per one million tokens · {{models}} configured models",
      "caption": "Configured model prices in USD per one million tokens",
      "saving": "Saving…",
      "save": "Save changes",
      "saved": "Prices saved",
      "provider": "Provider",
      "model": "Model",
      "input": "Input",
      "cachedInput": "Cache read",
      "cacheWrite": "Cache write",
      "output": "Output",
      "effective": "Effective",
      "loading": "Loading the local price catalog…"
    },
    "language": {
      "tab": "Language",
      "heading": "Language",
      "hint": "Applies to this browser only. Numbers, dates, and currency follow the language you choose."
    }
  }
```

`es.json`:

```json
  "settings": {
    "sections": "Secciones de ajustes",
    "tabs": {
      "rates": "Tarifas de modelo",
      "host-groups": "Grupos de hosts",
      "language": "Idioma"
    },
    "rates": {
      "heading": "Tarifas de modelo",
      "subtitle": "USD por millón de tokens · {{models}} modelos configurados",
      "caption": "Precios de modelo configurados en USD por millón de tokens",
      "saving": "Guardando…",
      "save": "Guardar cambios",
      "saved": "Precios guardados",
      "provider": "Proveedor",
      "model": "Modelo",
      "input": "Entrada",
      "cachedInput": "Lectura de caché",
      "cacheWrite": "Escritura de caché",
      "output": "Salida",
      "effective": "Vigente desde",
      "loading": "Cargando el catálogo de precios local…"
    },
    "language": {
      "tab": "Idioma",
      "heading": "Idioma",
      "hint": "Se aplica solo a este navegador. Los números, las fechas y la moneda siguen el idioma que elijas."
    }
  }
```

- [ ] **Step 2: Translate the settings shell**

Replace lines 11-16 of `apps/web/src/views/settings/index.tsx` with:

```tsx
type SettingsTab = "rates" | "host-groups" | "language";

/** Ids only; labels follow the language. */
const TABS: readonly SettingsTab[] = ["rates", "host-groups", "language"];
```

Add `import { useTranslation } from "react-i18next";` and `const { t } = useTranslation();` as the first line of the body. Replace lines 39-51:

```tsx
{
  /* Same chip/aria-pressed idiom as Breakdown's Group-by row. */
}
<div className="group-by" role="group" aria-label={t("settings.sections")}>
  {TABS.map((item) => (
    <button
      type="button"
      key={item}
      className={`chip ${tab === item ? "on" : ""}`}
      aria-pressed={tab === item}
      onClick={() => setTab(item)}
    >
      {t(`settings.tabs.${item}`)}
    </button>
  ))}
</div>;
```

Replace the render branch (lines 52-61) with an explicit three-way, since the `language` tab now exists as an id. Task 15 fills in `<LanguageSettings />`; for now it renders nothing:

```tsx
{
  tab === "rates" && <Pricing prices={prices} onSaved={onSaved} />;
}
{
  tab === "host-groups" && (
    <HostGroups
      hostGroups={hostGroups}
      memberships={memberships}
      sourceHosts={sourceHosts}
      onSaved={onSaved}
    />
  );
}
{
  /* Filled in by the language-selector task. */
}
{
  tab === "language" && null;
}
```

- [ ] **Step 3: Translate the rates view**

Add `import { useTranslation } from "react-i18next";`, `import { formatCount } from "../../model/format.ts";`, and `const { t } = useTranslation();` as the first line of `Pricing`'s body.

Replace lines 44-50:

```tsx
        <div>
          <h2 id="pricing-table-title">{t("settings.rates.heading")}</h2>
          <p>{t("settings.rates.subtitle", { models: formatCount(draft.length) })}</p>
        </div>
        <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
          {saving
            ? t("settings.rates.saving")
            : dirty
              ? t("settings.rates.save")
              : t("settings.rates.saved")}
        </button>
```

Replace lines 60-72:

```tsx
            <caption className="sr-only">{t("settings.rates.caption")}</caption>
            <thead>
              <tr>
                <th>{t("settings.rates.provider")}</th>
                <th>{t("settings.rates.model")}</th>
                <th>{t("settings.rates.input")}</th>
                <th>{t("settings.rates.cachedInput")}</th>
                <th>{t("settings.rates.cacheWrite")}</th>
                <th>{t("settings.rates.output")}</th>
                <th>{t("settings.rates.effective")}</th>
              </tr>
            </thead>
```

Replace the input `aria-label` at line 82 — it currently interpolates a raw field key, which is untranslated developer vocabulary read aloud by screen readers:

```tsx
                        aria-label={`${price.model} ${t(`settings.rates.${key}`)}`}
```

Replace line 110 with `<p className="empty-state">{t("settings.rates.loading")}</p>`.

- [ ] **Step 4: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add apps/web/src/views/settings/index.tsx apps/web/src/views/settings/rates.tsx apps/web/src/i18n/locales
git commit -m "Translate the settings shell and the model rates table"
```

---

### Task 14: Host groups

**Files:**

- Modify: `apps/web/src/views/settings/host-groups.tsx:14-21`, `:124-133`, `:140-224`
- Modify: `apps/web/src/i18n/locales/en.json`, `es.json`

**Interfaces:**

- Consumes: `useTranslation`
- Produces: keys `settings.hostGroups.*`

- [ ] **Step 1: Add the keys**

Into `settings` in `en.json`:

```json
    "hostGroups": {
      "heading": "Host groups",
      "effectiveHint": "Grouping applies to usage recorded from now on. Earlier usage keeps the grouping that applied when it happened.",
      "newGroup": "New group",
      "empty": "No host groups yet. Use New group to add one.",
      "groupName": "Group name",
      "saving": "Saving…",
      "save": "Save",
      "retire": "Retire",
      "thisGroup": "this group",
      "hostsIn": "Hosts in {{group}}",
      "currentlyIn": "currently in {{group}}",
      "ungrouped": "Ungrouped: {{hosts}}",
      "none": "none",
      "confirmRetire": "Retire \"{{group}}\"? Usage recorded from now on will be ungrouped. Past usage keeps this group, so no existing totals change."
    }
```

Into `settings` in `es.json`:

```json
    "hostGroups": {
      "heading": "Grupos de hosts",
      "effectiveHint": "La agrupación se aplica al uso registrado a partir de ahora. El uso anterior conserva la agrupación vigente en su momento.",
      "newGroup": "Nuevo grupo",
      "empty": "Todavía no hay grupos de hosts. Usa Nuevo grupo para añadir uno.",
      "groupName": "Nombre del grupo",
      "saving": "Guardando…",
      "save": "Guardar",
      "retire": "Retirar",
      "thisGroup": "este grupo",
      "hostsIn": "Hosts en {{group}}",
      "currentlyIn": "actualmente en {{group}}",
      "ungrouped": "Sin agrupar: {{hosts}}",
      "none": "ninguno",
      "confirmRetire": "¿Retirar \"{{group}}\"? El uso registrado a partir de ahora quedará sin agrupar. El uso pasado conserva este grupo, así que ningún total existente cambia."
    }
```

- [ ] **Step 2: Delete the module-level hint constant**

Remove `EFFECTIVE_HINT` and its doc comment (lines 14-21). Move the rationale to the translation key's usage site — add above the `<p>` that renders it:

```tsx
{
  /*
            Membership is written "as of now" and never backdated, so a newly
            created group explains nothing about existing history — every past
            record keeps resolving to Ungrouped. That is correct, and it looks
            exactly like a save that did nothing, so the hint is not decoration.
          */
}
<p>{t("settings.hostGroups.effectiveHint")}</p>;
```

- [ ] **Step 3: Translate the component**

Add `import { useTranslation } from "react-i18next";` and `const { t } = useTranslation();` as the first line of the body.

Replace the confirm in `retire` (lines 125-131):

```tsx
const label = savedName(row.id) ?? row.name;
if (!window.confirm(t("settings.hostGroups.confirmRetire", { group: label }))) return;
```

Replace line 144 with `<h2 id="host-groups-title">{t("settings.hostGroups.heading")}</h2>`, line 148 with `{t("settings.hostGroups.newGroup")}`, and line 157 with:

```tsx
<p className="empty-state">{t("settings.hostGroups.empty")}</p>
```

Replace line 164 with `{t("settings.hostGroups.groupName")}`, line 178 with:

```tsx
{
  savingId === row.id ? t("settings.hostGroups.saving") : t("settings.hostGroups.save");
}
```

and line 188 with `{t("settings.hostGroups.retire")}`.

Replace line 194:

```tsx
<legend>
  {t("settings.hostGroups.hostsIn", {
    group: savedName(row.id) ?? t("settings.hostGroups.thisGroup"),
  })}
</legend>
```

Replace lines 209-211:

```tsx
<span className="host-group-moving">
  {t("settings.hostGroups.currentlyIn", {
    group: savedName(elsewhere) ?? elsewhere,
  })}
</span>
```

Replace lines 221-223:

```tsx
<p className="host-group-ungrouped">
  {t("settings.hostGroups.ungrouped", {
    hosts:
      ungrouped.length === 0 ? t("settings.hostGroups.none") : ungrouped.map(labelFor).join(", "),
  })}
</p>
```

- [ ] **Step 4: Verify and commit**

Run: `bun run check`
Expected: PASS.

```bash
git add apps/web/src/views/settings/host-groups.tsx apps/web/src/i18n/locales
git commit -m "Translate the host groups settings section"
```

---

### Task 15: Language selector

**Files:**

- Create: `apps/web/src/views/settings/language.tsx`
- Modify: `apps/web/src/views/settings/index.tsx` (fill in the `language` branch left by Task 13)

**Interfaces:**

- Consumes: `SUPPORTED_LANGUAGES` (Task 6), `changeLanguage` (Task 7), keys `settings.language.*` (Task 7)
- Produces: `export function LanguageSettings(): JSX.Element`

- [ ] **Step 1: Create the view**

Create `apps/web/src/views/settings/language.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "../../model/format.ts";
import { changeLanguage } from "../../i18n/index.ts";
import { SUPPORTED_LANGUAGES } from "../../i18n/language.ts";

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  return (
    <section className="settings-section" aria-labelledby="language-title">
      <div className="settings-section-head">
        <div>
          <h2 id="language-title">{t("settings.language.heading")}</h2>
          <p>{t("settings.language.hint")}</p>
        </div>
      </div>
      <label className="chip">
        <span className="chip-key">{t("settings.language.heading")}</span>
        <select
          value={i18n.resolvedLanguage ?? "en"}
          onChange={(event) => changeLanguage(event.target.value as SupportedLocale)}
        >
          {/*
            Each option is labelled in its OWN language, never translated into
            the current one. Someone who has landed in a language they cannot
            read needs to recognise their own entry to get back out.
          */}
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {language.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
```

- [ ] **Step 2: Mount it**

In `apps/web/src/views/settings/index.tsx`, add `import { LanguageSettings } from "./language.tsx";` and replace the placeholder branch:

```tsx
{
  tab === "language" && <LanguageSettings />;
}
```

- [ ] **Step 3: Verify the gate**

Run: `bun run check`
Expected: PASS.

- [ ] **Step 4: Verify the behaviour by hand**

Run: `bun run dev`

Open the dashboard, then confirm each of:

1. Settings → Language → select `Español`. Every visible label switches to Spanish without a reload.
2. The hero figure reads `1.234,56 USD` in Spanish and `USD 1,234.56` in English.
3. Reload the page. Spanish persists.
4. In devtools, run `document.documentElement.lang` — it returns `es`.
5. Clear `localStorage`, set the browser's preferred language to Spanish, reload — the dashboard opens in Spanish.
6. Switch back to English and confirm every label returns.

Step 2 is the check that the `languageChanged` listener ordering from Task 7 is correct. If numbers stay in the old locale until a second interaction, the listener is registered too late.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/settings/language.tsx apps/web/src/views/settings/index.tsx
git commit -m "Add a language selector to Settings"
```

---

### Task 16: Sweep for missed strings and verify the Spanish layout

The typed-key check proves every key used exists; it cannot prove every visible string became a key. This task closes that gap by inspection.

**Files:**

- Modify: whatever the sweep turns up
- Modify: `apps/web/src/i18n/locales/es.json` (any gaps)

**Interfaces:**

- Consumes: everything above
- Produces: no new exports

- [ ] **Step 1: Sweep for untranslated literals**

Run:

```bash
grep -rnE '(>[A-Z][a-z]+[^<{}]*<|(aria-label|placeholder|title|label|alt)="[A-Z][^"]+")' apps/web/src --include='*.tsx'
```

Every hit must be one of: a `t()` call, a product name, a CSS class, or source-owned server data (for example `window.label` in `quota-meters.tsx`). Convert anything else and add the key to both locale files.

- [ ] **Step 2: Confirm the model layer stayed clean**

Run:

```bash
grep -rn "react-i18next\|from \"i18next\"\|useTranslation" apps/web/src/model apps/web/src/theme
```

Expected: no output. Any hit is a violation of the global constraint and must be refactored to take the string as a parameter or return a key.

- [ ] **Step 3: Confirm the two locale files have the same shape**

Run:

```bash
node -e "
const fs = require('node:fs');
const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const en = load('apps/web/src/i18n/locales/en.json');
const es = load('apps/web/src/i18n/locales/es.json');
const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) =>
  v && typeof v === 'object' ? keys(v, p + k + '.') : [p + k]);
const a = new Set(keys(en)), b = new Set(keys(es));
const missing = [...a].filter(k => !b.has(k));
const extra = [...b].filter(k => !a.has(k));
console.log('missing from es:', missing.length ? missing : 'none');
console.log('not in en:', extra.length ? extra : 'none');
process.exitCode = missing.length || extra.length ? 1 : 0;
"
```

Fix anything reported. This is a one-off check, not a committed test — the spec records the absence of a standing parity test as a known gap.

- [ ] **Step 4: Visual pass in Spanish**

Run `bun run dev`, switch to Spanish, and check each of these at a narrow window width:

1. **Topbar chips** — Period and Host labels plus the longer `Actualizar fuentes` button must not wrap or overflow.
2. **History session table** (`Última actividad`, `Razonamiento`) — the widest headers in the app.
3. **Model rates table** (`Lectura de caché`, `Escritura de caché`) — seven columns of translated headers.
4. **Y-axis ticks** — `645 mil` is seven characters, exactly at the documented 48px gutter budget. Confirm no clipping; if it clips, widen `width={48}` on the `YAxis` in `headline.tsx` and note the new value.
5. **X-axis ticks on the `Últimas 24 horas` period** — `20 jul, 9` labels are wider than the old `07-20 09`. Confirm recharts drops ticks rather than overlapping them.
6. **Breakdown group-by chips** — five translated chips on one row.

Fix any overflow in `apps/web/src/styles.css`. Record anything you deliberately left alone.

- [ ] **Step 5: Run the full gate**

Run: `bun run check`
Expected: PASS — `format:check`, `lint`, `typecheck`, `test`, and `build` all green.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web
git commit -m "Sweep for untranslated strings and fix Spanish layout overflow"
```

---

## Self-Review Notes

**Spec coverage.** Every section of the design doc maps to a task: scope (constraints), stack and bundling (7), currency code (1), axis ticks (2, 9), `formatPercent` (2), `formatBucketLabel` (3), model boundary (4, 5, 16 step 2), key structure and concatenation sites (8–14), glossary (locale files across 8–14), selection and `<html lang>` (6, 7, 15), testing (1–6), non-goals (16 step 3 is a one-off, not a standing test, as specified).

**Known ordering hazards.**

- Task 4 leaves a deliberate temporary literal in `headline.tsx` that Task 9 removes. Task 5 leaves three, removed by Tasks 10, 11, and 12. Executing out of order leaves English text in a Spanish page.
- Task 13 leaves `{tab === "language" && null}`, filled by Task 15.
- The `languageChanged` listener ordering in Task 7 is verified behaviourally in Task 15 step 4, not by a unit test — there is no React test runner in this repo.

**Interface consistency.** `formatMoneyCompact` is deleted in Task 2 and every later reference uses `formatNumberCompact`. `harnessLabel` gains its second parameter in Task 5 and every later call site passes `t("common.unknownHarness")`. `usageSourceLabel` keeps its single-parameter signature throughout. `formatCoverage` is deleted in Task 4 and replaced by `coverageMessage` from `model/coverage.ts`. `formatPercent` takes a ratio and renders one decimal; `formatWholePercent` takes an already-whole percentage and renders none — quota meters and token-mix shares use the latter.

**One formatting path.** Every interpolated number is formatted by `model/format.ts` before it reaches `t()`. i18next's built-in `{{value, number}}` formatter is used nowhere, because it carries its own locale state that could drift from `format.ts`. No interpolation parameter is named `count`: i18next reserves it for plural selection.

**Exports each task adds**, for cross-checking as tasks land out of order:

| Task | New or changed exports                                                         |
| ---- | ------------------------------------------------------------------------------ |
| 1    | `SupportedLocale`, `setFormatLocale`, `currentFormatLocale`                    |
| 2    | `formatWholePercent`, `formatNumberCompact` (deletes `formatMoneyCompact`)     |
| 3    | `formatBucketLabel(bucket, timeZone?)`                                         |
| 4    | `coverageMessage`, `CoverageMessage`, `CoverageKey` (deletes `formatCoverage`) |
| 5    | `harnessLabel(id, unknownLabel)`                                               |
| 6    | `SUPPORTED_LANGUAGES`, `LANGUAGE_STORAGE_KEY`, `resolveLanguage`               |
| 7    | default `i18n`, `changeLanguage`                                               |
| 10   | `TOKEN_MIX` changes shape — colours only, no `label`                           |
| 15   | `LanguageSettings`                                                             |

export type SupportedLocale = "en" | "es" | "de" | "fr" | "ja" | "zh" | "hi" | "ru";

const SUPPORTED: readonly SupportedLocale[] = ["en", "es", "de", "fr", "ja", "zh", "hi", "ru"];
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
  // Lowercased for the same reason `i18n/language.ts`'s `resolveLanguage`
  // lowercases the base subtag it extracts: two functions doing the same
  // extraction must not silently disagree on case.
  const base = locale.split("-")[0]?.toLowerCase();
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
const percentCache = new Map<SupportedLocale, Intl.NumberFormat>();
const wholePercentCache = new Map<SupportedLocale, Intl.NumberFormat>();

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

/**
 * A number for a chart axis, where `formatMoney` does not fit. "USD 8,947.32"
 * is twelve characters and gets clipped, so ticks lose both the cents and the
 * currency — the unit is stated once on the measure toggle above the chart, and
 * the hero figure beside it carries the full "USD 8,947.32".
 *
 * Keeps `compact()`'s single fraction digit. Dropping to zero to save gutter
 * width is a trade that looks free and is not: recharts picks evenly spaced
 * ticks, so a domain like 0..3,008 yields 1,504 and 2,256, which both round to
 * "2K" and put the SAME label on two different gridlines. The axis is then not
 * merely imprecise but self-contradictory. Width is bought with the gutter
 * instead — see the `YAxis` `width` in `components/headline.tsx`.
 */
export function formatNumberCompact(value: number): string {
  return compact().format(value);
}

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

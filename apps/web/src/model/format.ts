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
const moneyCompact = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatMoney(value: number): string {
  return money.format(value);
}

export function formatTokens(value: number): string {
  return value < 1_000 ? plain.format(value) : compact.format(value);
}

/**
 * Money for a chart axis, where `formatMoney` does not fit. A 48px-wide axis
 * gutter at 11px type holds roughly seven characters; "$8,947.32" is nine and
 * gets clipped, which turns a precise figure into a misread one. Ticks are for
 * scale, so they lose the cents the hero figure keeps.
 */
export function formatMoneyCompact(value: number): string {
  return moneyCompact.format(value);
}

/**
 * Renders an analysis timeline bucket as an axis label. Buckets are ISO and come
 * in exactly two shapes from `timelineBucket`: `2026-07-20` for every timeframe
 * except `last24`, and a full `2026-07-20T09:00:00.000Z` for that one. The year
 * is dropped because every bucket on an axis shares it.
 *
 * Positional slicing is fine only because both shapes are fixed-width ISO; this
 * lives here, tested, rather than inline in the chart, because a silent
 * off-by-one produces labels that still look like dates.
 */
export function formatBucketLabel(bucket: string): string {
  return bucket.length > 10 ? bucket.slice(5, 13).replace("T", " ") : bucket.slice(5);
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

/**
 * Absolute instants rendered in the reader's own time zone — "resets at 3pm" is
 * only useful in the zone they are sitting in — but under the pinned locale, so
 * the wording and ordering stay consistent with every other string on the page.
 * Calling `Date#toLocaleString()` directly would take BOTH from the OS and is
 * the bypass this module exists to prevent.
 *
 * `timeZone` is an override for tests only: without it the output depends on the
 * machine running the suite, which is exactly the non-determinism the locale
 * comment above is guarding against.
 *
 * Returns null rather than the string "Invalid Date" when the input cannot be
 * parsed, so a caller renders nothing instead of pasting that into a sentence.
 */
export function formatDateTime(value: string, timeZone?: string): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  return new Intl.DateTimeFormat(LOCALE, timeZone ? { ...options, timeZone } : options).format(
    instant,
  );
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

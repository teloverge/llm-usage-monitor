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

import type { UsageTotals } from "@llm-usage-monitor/contracts";

export interface CacheStat {
  /**
   * The cache-efficiency ratio, or null when no tokens backed it. Null means
   * "nothing reported", which the strip must render as words rather than 0%.
   */
  ratio: number | null;
  /**
   * Tokens the ratio actually speaks for, when that is less than the period's
   * input. Null when coverage is complete and there is nothing to disclose.
   */
  partialOf: number | null;
}

/**
 * Decides what the cache stat may claim.
 *
 * The gate is `cacheReportingInputTokens`, NOT `cacheReportingRecords`, because
 * that is the ratio's own denominator: `cacheEfficiency` is
 * `cachedInputTokens / cacheReportingInputTokens`. Records can report caching
 * while contributing no input tokens at all, and then `analyzeUsage` returns a
 * guarded `cacheEfficiency` of 0 — which a records-based gate would happily
 * render as a measured "0.0%" when nothing was measured.
 *
 * Coverage is likewise disclosed in TOKENS, not records: the ratio is
 * token-weighted, so a few large calls that do not report caching can dominate
 * token volume while looking negligible as a record count. "of 6,400 records"
 * would imply the ratio covers far more usage than it does.
 */
export function cacheStat(totals: UsageTotals): CacheStat {
  if (totals.cacheReportingInputTokens <= 0) return { ratio: null, partialOf: null };
  return {
    ratio: totals.cacheEfficiency,
    partialOf:
      totals.cacheReportingInputTokens < totals.inputTokens
        ? totals.cacheReportingInputTokens
        : null,
  };
}

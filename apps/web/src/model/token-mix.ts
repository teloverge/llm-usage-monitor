import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { TOKEN_MIX_ORDER } from "../theme/palette.ts";

/**
 * `unreported` is not a token category — it is the absence of one. Input tokens
 * belonging to records whose source never said whether they were cached cannot
 * be called fresh, so they get their own segment rather than being folded into
 * one. The component renders it in the neutral track colour, never a series hue.
 */
export type TokenMixKey = (typeof TOKEN_MIX_ORDER)[number] | "unreported";

/** Stacking order: the measured categories in palette order, absence last. */
const SEGMENT_ORDER: readonly TokenMixKey[] = [...TOKEN_MIX_ORDER, "unreported"];

export interface TokenMixSegment {
  key: TokenMixKey;
  tokens: number;
  /** Whole percent of the bar. Segments always sum to exactly 100. */
  percent: number;
}

/**
 * Splits a period's tokens into bar segments.
 *
 * The subtraction that matters is `cacheReportingInputTokens - cachedInputTokens`,
 * NOT `inputTokens - cachedInputTokens`. `summarize` accumulates
 * `cachedInputTokens` over only the records that reported caching, while
 * `inputTokens` covers every record — so the naive difference sweeps a silent
 * source's entire input into "Fresh input" and states, in a labelled chart, that
 * it was not cached. That is the same unavailable-is-not-zero mistake
 * `cacheEfficiency` was fixed for, and it is more damaging here because a chart
 * segment reads as a measurement rather than a ratio.
 *
 * Today Codex reports caching on every record, so `unreported` is 0 and the bar
 * has three segments. It becomes non-zero the moment a source that does not
 * report caching lands, which is the entire point of the multi-harness work.
 */
export function tokenMixSegments(totals: UsageTotals): TokenMixSegment[] {
  const reportingInput = Math.min(totals.cacheReportingInputTokens, totals.inputTokens);
  const tokens: Record<TokenMixKey, number> = {
    fresh: Math.max(0, reportingInput - totals.cachedInputTokens),
    cached: Math.max(0, totals.cachedInputTokens),
    output: Math.max(0, totals.outputTokens),
    unreported: Math.max(0, totals.inputTokens - reportingInput),
  };
  const percents = allocatePercents(SEGMENT_ORDER.map((key) => tokens[key]));
  return SEGMENT_ORDER.map((key, index) => ({
    key,
    tokens: tokens[key],
    percent: percents[index]!,
  }));
}

/**
 * Largest-remainder allocation so the displayed shares add up to 100. Rounding
 * each share independently routinely yields 99% or 101% across a handful of
 * segments, and a "Token mix" panel whose parts visibly fail to make a whole
 * undermines every other number on the page.
 *
 * A segment with no tokens can never be bumped to 1%: the leftover to distribute
 * is always smaller than the count of segments with a fractional part, so only
 * those receive it.
 */
function allocatePercents(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const result = exact.map((value) => Math.floor(value));
  let leftover = 100 - result.reduce((sum, value) => sum + value, 0);
  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);
  for (const { index } of byFraction) {
    if (leftover <= 0) break;
    result[index] = (result[index] ?? 0) + 1;
    leftover -= 1;
  }
  return result;
}

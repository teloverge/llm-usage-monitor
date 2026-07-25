import type { RankedUsage } from "@llm-usage-monitor/contracts";

export interface RankView {
  /** The rows to render, capped at the requested limit. */
  shown: RankedUsage[];
  /** How many rows the cap hid. Always disclosed, never silently dropped. */
  remaining: number;
  /** Cost the longest bar represents. 0 when nothing is priced. */
  maximum: number;
}

/**
 * Lives here rather than inside `rank-list.tsx` because `.tsx` cannot be unit
 * tested in this repo (the runner strips types but cannot parse JSX), and the
 * cases that actually go wrong here are arithmetic, not markup: an empty list, a
 * zero cap, and an all-unpriced period that makes every bar divide by zero.
 */
export function rankView(rows: RankedUsage[], limit: number): RankView {
  // Clamped because `slice(0, -1)` means "all but the last", not "none" — a
  // caller computing a limit arithmetically can reach negative, and the silent
  // result would be a list that drops its smallest row for no visible reason.
  const shown = rows.slice(0, Math.max(0, limit));
  return {
    shown,
    remaining: rows.length - shown.length,
    // Scaled to the widest row ON SCREEN. `rank()` returns rows already sorted
    // by cost descending, so this is also the global maximum; taking it from
    // `shown` keeps the top bar full even if a caller ever passes an unsorted
    // list, rather than rendering every visible bar as a stub.
    maximum: Math.max(0, ...shown.map((row) => row.estimatedCost)),
  };
}

/**
 * Bar width as a percentage. Returns 0 rather than NaN when nothing is priced —
 * `maximum` is 0 for a period whose records have no matching price, and
 * `width: NaN%` is an invalid declaration that CSS drops silently, leaving the
 * previous width in place.
 */
export function rankBarWidth(estimatedCost: number, maximum: number): number {
  if (maximum <= 0) return 0;
  return Math.min(100, Math.max(0, (estimatedCost / maximum) * 100));
}

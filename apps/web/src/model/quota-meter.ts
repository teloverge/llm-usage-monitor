import type { UsageQuotaWindow } from "@llm-usage-monitor/contracts";
import { quotaStatus, type QuotaStatus } from "./format.ts";

export interface QuotaMeterView {
  status: QuotaStatus;
  /** Whole percent to display, or null when the source reported nothing. */
  shown: number | null;
  /** Fill width, 0–100. Zero for an unreported window: nothing to draw. */
  width: number;
}

/**
 * Derives everything the meter shows from one window.
 *
 * The rounding happens ONCE, before the status is chosen, and that ordering is
 * the whole point. Rounding for display but classifying on the raw value makes
 * the two disagree at the thresholds: 89.6 renders as "90%" — the number the
 * spec calls critical — while still being coloured as a warning. The reader
 * judges by the figure in front of them, so the figure is what gets classified.
 *
 * The cost is that 89.6 is treated as critical, over-warning by 0.4 points. For
 * a quota meter that is the safe direction to err, and it is the same reasoning
 * `calculateCost` uses for over-stating rather than under-stating.
 */
export function quotaMeterView(window: UsageQuotaWindow): QuotaMeterView {
  if (window.usedPercent === undefined) {
    return { status: "unreported", shown: null, width: 0 };
  }
  const shown = Math.round(window.usedPercent);
  return {
    status: quotaStatus(shown),
    shown,
    // Clamped because a source over 100% of its quota is reporting real
    // overage, not a bar that should overflow its track.
    width: Math.min(100, Math.max(0, shown)),
  };
}

import type { QuotaWindowKind } from "@llm-usage-monitor/contracts";

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
 *
 * Still produced, and still English, even though the dashboard now translates
 * this: `label` is what a reader of an older build sees and what the view falls
 * back to when `windowKind` declines to classify. See `usageQuotaWindowSchema`.
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

/**
 * The translatable counterpart of `windowLabel`, branching on exactly the same
 * conditions in the same order so the two can never describe one window
 * differently. The view recomputes the count from `windowMinutes`; only the
 * choice of phrasing is carried.
 *
 * Undefined where `windowLabel` falls back to `WINDOW_LABELS` or to the raw id:
 * that branch invents a duration the source never stated, and guessing a kind
 * there would launder that invention into a translated string that looks
 * authoritative. The view renders `label` verbatim instead.
 */
export function windowKind(windowMinutes: number): QuotaWindowKind | undefined {
  if (windowMinutes <= 0) return undefined;
  if (windowMinutes % 10_080 === 0) return "weekly";
  if (windowMinutes % 1_440 === 0) return "daily";
  if (windowMinutes % 60 === 0) return "hourly";
  return "minute";
}

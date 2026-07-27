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

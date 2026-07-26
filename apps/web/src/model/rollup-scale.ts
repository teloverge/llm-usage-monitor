import { rankBarWidth } from "./rank-scale.ts";

/**
 * Width percentage for a row's bar, relative to its largest sibling — never to
 * the grand total, so a child bar cannot imply a share of the whole.
 *
 * Delegates the division to `rankBarWidth` rather than repeating it: that is
 * where the divide-by-zero guard and the 0–100 clamp already live and are
 * tested. Two copies of "turn a value into a bar width" would be two places for
 * the `NaN%` case to regress.
 *
 * The maximum is folded rather than taken with `Math.max(0, ...siblings)`. A
 * Breakdown grouped by task can have thousands of sibling rows, and spreading
 * them passes each as a call argument, which throws RangeError past the engine's
 * limit.
 */
export function shareOfParent(value: number, siblings: number[]): number {
  const maximum = siblings.reduce((largest, sibling) => (sibling > largest ? sibling : largest), 0);
  return rankBarWidth(value, maximum);
}

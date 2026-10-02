/**
 * The cost a full-width bar stands for across one Breakdown tree: the largest
 * top-level row.
 *
 * Every level shares this one scale. Scaling each level against its own largest
 * sibling drew a child as long as its parent whenever it led its siblings —
 * "high" at USD 2,900 filled the same track as the USD 5,600 model above it.
 * On a shared scale a child's bar can never outrun its parent's, and any two
 * bars in the tree compare directly.
 *
 * The maximum is folded rather than taken with `Math.max(0, ...values)`. A
 * Breakdown grouped by task can have thousands of rows, and spreading them
 * passes each as a call argument, which throws RangeError past the engine's
 * limit.
 */
export function rollupScale(values: number[]): number {
  return values.reduce((largest, value) => (value > largest ? value : largest), 0);
}

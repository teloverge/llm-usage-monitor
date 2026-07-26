export type CoverageKey =
  | "headline.coverage.none"
  | "headline.coverage.all"
  | "headline.coverage.partial";

export interface CoverageMessage {
  key: CoverageKey;
  params: { records: number; priced: number };
}

/**
 * Chooses which sentence describes pricing coverage, without composing it.
 *
 * Returns a key and params rather than prose so the wording lives in the
 * translation files while the branching stays here, pure and independently
 * tested. `model/` never imports `t`.
 *
 * Named fields rather than two positional numbers: a transposed positional call
 * type-checks and yields plausible-but-wrong text ("4,900 of 4,812 records
 * priced") directly under the hero figure, where a reader would trust it.
 *
 * Always returns a message, never null — the sole consumer splices it into a
 * sentence with no conditional, so the empty case belongs here rather than
 * duplicated as a null-guard at the call site.
 */
export function coverageMessage({
  records,
  priced,
}: {
  records: number;
  priced: number;
}): CoverageMessage {
  const params = { records, priced };
  if (records === 0) return { key: "headline.coverage.none", params };
  return priced === records
    ? { key: "headline.coverage.all", params }
    : { key: "headline.coverage.partial", params };
}

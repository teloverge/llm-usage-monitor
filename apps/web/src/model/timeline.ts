const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Every bucket the trend chart should plot for the period, empty ones included.
 *
 * The analysis timeline only has buckets that hold records, and the chart's
 * x-axis is categorical, so a quiet week simply vanished: Sep 15 sat beside
 * Sep 22 and the line ran straight between them as though they were adjacent
 * days. Filling the gaps with zeros gives every day (or hour) its own slot, so
 * a pause reads as a pause.
 *
 * Buckets come in the two shapes `timelineBucket` produces: a UTC date
 * (`2026-09-15`) or, for `last24`, a UTC hour (`2026-09-15T09:00:00.000Z`).
 * The span runs from the start of the selected period to `now`; for `all` and
 * `custom` there is no fixed start, so it runs from the first bucket with data,
 * and `custom` ends at its last.
 */
export function timelineBuckets(
  present: readonly string[],
  timeframe: string,
  now: Date,
): string[] {
  if (!present.length) return [];
  const hourly = present[0]!.length > 10;
  const step = hourly ? HOUR : DAY;
  const parse = (bucket: string) => Date.parse(hourly ? bucket : `${bucket}T00:00:00.000Z`);
  const floor = (instant: number) => Math.floor(instant / step) * step;
  const format = (instant: number) => {
    const iso = new Date(instant).toISOString();
    return hourly ? `${iso.slice(0, 13)}:00:00.000Z` : iso.slice(0, 10);
  };

  const times = present.map(parse).filter(Number.isFinite);
  if (times.length !== present.length) return [...present];
  let first = times.reduce((low, time) => Math.min(low, time));
  let last = times.reduce((high, time) => Math.max(high, time));

  const days = Number(timeframe);
  if (timeframe === "last24") first = Math.min(first, floor(now.getTime() - DAY));
  else if (Number.isFinite(days) && days > 0)
    first = Math.min(first, floor(now.getTime() - days * DAY));
  if (timeframe !== "custom") last = Math.max(last, floor(now.getTime()));

  const buckets: string[] = [];
  for (let instant = first; instant <= last; instant += step) buckets.push(format(instant));
  return buckets;
}

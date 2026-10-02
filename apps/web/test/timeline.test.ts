import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timelineBuckets } from "../src/model/timeline.ts";

const now = new Date("2026-10-01T15:30:00.000Z");

describe("timelineBuckets", () => {
  it("fills the days between buckets that have data", () => {
    assert.deepEqual(timelineBuckets(["2026-09-27", "2026-09-30"], "all", now), [
      "2026-09-27",
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("runs a day-count period from its start to today", () => {
    const buckets = timelineBuckets(["2026-09-29"], "7", now);
    assert.equal(buckets[0], "2026-09-24");
    assert.equal(buckets.at(-1), "2026-10-01");
    assert.equal(buckets.length, 8);
  });

  it("fills hours for the last-24-hours period", () => {
    const buckets = timelineBuckets(["2026-10-01T10:00:00.000Z"], "last24", now);
    assert.equal(buckets[0], "2026-09-30T15:00:00.000Z");
    assert.equal(buckets.at(-1), "2026-10-01T15:00:00.000Z");
    assert.equal(buckets.length, 25);
  });

  it("ends a custom range at its last bucket, not today", () => {
    assert.deepEqual(timelineBuckets(["2026-09-01", "2026-09-03"], "custom", now), [
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("is empty when nothing has data", () => {
    assert.deepEqual(timelineBuckets([], "30", now), []);
  });

  it("passes unreadable buckets through untouched rather than guessing", () => {
    assert.deepEqual(timelineBuckets(["soon"], "30", now), ["soon"]);
  });
});

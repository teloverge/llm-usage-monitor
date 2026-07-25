import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { rankBarWidth, rankView } from "../src/model/rank-scale.ts";

const row = (key: string, estimatedCost: number): RankedUsage => ({
  key,
  estimatedCost,
  totalTokens: 0,
  records: 1,
  modeFlags: { ultra: false, fast: false },
});

describe("Rank view", () => {
  it("caps the rows at the limit and reports what it hid", () => {
    const view = rankView([row("a", 10), row("b", 6), row("c", 2)], 2);
    assert.deepEqual(
      view.shown.map((entry) => entry.key),
      ["a", "b"],
    );
    assert.equal(view.remaining, 1);
  });

  it("hides nothing when the list is shorter than the limit", () => {
    const view = rankView([row("a", 10)], 4);
    assert.equal(view.shown.length, 1);
    assert.equal(view.remaining, 0);
  });

  it("scales to the largest visible cost", () => {
    assert.equal(rankView([row("a", 8), row("b", 2)], 4).maximum, 8);
  });

  it("reports a zero maximum when nothing in the period is priced", () => {
    assert.equal(rankView([row("a", 0), row("b", 0)], 4).maximum, 0);
  });

  it("reports a zero maximum for an empty list rather than -Infinity", () => {
    // Math.max() with no arguments returns -Infinity, which would make every
    // width calculation negative.
    assert.equal(rankView([], 4).maximum, 0);
    assert.equal(rankView([], 4).remaining, 0);
  });

  // A non-positive limit must not read as "there is nothing here" — the rows
  // exist, they are simply all hidden, and `remaining` has to say so.
  it("treats a zero limit as hiding everything, not as an empty list", () => {
    const view = rankView([row("a", 10), row("b", 6)], 0);
    assert.equal(view.shown.length, 0);
    assert.equal(view.remaining, 2);
  });

  // Unclamped, `slice(0, -1)` means "all but the last" — a negative limit would
  // quietly drop the smallest row and report one hidden, which looks plausible.
  it("treats a negative limit as hiding everything, not as dropping the last row", () => {
    const view = rankView([row("a", 10), row("b", 6), row("c", 2)], -1);
    assert.equal(view.shown.length, 0);
    assert.equal(view.remaining, 3);
  });
});

describe("Rank bar width", () => {
  it("gives the largest row the full track", () => {
    assert.equal(rankBarWidth(8, 8), 100);
  });

  it("scales smaller rows proportionally", () => {
    assert.equal(rankBarWidth(2, 8), 25);
  });

  it("returns zero rather than NaN when nothing is priced", () => {
    // `width: NaN%` is an invalid CSS declaration: the browser drops it and the
    // element keeps whatever width it had, so a broken bar looks like a real one.
    assert.equal(rankBarWidth(0, 0), 0);
    assert.ok(!Number.isNaN(rankBarWidth(5, 0)));
  });

  it("never exceeds the track", () => {
    assert.equal(rankBarWidth(12, 8), 100);
  });

  it("never goes negative", () => {
    assert.equal(rankBarWidth(-3, 8), 0);
  });
});

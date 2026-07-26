import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shareOfParent } from "../src/model/rollup-scale.ts";

describe("Rollup bar scaling", () => {
  it("scales a child against its largest sibling, not the grand total", () => {
    assert.equal(shareOfParent(25, [25, 50]), 50);
    assert.equal(shareOfParent(50, [25, 50]), 100);
  });

  it("returns zero width when every sibling is zero", () => {
    assert.equal(shareOfParent(0, [0, 0]), 0);
  });

  it("returns zero width when there are no siblings", () => {
    assert.equal(shareOfParent(10, []), 0);
  });

  // A Breakdown grouped by task can have thousands of sibling rows. `Math.max(0,
  // ...siblings)` passes each one as a call argument and throws RangeError past
  // the engine's argument limit, so the maximum is folded instead.
  it("handles more siblings than the spread operator can pass as arguments", () => {
    const many = Array.from({ length: 200_000 }, (_, index) => index);
    assert.doesNotThrow(() => shareOfParent(199_999, many));
    assert.equal(shareOfParent(199_999, many), 100);
  });

  it("never returns a width that overflows its track", () => {
    // Defensive: `value` is normally one of `siblings`, but a caller passing a
    // row from a different level would otherwise produce a bar wider than 100%.
    assert.equal(shareOfParent(80, [10, 20]), 100);
  });
});

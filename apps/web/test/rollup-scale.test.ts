import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankBarWidth } from "../src/model/rank-scale.ts";
import { rollupScale } from "../src/model/rollup-scale.ts";

describe("Rollup bar scaling", () => {
  it("is the largest top-level value", () => {
    assert.equal(rollupScale([25, 50, 10]), 50);
  });

  it("keeps a child's bar shorter than its parent's", () => {
    // A model at 5,600 whose leading reasoning level spent 2,900: on the
    // shared scale the child is about half the parent, not a second full bar.
    const scale = rollupScale([5_600, 2_200]);
    assert.equal(rankBarWidth(5_600, scale), 100);
    assert.ok(rankBarWidth(2_900, scale) < 52);
  });

  it("is zero when every value is zero or there are none", () => {
    assert.equal(rollupScale([0, 0]), 0);
    assert.equal(rollupScale([]), 0);
  });

  // A Breakdown grouped by task can have thousands of rows. `Math.max(0,
  // ...values)` passes each one as a call argument and throws RangeError past
  // the engine's argument limit, so the maximum is folded instead.
  it("handles more values than the spread operator can pass as arguments", () => {
    const many = Array.from({ length: 200_000 }, (_, index) => index);
    assert.doesNotThrow(() => rollupScale(many));
    assert.equal(rollupScale(many), 199_999);
  });
});

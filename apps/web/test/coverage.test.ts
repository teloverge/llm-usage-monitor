import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coverageMessage } from "../src/model/coverage.ts";

describe("Coverage message", () => {
  /**
   * Named fields rather than two positional numbers: a transposed positional
   * call type-checks and yields plausible-but-wrong text ("4,900 of 4,812
   * records priced") directly under the hero figure, where a reader would trust
   * it.
   */
  it("reports full coverage without a qualifier", () => {
    assert.deepEqual(coverageMessage({ records: 4900, priced: 4900 }), {
      key: "headline.coverage.all",
      params: { records: 4900, priced: 4900 },
    });
  });

  it("discloses the shortfall when some records are unpriced", () => {
    assert.deepEqual(coverageMessage({ records: 4900, priced: 4812 }), {
      key: "headline.coverage.partial",
      params: { records: 4900, priced: 4812 },
    });
  });

  /**
   * An empty period is a DIFFERENT message, not a plural form of the others.
   * Neither English nor Spanish has a CLDR "zero" plural category, so relying on
   * a plural suffix here would be wrong in both.
   */
  it("describes an empty period with its own message", () => {
    assert.deepEqual(coverageMessage({ records: 0, priced: 0 }), {
      key: "headline.coverage.none",
      params: { records: 0, priced: 0 },
    });
  });

  // Always returns a renderable message, never null — the sole consumer splices
  // it into a sentence with no conditional, so the empty case belongs here
  // rather than duplicated as a null-guard at the call site.
  it("always returns a key", () => {
    for (const input of [
      { records: 0, priced: 0 },
      { records: 1, priced: 0 },
      { records: 1, priced: 1 },
    ]) {
      assert.ok(coverageMessage(input).key.startsWith("headline.coverage."));
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subtractTokenShapes, usageModeFlags } from "../src/codex-importer.ts";

describe("Codex importer", () => {
  it("subtracts cumulative counters without negative reset deltas", () =>
    assert.equal(
      subtractTokenShapes(
        {
          inputTokens: 10,
          cachedInputTokens: 20,
          outputTokens: 2,
          reasoningOutputTokens: 1,
          totalTokens: 12,
        },
        {
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          totalTokens: 120,
        },
      ).cachedInputTokens,
      10,
    ));
  it("records ultra reasoning and priority service as explicit mode flags", () =>
    assert.deepEqual(usageModeFlags({ service_tier: "priority" }, "ultrathink"), {
      ultra: true,
      fast: true,
    }));
});

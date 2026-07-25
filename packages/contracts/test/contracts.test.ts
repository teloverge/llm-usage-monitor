import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dashboardActionSchema, timeframeSchema, usageRecordSchema } from "../src/index.ts";

describe("dashboard contracts", () => {
  it("accepts the rolling last 24 hour timeframe", () =>
    assert.equal(timeframeSchema.parse("last24"), "last24"));
  it("rejects unknown action fields", () =>
    assert.throws(() =>
      dashboardActionSchema.parse({
        version: 1,
        type: "clear-records",
        confirmation: "clear-usage-records",
        surprise: true,
      }),
    ));
  it("defaults legacy Usage Records to no recorded modes", () => {
    const parsed = usageRecordSchema.parse({
      id: "record:1",
      sourceHostId: "host:1",
      timestamp: "2026-07-23T12:00:00.000Z",
      taskName: "Task",
      provider: "openai",
      model: "gpt",
      reasoningLevel: "high",
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
      totalTokens: 2,
      lastTokenUsage: null,
      modelContextWindowTokens: 0,
      rateLimits: null,
      source: "test",
    });
    assert.deepEqual(parsed.modeFlags, { ultra: false, fast: false });
  });
});

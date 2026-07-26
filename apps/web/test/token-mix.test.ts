import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { tokenMixSegments } from "../src/model/token-mix.ts";

const totals = (overrides: Partial<UsageTotals>): UsageTotals => ({
  estimatedCost: 0,
  pricedRecords: 0,
  records: 0,
  tasks: 0,
  models: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReportingRecords: 0,
  cacheReportingInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  cacheEfficiency: 0,
  ...overrides,
});

const tokensFor = (segments: ReturnType<typeof tokenMixSegments>, key: string) =>
  segments.find((segment) => segment.key === key)?.tokens;

describe("Token mix segments", () => {
  it("splits reported input into cached and fresh", () => {
    const segments = tokenMixSegments(
      totals({
        inputTokens: 1000,
        cachedInputTokens: 400,
        cacheReportingInputTokens: 1000,
        outputTokens: 200,
      }),
    );
    assert.equal(tokensFor(segments, "fresh"), 600);
    assert.equal(tokensFor(segments, "cached"), 400);
    assert.equal(tokensFor(segments, "output"), 200);
    assert.equal(tokensFor(segments, "unreported"), 0);
  });

  // The defect this module exists to prevent. Half the input comes from a source
  // that never says whether it cached; calling it "fresh" is a measurement claim
  // the data does not support.
  it("does not count input from a non-reporting source as fresh", () => {
    const segments = tokenMixSegments(
      totals({
        inputTokens: 1000,
        cachedInputTokens: 200,
        cacheReportingInputTokens: 500,
        outputTokens: 0,
      }),
    );
    assert.equal(tokensFor(segments, "fresh"), 300, "fresh is reported input minus cached");
    assert.equal(tokensFor(segments, "cached"), 200);
    assert.equal(
      tokensFor(segments, "unreported"),
      500,
      "the silent source's input stays separate",
    );
  });

  it("reports zero cached tokens as measured, not as unreported", () => {
    const segments = tokenMixSegments(
      totals({ inputTokens: 800, cachedInputTokens: 0, cacheReportingInputTokens: 800 }),
    );
    assert.equal(tokensFor(segments, "cached"), 0);
    assert.equal(tokensFor(segments, "unreported"), 0);
    assert.equal(tokensFor(segments, "fresh"), 800);
  });

  it("never emits a negative segment when totals disagree", () => {
    // cacheReportingInputTokens can never legitimately exceed inputTokens, but a
    // negative width would silently corrupt the whole bar if it ever did.
    const segments = tokenMixSegments(
      totals({ inputTokens: 100, cachedInputTokens: 500, cacheReportingInputTokens: 900 }),
    );
    for (const segment of segments) assert.ok(segment.tokens >= 0, `${segment.key} is negative`);
  });

  it("reports every segment as zero for an empty period", () => {
    const segments = tokenMixSegments(totals({}));
    for (const segment of segments) {
      assert.equal(segment.tokens, 0);
      assert.equal(segment.percent, 0);
    }
  });
});

describe("Token mix percentages", () => {
  const sum = (segments: ReturnType<typeof tokenMixSegments>) =>
    segments.reduce((running, segment) => running + segment.percent, 0);

  it("adds up to exactly 100 for an even three-way split", () => {
    // 33.33 each: rounding independently gives 33/33/33 = 99.
    const segments = tokenMixSegments(
      totals({
        inputTokens: 200,
        cachedInputTokens: 100,
        cacheReportingInputTokens: 200,
        outputTokens: 100,
      }),
    );
    assert.equal(sum(segments), 100);
  });

  it("adds up to exactly 100 across a spread that rounds badly", () => {
    const segments = tokenMixSegments(
      totals({
        inputTokens: 1000,
        cachedInputTokens: 333,
        cacheReportingInputTokens: 667,
        outputTokens: 333,
      }),
    );
    assert.equal(sum(segments), 100);
  });

  it("never inflates an empty segment to a visible share", () => {
    const segments = tokenMixSegments(
      totals({
        inputTokens: 300,
        cachedInputTokens: 100,
        cacheReportingInputTokens: 300,
        outputTokens: 100,
      }),
    );
    assert.equal(segments.find((segment) => segment.key === "unreported")?.percent, 0);
    assert.equal(sum(segments), 100);
  });
});

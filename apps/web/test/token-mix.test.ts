import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { tokenMix, type TokenMixSegment } from "../src/model/token-mix.ts";

const totals = (overrides: Partial<UsageTotals>): UsageTotals => ({
  estimatedCost: 0,
  costBreakdown: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, cacheSavings: 0 },
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

const find = (segments: TokenMixSegment[], key: string) =>
  segments.find((segment) => segment.key === key);

describe("Token mix segments", () => {
  it("splits reported input into fresh, and states cached input apart", () => {
    const mix = tokenMix(
      totals({
        inputTokens: 1000,
        cachedInputTokens: 400,
        cacheReportingInputTokens: 1000,
        outputTokens: 200,
      }),
    );
    assert.equal(find(mix.segments, "fresh")?.tokens, 600);
    assert.equal(find(mix.segments, "output")?.tokens, 200);
    assert.equal(find(mix.segments, "unreported")?.tokens, 0);
    assert.equal(mix.cached, 400);
  });

  it("keeps cached input out of the bar", () => {
    const mix = tokenMix(
      totals({ inputTokens: 1000, cachedInputTokens: 900, cacheReportingInputTokens: 1000 }),
    );
    assert.equal(find(mix.segments, "cached" as never), undefined);
  });

  // The defect this module exists to prevent. Half the input comes from a source
  // that never says whether it cached; calling it "fresh" is a measurement claim
  // the data does not support.
  it("does not count input from a non-reporting source as fresh", () => {
    const mix = tokenMix(
      totals({
        inputTokens: 1000,
        cachedInputTokens: 200,
        cacheReportingInputTokens: 500,
        outputTokens: 0,
      }),
    );
    assert.equal(find(mix.segments, "fresh")?.tokens, 300, "fresh is reported input minus cached");
    assert.equal(mix.cached, 200);
    assert.equal(
      find(mix.segments, "unreported")?.tokens,
      500,
      "the silent source's input stays separate",
    );
  });

  it("never emits a negative segment when totals disagree", () => {
    // cacheReportingInputTokens can never legitimately exceed inputTokens, but a
    // negative width would silently corrupt the whole bar if it ever did.
    const mix = tokenMix(
      totals({ inputTokens: 100, cachedInputTokens: 500, cacheReportingInputTokens: 900 }),
    );
    for (const segment of mix.segments) {
      assert.ok(segment.tokens >= 0, `${segment.key} is negative`);
    }
  });

  it("reports every segment as zero for an empty period", () => {
    for (const segment of tokenMix(totals({})).segments) {
      assert.equal(segment.tokens, 0);
      assert.equal(segment.percent, 0);
      assert.equal(segment.belowOnePercent, false);
    }
  });
});

describe("Token mix percentages", () => {
  const sum = (segments: TokenMixSegment[]) =>
    segments.reduce((running, segment) => running + segment.percent, 0);

  it("adds up to exactly 100 for an even three-way split", () => {
    // 33.33 each: rounding independently gives 33/33/33 = 99.
    const mix = tokenMix(
      totals({
        inputTokens: 200,
        cachedInputTokens: 0,
        cacheReportingInputTokens: 100,
        outputTokens: 100,
      }),
    );
    assert.equal(sum(mix.segments), 100);
  });

  it("never inflates an empty segment to a visible share", () => {
    const mix = tokenMix(
      totals({
        inputTokens: 300,
        cachedInputTokens: 100,
        cacheReportingInputTokens: 300,
        outputTokens: 100,
      }),
    );
    assert.equal(find(mix.segments, "unreported")?.percent, 0);
    assert.equal(find(mix.segments, "unreported")?.belowOnePercent, false);
    assert.equal(sum(mix.segments), 100);
  });

  it("flags a non-empty segment that rounds to zero", () => {
    const mix = tokenMix(
      totals({ inputTokens: 100_000, cacheReportingInputTokens: 100_000, outputTokens: 100 }),
    );
    const output = find(mix.segments, "output");
    assert.equal(output?.percent, 0);
    assert.equal(output?.belowOnePercent, true);
  });
});

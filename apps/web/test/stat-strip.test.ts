import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { cacheStat } from "../src/model/stat-strip.ts";

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

describe("Cache stat", () => {
  it("reports the ratio with no disclosure when every token is covered", () => {
    const stat = cacheStat(
      totals({ inputTokens: 1000, cacheReportingInputTokens: 1000, cacheEfficiency: 0.4 }),
    );
    assert.equal(stat.ratio, 0.4);
    assert.equal(stat.partialOf, null);
  });

  it("discloses coverage in tokens when part of the period did not report", () => {
    const stat = cacheStat(
      totals({ inputTokens: 1000, cacheReportingInputTokens: 400, cacheEfficiency: 0.5 }),
    );
    assert.equal(stat.ratio, 0.5);
    assert.equal(stat.partialOf, 400, "the tokens the ratio speaks for, not a record count");
  });

  // The defect this module exists to prevent. Records can report caching while
  // contributing no input tokens; analyzeUsage then guards the division and
  // returns 0, and a records-based gate renders that as a measured "0.0%".
  it("reports nothing when records claim to report but no tokens back the ratio", () => {
    const stat = cacheStat(
      totals({
        inputTokens: 1000,
        cacheReportingRecords: 12,
        cacheReportingInputTokens: 0,
        cacheEfficiency: 0,
      }),
    );
    assert.equal(stat.ratio, null, "0% would be a measurement claim with an empty denominator");
    assert.equal(stat.partialOf, null);
  });

  it("reports nothing for an empty period", () => {
    const stat = cacheStat(totals({}));
    assert.equal(stat.ratio, null);
    assert.equal(stat.partialOf, null);
  });

  // Zero cache efficiency is a real measurement when tokens back it: the source
  // reported, and nothing was cached. It must not collapse into "not reported".
  it("distinguishes a measured zero ratio from an unmeasured one", () => {
    const stat = cacheStat(
      totals({ inputTokens: 800, cacheReportingInputTokens: 800, cacheEfficiency: 0 }),
    );
    assert.equal(stat.ratio, 0);
    assert.equal(stat.partialOf, null);
  });
});

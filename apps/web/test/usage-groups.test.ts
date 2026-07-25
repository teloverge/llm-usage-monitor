import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RankedUsage, UsageHistoryRecord } from "@llm-usage-monitor/contracts";
import { groupHistoryByTask, groupModelsByProvider } from "../src/usage-groups.ts";

const historyRecord = (overrides: Partial<UsageHistoryRecord>): UsageHistoryRecord => ({
  id: "record:1",
  sessionId: "session:1",
  timestamp: "2026-07-23T12:00:00.000Z",
  taskName: "Review changes",
  provider: "openai",
  model: "gpt-test",
  reasoningLevel: "high",
  modeFlags: { ultra: false, fast: false },
  inputTokens: 100,
  cachedInputTokens: 20,
  outputTokens: 10,
  reasoningOutputTokens: 5,
  totalTokens: 110,
  lastTokenUsage: null,
  modelContextWindowTokens: 1_000,
  rateLimits: null,
  source: "test",
  sourceHostLabel: "Workstation",
  estimatedCost: 0.1,
  ...overrides,
});

describe("usage display grouping", () => {
  it("normalizes equivalent task names and sums records into sessions", () => {
    const groups = groupHistoryByTask([
      historyRecord({ id: "record:1", taskName: " Review   changes ", sessionId: "session:1" }),
      historyRecord({
        id: "record:2",
        taskName: "review changes",
        sessionId: "session:1",
        totalTokens: 90,
        estimatedCost: 0.2,
      }),
      historyRecord({
        id: "record:3",
        taskName: "REVIEW CHANGES",
        sessionId: "session:2",
        totalTokens: 50,
        estimatedCost: null,
      }),
    ]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.sessions.length, 2);
    assert.equal(groups[0]?.records.length, 3);
    assert.equal(groups[0]?.totalTokens, 250);
    assert.ok(Math.abs((groups[0]?.estimatedCost ?? 0) - 0.3) < Number.EPSILON);
    assert.equal(groups[0]?.sessions.find((session) => session.key === "session:1")?.records, 2);
  });

  it("groups model rollups by provider and sums provider totals", () => {
    const row = (model: string, estimatedCost: number): RankedUsage => ({
      key: model,
      provider: "openai",
      model,
      estimatedCost,
      totalTokens: 100,
      records: 1,
      modeFlags: { ultra: false, fast: false },
      children: [],
    });
    const groups = groupModelsByProvider([row("gpt-a", 1), row("gpt-b", 2)]);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.rows.length, 2);
    assert.equal(groups[0]?.estimatedCost, 3);
    assert.equal(groups[0]?.totalTokens, 200);
  });
});

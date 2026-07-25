import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { analyzeHistory, analyzeUsage, timeframeRange } from "../src/index.ts";

const record = (
  timestamp: string,
  reasoningLevel = "high",
  modeFlags = { ultra: false, fast: false },
): UsageRecord => ({
  id: timestamp,
  sourceHostId: "host:a",
  timestamp,
  taskName: "Architecture",
  provider: "openai",
  model: "gpt-test",
  reasoningLevel,
  modeFlags,
  inputTokens: 1_000_000,
  cachedInputTokens: 500_000,
  outputTokens: 100_000,
  reasoningOutputTokens: 50_000,
  totalTokens: 1_100_000,
  lastTokenUsage: null,
  modelContextWindowTokens: 400_000,
  rateLimits: null,
  source: "codex-local",
});

describe("Usage Analysis", () => {
  it("treats Last 24 hours as a rolling window", () => {
    const now = new Date("2026-07-23T12:00:00Z");
    assert.equal(
      timeframeRange({ timeframe: "last24" }, now)[0],
      Date.parse("2026-07-22T12:00:00Z"),
    );
  });
  it("produces the same canonical cost and graph totals", () => {
    const view = analyzeUsage({
      records: [record("2026-07-23T10:00:00Z")],
      prices: [
        {
          provider: "openai",
          model: "gpt-test",
          input: 2,
          cachedInput: 0.5,
          output: 10,
          source: "test",
          effectiveDate: "2026-01-01",
        },
      ],
      sourceHosts: [
        {
          id: "host:a",
          hostname: "workstation",
          platform: "win32",
          architecture: "x64",
          firstSeenAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-07-23T10:00:00Z",
        },
      ],
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    assert.equal(view.totals.estimatedCost, 2.25);
    assert.equal(view.timeline[0]?.estimatedCost, view.totals.estimatedCost);
    assert.equal(view.bySourceHost[0]?.key, "workstation");
  });
  it("rolls reasoning levels and recorded modes into one base model", () => {
    const records = [
      record("2026-07-23T10:00:00Z", "high"),
      record("2026-07-23T11:00:00Z", "ultra", { ultra: true, fast: true }),
    ];
    const view = analyzeUsage({
      records,
      prices: [
        {
          provider: "openai",
          model: "gpt-test",
          input: 2,
          cachedInput: 0.5,
          output: 10,
          source: "test",
          effectiveDate: "2026-01-01",
        },
      ],
      sourceHosts: [
        {
          id: "host:a",
          hostname: "workstation",
          platform: "win32",
          architecture: "x64",
          firstSeenAt: "2026-01-01T00:00:00Z",
          lastSeenAt: "2026-07-23T11:00:00Z",
        },
      ],
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    assert.equal(view.byModel.length, 1);
    assert.deepEqual(
      view.byModel[0]?.children?.map((row) => row.reasoningLevel),
      ["ultra", "high"],
    );
    assert.deepEqual(view.byModel[0]?.modeFlags, { ultra: true, fast: true });
  });
  it("does not expose a hardware address as a Source Host label", () => {
    const records = [{ ...record("2026-07-23T10:00:00Z"), sourceHostId: "AA:BB:CC:DD:EE:FF" }];
    const hosts = [
      {
        id: "AA:BB:CC:DD:EE:FF",
        hostname: "AA:BB:CC:DD:EE:FF",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00Z",
        lastSeenAt: "2026-07-23T10:00:00Z",
      },
    ];
    const prices = [
      {
        provider: "openai",
        model: "gpt-test",
        input: 2,
        cachedInput: 0.5,
        output: 10,
        source: "test",
        effectiveDate: "2026-01-01",
      },
    ];
    const view = analyzeUsage({
      records,
      prices,
      sourceHosts: hosts,
      memberships: [],
      filters: { timeframe: "last24" },
      now: new Date("2026-07-23T12:00:00Z"),
    });
    const history = analyzeHistory(records, prices, hosts);
    assert.equal(view.bySourceHost[0]?.key, "Source Host 1");
    assert.equal(history[0]?.sourceHostLabel, "Source Host 1");
    assert.equal("sourceHostId" in history[0]!, false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { analyzeHistory } from "../src/index.ts";

const record = (overrides: Partial<UsageRecord>): UsageRecord => ({
  id: "record:1",
  usageSourceId: "codex-local",
  harnessId: "codex",
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
  source: "test",
  sourceHostId: "host:a",
  ...overrides,
});

const price = {
  provider: "openai",
  model: "gpt-test",
  // $0.10 per record: 80 fresh + 20 cached input tokens at $1,000 per million.
  input: 1_000,
  cachedInput: 1_000,
  output: 0,
  source: "test",
  effectiveDate: "2026-07-01",
};

describe("History grouping", () => {
  it("normalizes equivalent task names and sums records into sessions", () => {
    const { groups, records } = analyzeHistory(
      [
        record({ id: "record:1", taskName: " Review   changes ", sessionId: "session:1" }),
        record({
          id: "record:2",
          taskName: "review changes",
          sessionId: "session:1",
          totalTokens: 90,
        }),
        record({
          id: "record:3",
          taskName: "REVIEW CHANGES",
          sessionId: "session:2",
          totalTokens: 50,
          model: "unpriced",
        }),
      ],
      [price],
    );
    assert.equal(records, 3);
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.records, 3);
    assert.equal(groups[0]?.sessions.length, 2);
    assert.equal(groups[0]?.totalTokens, 250);
    // Two priced records at $0.1 each; the unpriced one neither adds nor blanks the sum.
    assert.ok(Math.abs((groups[0]?.estimatedCost ?? 0) - 0.2) < Number.EPSILON);
    assert.equal(groups[0]?.sessions.find((session) => session.key === "session:1")?.records, 2);
  });

  it("carries the cost breakdown on the conversation and each session, null when unpriced", () => {
    const { groups } = analyzeHistory(
      [
        record({ id: "a", sessionId: "s1" }),
        record({ id: "b", sessionId: "s2", model: "unpriced", taskName: "Other" }),
      ],
      [price],
    );
    const priced = groups.find((group) => group.taskName === "Review changes");
    // 80 fresh + 20 cached input at $1,000/M each, no output rate.
    assert.deepEqual(priced?.costBreakdown, {
      input: 0.08,
      cacheRead: 0.02,
      cacheWrite: 0,
      output: 0,
      cacheSavings: 0,
    });
    assert.deepEqual(priced?.sessions[0]?.costBreakdown, priced?.costBreakdown);
    assert.equal(groups.find((group) => group.taskName === "Other")?.costBreakdown, null);
  });

  it("never caps: every conversation in the ledger is listed, oldest included", () => {
    const records = Array.from({ length: 1_200 }, (_, index) =>
      record({
        id: `record:${index}`,
        sessionId: `session:${index}`,
        taskName: `Task ${index}`,
        timestamp: new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
      }),
    );
    const { groups } = analyzeHistory(records, []);
    assert.equal(groups.length, 1_200);
    assert.equal(groups[0]?.taskName, "Task 1199");
    assert.equal(groups.at(-1)?.taskName, "Task 0");
  });

  it("collects the harnesses that contributed to a session, raw ids only", () => {
    const [group] = analyzeHistory(
      [
        record({ id: "a" }),
        record({ id: "b", harnessId: "claude-code", usageSourceId: "claude-code-local" }),
      ],
      [],
    ).groups;
    assert.deepEqual(group?.sessions[0]?.harnesses, ["codex", "claude-code"]);
    assert.deepEqual(group?.sessions[0]?.sourceHostIds, ["host:a"]);
  });

  it("reports a missing reasoning level as null, leaving the wording to the view", () => {
    const [group] = analyzeHistory([record({ reasoningLevel: undefined })], []).groups;
    assert.deepEqual(group?.sessions[0]?.reasoningLevels, [null]);
  });

  it("leaves a blank task name empty rather than inventing a label", () => {
    const [group] = analyzeHistory([record({ taskName: "   " })], []).groups;
    assert.equal(group?.taskName, "");
  });
});

describe("History agents", () => {
  const conversation = () =>
    analyzeHistory(
      [
        record({
          id: "r1",
          sessionId: "root",
          timestamp: "2026-07-23T12:00:00.000Z",
          totalTokens: 100,
        }),
        record({
          id: "a1",
          sessionId: "agent-1",
          parentSessionId: "root",
          agentNickname: "Gibbs",
          timestamp: "2026-07-23T12:05:00.000Z",
          totalTokens: 30,
        }),
        record({
          id: "a2",
          sessionId: "agent-2",
          parentSessionId: "root",
          agentNickname: "Zeno",
          timestamp: "2026-07-23T12:10:00.000Z",
          totalTokens: 20,
          model: "unpriced",
        }),
        record({
          id: "a1b",
          sessionId: "agent-1b",
          parentSessionId: "agent-1",
          timestamp: "2026-07-23T12:06:00.000Z",
          totalTokens: 5,
        }),
      ],
      [price],
    ).groups;

  it("spans from the oldest record to the newest, agents included", () => {
    const [group] = conversation();
    assert.equal(group?.firstActiveAt, "2026-07-23T12:00:00.000Z");
    assert.equal(group?.lastActiveAt, "2026-07-23T12:10:00.000Z");
    const agent = group?.sessions.find((session) => session.key === "agent-1");
    assert.equal(agent?.firstActiveAt, "2026-07-23T12:05:00.000Z");
    assert.equal(agent?.lastActiveAt, "2026-07-23T12:05:00.000Z");
  });

  it("totals the whole conversation and the agents' share of it separately", () => {
    const [group] = conversation();
    assert.equal(group?.totalTokens, 155);
    assert.equal(group?.agents.sessions, 3);
    assert.equal(group?.agents.totalTokens, 55);
    // Two priced agents at $0.10 each; the unpriced one is neither added nor blanking.
    assert.ok(Math.abs((group?.agents.estimatedCost ?? 0) - 0.2) < Number.EPSILON);
  });

  it("lists the root first, then its agents depth-first with their depth", () => {
    const [group] = conversation();
    assert.deepEqual(
      group?.sessions.map((session) => [session.key, session.depth, session.agentNickname]),
      [
        ["root", 0, null],
        ["agent-2", 1, "Zeno"],
        ["agent-1", 1, "Gibbs"],
        ["agent-1b", 2, null],
      ],
    );
  });

  it("stands an agent whose parent is missing as a root, still marked as an agent", () => {
    const [group] = analyzeHistory(
      [record({ id: "a", sessionId: "orphan", parentSessionId: "gone" })],
      [],
    ).groups;
    assert.deepEqual(
      group?.sessions.map((session) => [session.key, session.depth, session.parentSessionId]),
      [["orphan", 0, "gone"]],
    );
    assert.equal(group?.agents.sessions, 1);
  });
});

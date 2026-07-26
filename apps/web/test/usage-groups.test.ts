import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageHistoryRecord } from "@llm-usage-monitor/contracts";
import { groupHistoryByTask } from "../src/model/usage-groups.ts";

// The translated wording is injected, exactly as the component will inject it.
const LABELS = { untitledTask: "Untitled task", notReported: "Not reported" };

const historyRecord = (overrides: Partial<UsageHistoryRecord>): UsageHistoryRecord => ({
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
  sourceHostLabel: "Workstation",
  estimatedCost: 0.1,
  ...overrides,
});

describe("usage display grouping", () => {
  it("normalizes equivalent task names and sums records into sessions", () => {
    const groups = groupHistoryByTask(
      [
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
      ],
      LABELS,
    );
    assert.equal(groups.length, 1);
    assert.equal(groups[0]?.sessions.length, 2);
    assert.equal(groups[0]?.records.length, 3);
    assert.equal(groups[0]?.totalTokens, 250);
    assert.ok(Math.abs((groups[0]?.estimatedCost ?? 0) - 0.3) < Number.EPSILON);
    assert.equal(groups[0]?.sessions.find((session) => session.key === "session:1")?.records, 2);
  });
});

describe("Session harness attribution", () => {
  const base = {
    id: "a",
    usageSourceId: "codex-local",
    harnessId: "codex",
    timestamp: "2026-07-20T09:00:00.000Z",
    taskName: "portable-usage-host",
    provider: "openai",
    model: "gpt-5-codex",
    reasoningLevel: "high",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 10,
    cachedInputTokens: 4,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    totalTokens: 12,
    lastTokenUsage: null,
    modelContextWindowTokens: 400_000,
    source: "codex-local",
    sessionId: "session-1",
    sourceHostLabel: "workstation",
    estimatedCost: 1,
  };

  it("collects the harnesses that contributed to a session", () => {
    const [group] = groupHistoryByTask(
      [base, { ...base, id: "b", harnessId: "claude-code", usageSourceId: "claude-code-local" }],
      LABELS,
    );
    assert.deepEqual(group?.sessions[0]?.harnesses, ["codex", "claude-code"]);
  });

  it("labels a missing reasoning level with the caller's not-reported wording", () => {
    const [group] = groupHistoryByTask([{ ...base, reasoningLevel: undefined }], LABELS);
    assert.deepEqual(group?.sessions[0]?.reasoningLevels, ["Not reported"]);
  });

  it("labels a group with no task name using the caller's untitled-task wording", () => {
    const [group] = groupHistoryByTask([{ ...base, taskName: "   " }], LABELS);
    assert.equal(group?.label, "Untitled task");
  });
});

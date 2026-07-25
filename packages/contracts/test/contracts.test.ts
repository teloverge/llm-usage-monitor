import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dashboardActionSchema,
  timeframeSchema,
  usageQuotaSnapshotSchema,
  usageRecordSchema,
} from "../src/index.ts";

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
      usageSourceId: "codex-local",
      harnessId: "codex",
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
      source: "test",
    });
    assert.deepEqual(parsed.modeFlags, { ultra: false, fast: false });
  });
});

describe("Usage quota snapshots", () => {
  it("accepts a snapshot whose windows omit optional measurements", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "claude-code-local",
      sourceHostId: "host:a",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [{ id: "five-hour", label: "5-hour window" }],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, undefined);
    assert.equal(snapshot.plan, undefined);
  });

  it("accepts a fully populated Codex-shaped snapshot", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      plan: "plus",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [
        {
          id: "primary",
          label: "5-hour window",
          usedPercent: 41.5,
          windowMinutes: 300,
          resetsAt: "2026-07-23T12:06:40.000Z",
        },
      ],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, 41.5);
  });

  // Snapshots round-trip through the ledger as JSON (Task 16), so a field the
  // schema does not know about is silently dropped on the way in rather than
  // surfacing as a bug at the source. Strictness turns that into a parse error.
  it("rejects a snapshot carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
        creditsRemaining: 12,
      }),
    );
  });

  it("rejects a window carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", resets_at: 1785300000 }],
      }),
    );
  });

  it("rejects a snapshot with no usage source", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
      }),
    );
  });
});

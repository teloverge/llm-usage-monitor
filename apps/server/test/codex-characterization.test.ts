import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSession } from "../src/codex-importer.ts";

const fixtures = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const session = join(
  fixtures,
  "sessions/2026/07",
  "rollout-2026-07-20T09-00-00-11111111-2222-3333-4444-555555555555.jsonl",
);
// This Map mirrors the shape of fixtures/codex/session_index.jsonl (id -> thread_name).
// parseSession() takes the resolved Map as an argument and never reads the index file
// itself — readTaskIndex() (which does read it) is internal and exercised separately,
// through CodexSessionProvider.collect, by later tasks in this refactor.
const taskNames = new Map([["11111111-2222-3333-4444-555555555555", "portable-usage-host"]]);

// Separate fixture (Task 14): a turn_context payload with no `effort` field at all,
// proving the importer stops fabricating "unknown" when the source didn't report one.
const noEffortSession = join(
  fixtures,
  "sessions/2026/07",
  "rollout-2026-07-21T09-00-00-66666666-7777-8888-9999-aaaaaaaaaaaa.jsonl",
);
const noEffortTaskNames = new Map<string, string>();

describe("Codex parser characterization", () => {
  it("emits one record per turn with cumulative counters converted to deltas", async () => {
    const records = await parseSession(session, taskNames);
    // The fixture has 4 turns but only 3 records: turn-3 repeats turn-2's cumulative
    // totals verbatim, so its delta is all zeros and codex-importer.ts's zero-delta
    // guard (subtractTokenShapes + the totalTokens/inputTokens/outputTokens <= 0 check)
    // drops it entirely. Turn-4's totals are lower than turn-3's (a session-compaction
    // reset), which exercises subtractTokenShapes' "current < previous -> fall back to
    // current" branch instead of a plain subtraction.
    assert.equal(records.length, 3);
    assert.deepEqual(
      records.map((record) => [record.inputTokens, record.cachedInputTokens, record.outputTokens]),
      [
        // turn-1: cumulative 1000/400/200 minus a zero baseline -> the cumulative values themselves.
        [1000, 400, 200],
        // turn-2: cumulative 3000/1500/600 minus turn-1's cumulative 1000/400/200 baseline.
        [2000, 1100, 400],
        // turn-4: cumulative 500/200/100 is LOWER than turn-3's carried-forward baseline
        // (3000/1500/600), so subtractTokenShapes falls back to turn-4's raw cumulative
        // values instead of a negative subtraction (turn-3 itself yields no record, see above).
        [500, 200, 100],
      ],
    );
  });

  it("derives stable ids from session and turn", async () => {
    const records = await parseSession(session, taskNames);
    assert.deepEqual(
      records.map((record) => record.id),
      [
        "codex:11111111-2222-3333-4444-555555555555:turn-1",
        "codex:11111111-2222-3333-4444-555555555555:turn-2",
        "codex:11111111-2222-3333-4444-555555555555:turn-4",
      ],
    );
  });

  it("normalizes provider and carries model/source through the record", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.provider, "openai");
    assert.equal(records[0]?.model, "gpt-5-codex");
    assert.equal(records[0]?.source, "codex-local");
  });

  it("resolves the task name from the session index", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.taskName, "portable-usage-host");
  });

  it("carries reasoning level and mode flags per turn", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.reasoningLevel, "high");
    assert.deepEqual(records[0]?.modeFlags, { ultra: false, fast: false });
    assert.equal(records[1]?.reasoningLevel, "xhigh");
    assert.deepEqual(records[1]?.modeFlags, { ultra: false, fast: true });
  });

  it("applies the latest rate-limit snapshot to subsequent turns", async () => {
    const records = await parseSession(session, taskNames);
    assert.equal(records[0]?.rateLimits?.planType, "plus");
    assert.equal(records[0]?.rateLimits?.primary?.usedPercent, 41.5);
    assert.equal(records[1]?.rateLimits?.secondary?.usedPercent, 78.25);
  });

  it("omits reasoningLevel entirely when the source turn_context has no effort field", async () => {
    const records = await parseSession(noEffortSession, noEffortTaskNames);
    assert.equal(records.length, 1);
    assert.equal("reasoningLevel" in records[0]!, false);
    assert.equal(records[0]?.reasoningLevel, undefined);
  });
});

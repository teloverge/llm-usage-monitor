import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CodexSessionProvider,
  parseSession,
  quotaSnapshotFromRateLimits,
} from "../src/codex-importer.ts";

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
    const { records } = await parseSession(session, taskNames);
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
    const { records } = await parseSession(session, taskNames);
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
    const { records } = await parseSession(session, taskNames);
    assert.equal(records[0]?.provider, "openai");
    assert.equal(records[0]?.model, "gpt-5-codex");
    assert.equal(records[0]?.source, "codex-local");
  });

  it("resolves the task name from the session index", async () => {
    const { records } = await parseSession(session, taskNames);
    assert.equal(records[0]?.taskName, "portable-usage-host");
  });

  it("carries reasoning level and mode flags per turn", async () => {
    const { records } = await parseSession(session, taskNames);
    assert.equal(records[0]?.reasoningLevel, "high");
    assert.deepEqual(records[0]?.modeFlags, { ultra: false, fast: false });
    assert.equal(records[1]?.reasoningLevel, "xhigh");
    assert.deepEqual(records[1]?.modeFlags, { ultra: false, fast: true });
  });

  // Task 14 removed the old version of this, which asserted on a per-record
  // `rateLimits` field that no longer exists. Task 17 restores the coverage in
  // the shape the contract now uses: one file-level observation, not a copy
  // stapled to every turn.
  it("returns the session's rate limits alongside the records", async () => {
    const { rateLimits } = await parseSession(session, taskNames);
    assert.equal(rateLimits?.planType, "plus");
    assert.equal(rateLimits?.primary?.usedPercent, 41.5);
    assert.equal(rateLimits?.secondary?.usedPercent, 78.25);
  });

  it("carries no rate limits when the session never reported any", async () => {
    const { rateLimits } = await parseSession(noEffortSession, noEffortTaskNames);
    assert.equal(rateLimits, null);
  });

  it("no longer staples rate limits onto individual records", async () => {
    const { records } = await parseSession(session, taskNames);
    assert.equal("rateLimits" in records[0]!, false);
  });

  it("omits reasoningLevel entirely when the source turn_context has no effort field", async () => {
    const { records } = await parseSession(noEffortSession, noEffortTaskNames);
    assert.equal(records.length, 1);
    assert.equal("reasoningLevel" in records[0]!, false);
    assert.equal(records[0]?.reasoningLevel, undefined);
  });
});

describe("Codex quota conversion", () => {
  const limits = {
    limitId: "plus-1",
    limitName: "Plus",
    planType: "plus",
    rateLimitReachedType: "none",
    primary: { usedPercent: 41.5, windowMinutes: 300, resetsAt: 1784950000 },
    secondary: { usedPercent: 78.25, windowMinutes: 10080, resetsAt: 1785300000 },
    credits: null,
    individualLimit: null,
  };

  it("converts Codex windows into named quota windows", () => {
    const snapshot = quotaSnapshotFromRateLimits(limits, "host:a", "2026-07-20T09:00:30.000Z");
    assert.equal(snapshot?.usageSourceId, "codex-local");
    assert.equal(snapshot?.plan, "plus");
    assert.deepEqual(
      snapshot?.windows.map((window) => [window.id, window.label, window.usedPercent]),
      [
        ["primary", "5-hour window", 41.5],
        ["secondary", "Weekly window", 78.25],
      ],
    );
  });

  it("converts epoch reset seconds into an ISO timestamp", () => {
    const snapshot = quotaSnapshotFromRateLimits(limits, "host:a", "2026-07-20T09:00:30.000Z");
    assert.equal(snapshot?.windows[0]?.resetsAt, new Date(1784950000 * 1000).toISOString());
  });

  it("omits a window the source did not report", () => {
    const snapshot = quotaSnapshotFromRateLimits(
      { ...limits, secondary: null },
      "host:a",
      "2026-07-20T09:00:30.000Z",
    );
    assert.equal(snapshot?.windows.length, 1);
  });

  it("returns null when there are no rate limits at all", () => {
    assert.equal(quotaSnapshotFromRateLimits(null, "host:a", "2026-07-20T09:00:30.000Z"), null);
  });

  // The two assertions above pass whether the label is derived from
  // windowMinutes or hardcoded per slot, because Codex's current windows happen
  // to be 300 and 10080 minutes. These pin the derivation: a plan whose primary
  // window is not five hours must not be told it is.
  it("labels a window from its reported length, not its slot name", () => {
    const snapshot = quotaSnapshotFromRateLimits(
      {
        ...limits,
        primary: { usedPercent: 12, windowMinutes: 180, resetsAt: 1784950000 },
        secondary: { usedPercent: 30, windowMinutes: 1440, resetsAt: 1785300000 },
      },
      "host:a",
      "2026-07-20T09:00:30.000Z",
    );
    assert.deepEqual(
      snapshot?.windows.map((window) => window.label),
      ["3-hour window", "Daily window"],
    );
  });

  it("falls back to the slot label when the source reports no window length", () => {
    const snapshot = quotaSnapshotFromRateLimits(
      {
        ...limits,
        primary: { usedPercent: 12, windowMinutes: 0, resetsAt: 0 },
        secondary: null,
      },
      "host:a",
      "2026-07-20T09:00:30.000Z",
    );
    assert.equal(snapshot?.windows[0]?.label, "5-hour window");
    // resetsAt 0 is "not reported", not the Unix epoch — omitted, never rendered
    // as a reset in January 1970.
    assert.equal(snapshot?.windows[0]?.resetsAt, undefined);
  });
});

/**
 * Added during execution. The plan tested `quotaSnapshotFromRateLimits` (pure)
 * and `parseSession` (one file), but nothing covered the part of Task 17 that
 * actually decides what gets stored: the cross-file newest-wins tracking in
 * `collect` and its cached path. The fixture directory doubles as a Codex home,
 * so this runs against it read-only.
 */
describe("Codex import quota snapshots", () => {
  const codexHome = fixtures;

  it("converts the newest session rate limits it sees into a single snapshot", async () => {
    const result = await new CodexSessionProvider().collect("host:a", codexHome, {});
    assert.equal(result.quotaSnapshots.length, 1);
    const [snapshot] = result.quotaSnapshots;
    assert.equal(snapshot?.usageSourceId, "codex-local");
    assert.equal(snapshot?.sourceHostId, "host:a");
    assert.equal(snapshot?.plan, "plus");
    assert.deepEqual(
      snapshot?.windows.map((window) => [window.label, window.usedPercent]),
      [
        ["5-hour window", 41.5],
        ["Weekly window", 78.25],
      ],
    );
  });

  // The 07-21 fixture is NEWER than the 07-20 one and reports no rate limits.
  // A file with no quota evidence must be skipped, not treated as evidence that
  // the quota is now unknown — otherwise one ordinary session with limits
  // missing would erase a perfectly good reading.
  it("observes the snapshot at the newest turn that actually reported limits", async () => {
    const result = await new CodexSessionProvider().collect("host:a", codexHome, {});
    assert.equal(result.quotaSnapshots[0]?.observedAt, "2026-07-20T09:15:30.000Z");
  });

  // `collect` walks `sessions` and THEN `archived_sessions`, each sorted on its
  // own, so the archived fixture — the oldest session present — is the last one
  // iterated. Under plain last-one-wins its stale `pro` reading would replace the
  // live `plus` one, and the cockpit would show a months-old quota as current.
  it("does not let an older archived session overwrite a newer reading", async () => {
    const result = await new CodexSessionProvider().collect("host:a", codexHome, {});
    assert.equal(result.quotaSnapshots.length, 1);
    assert.equal(result.quotaSnapshots[0]?.plan, "plus");
    assert.equal(result.quotaSnapshots[0]?.observedAt, "2026-07-20T09:15:30.000Z");
    assert.equal(result.quotaSnapshots[0]?.windows[0]?.usedPercent, 41.5);
  });

  // The cached path skips parseSession entirely, so rate limits have to survive
  // in the per-file import state. Without that, a run where nothing changed
  // reports no quota at all — and since nothing changes most of the time, that
  // is the common case, not the edge case.
  it("keeps the snapshot when every file is served from cache", async () => {
    const provider = new CodexSessionProvider();
    const first = await provider.collect("host:a", codexHome, {});
    const second = await provider.collect("host:a", codexHome, first.state);
    assert.equal(second.stats.parsedFiles, 0, "expected the second run to be fully cached");
    assert.deepEqual(second.quotaSnapshots, first.quotaSnapshots);
  });

  it("reports no snapshot when the home has no sessions at all", async () => {
    const result = await new CodexSessionProvider().collect(
      "host:a",
      join(fixtures, "does-not-exist"),
      {},
    );
    assert.deepEqual(result.quotaSnapshots, []);
    assert.deepEqual(result.records, []);
  });
});

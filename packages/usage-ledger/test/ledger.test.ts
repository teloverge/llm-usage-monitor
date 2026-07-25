import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { UsageLedger } from "../src/index.ts";

const ledgers: UsageLedger[] = [];
afterEach(() => {
  for (const ledger of ledgers.splice(0)) ledger.close();
});
const create = () => {
  const ledger = new UsageLedger();
  ledgers.push(ledger);
  return ledger;
};
const usage = (id: string): UsageRecord => ({
  id,
  sourceHostId: "host:a",
  timestamp: "2026-07-23T12:00:00.000Z",
  taskName: "Task",
  provider: "openai",
  model: "gpt",
  reasoningLevel: "high",
  modeFlags: { ultra: false, fast: false },
  inputTokens: 1,
  cachedInputTokens: 0,
  outputTokens: 1,
  reasoningOutputTokens: 0,
  totalTokens: 2,
  lastTokenUsage: null,
  modelContextWindowTokens: 0,
  rateLimits: null,
  source: "test",
});

describe("Usage Ledger", () => {
  it("commits idempotent records for a Source Host", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-07-23T12:00:00.000Z",
        lastSeenAt: "2026-07-23T12:00:00.000Z",
      },
      [],
    );
    ledger.upsertRecords([usage("record:1"), usage("record:1")]);
    assert.equal(ledger.records().length, 1);
  });
  it("retains effective-dated Host Group memberships", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-23T12:00:00.000Z",
      },
      [],
    );
    ledger.setHostGroup("group:one", "Primary", ["host:a"], "2026-01-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Primary", [], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.memberships(), [
      {
        hostGroupId: "group:one",
        sourceHostId: "host:a",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-07-01T00:00:00.000Z",
      },
    ]);
  });
});

describe("Ledger import idempotency", () => {
  const sample = (id: string, sourceHostId = "host:a"): UsageRecord => ({
    id,
    sourceHostId,
    timestamp: "2026-07-20T09:00:00.000Z",
    taskName: "portable-usage-host",
    provider: "openai",
    model: "gpt-5-codex",
    reasoningLevel: "high",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 200,
    reasoningOutputTokens: 100,
    totalTokens: 1200,
    lastTokenUsage: null,
    modelContextWindowTokens: 400_000,
    rateLimits: null,
    source: "codex-local",
  });

  it("re-importing the same records does not duplicate them", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], { v: 1 });
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], { v: 2 });
    assert.equal(ledger.records().length, 2);
    assert.deepEqual(
      ledger.records().find((record) => record.id === "a"),
      sample("a"),
    );
    assert.deepEqual(ledger.importState("codex-local"), { v: 2 });
  });

  // CURRENT LIMITATION, not a requirement: commitProviderImport never removes
  // records that are absent from a later import. There is no reconciliation
  // yet, so stale records survive indefinitely. A later slice will add
  // reconciliation and deliberately change this to remove absent records —
  // when that happens, this test should be updated/removed, not treated as a
  // regression to "fix" back to the old behavior.
  it("records absent from a later import are retained, not removed (current limitation, no reconciliation yet)", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.commitProviderImport("codex-local", [sample("a"), sample("b")], {});
    ledger.commitProviderImport("codex-local", [sample("a")], {});
    assert.equal(ledger.records().length, 2);
  });

  // CURRENT BEHAVIOR, not a requirement: commitProviderImport's upsert sets
  // source_host_id=excluded.source_host_id on conflict, so re-importing the
  // same record id under a different sourceHostId silently reassigns
  // ownership rather than rejecting it or keeping the original host. This is
  // arguably wrong — Slice 7's atomic source-ownership work is expected to
  // deliberately change this — but it is what the ledger does today, so it
  // is pinned here rather than left to be "discovered" mid-refactor.
  it("re-importing a record id under a different sourceHostId silently reassigns ownership (current behavior, expected to change with atomic source ownership)", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation-a",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.upsertSourceHost(
      {
        id: "host:b",
        hostname: "workstation-b",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-20T09:00:00.000Z",
      },
      [],
    );
    ledger.commitProviderImport("codex-local", [sample("a", "host:a")], {});
    ledger.commitProviderImport("codex-local", [sample("a", "host:b")], {});
    assert.equal(ledger.records().length, 1);
    assert.equal(ledger.records().find((record) => record.id === "a")?.sourceHostId, "host:b");
  });
});

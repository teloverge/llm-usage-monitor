import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { CredentialSighting, UsageRecord } from "@llm-usage-monitor/contracts";
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
  usageSourceId: "test-local",
  harnessId: "test",
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

  it("reads back Host Group names, ordered by name", () => {
    const ledger = create();
    ledger.setHostGroup("group:two", "Workstations", [], "2026-07-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Laptops", [], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.hostGroups(), [
      { id: "group:one", name: "Laptops" },
      { id: "group:two", name: "Workstations" },
    ]);
  });

  it("renaming a group keeps its id and its memberships", () => {
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
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-01-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Portables", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.hostGroups(), [{ id: "group:one", name: "Portables" }]);
    assert.equal(
      ledger.memberships().filter((membership) => membership.effectiveTo === null).length,
      1,
    );
  });

  it("moving a host into another group closes its previous membership", () => {
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
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-01-01T00:00:00.000Z");
    ledger.setHostGroup("group:two", "Workstations", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.memberships(), [
      {
        hostGroupId: "group:one",
        sourceHostId: "host:a",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-07-01T00:00:00.000Z",
      },
      {
        hostGroupId: "group:two",
        sourceHostId: "host:a",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ]);
  });

  // Two saves landing in the same millisecond collide on the membership primary
  // key (group, host, effective_from). The close-then-insert would otherwise
  // leave the row closed and silently drop the membership the user just saved.
  it("re-saving an unchanged group at the same instant keeps the membership open", () => {
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
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-07-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.memberships(), [
      {
        hostGroupId: "group:one",
        sourceHostId: "host:a",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ]);
  });
});

describe("Ledger import idempotency", () => {
  const sample = (id: string, sourceHostId = "host:a"): UsageRecord => ({
    id,
    sourceHostId,
    usageSourceId: "codex-local",
    harnessId: "codex",
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

describe("Quota snapshot storage", () => {
  const snapshot = (observedAt: string, usedPercent: number) => ({
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    plan: "plus",
    observedAt,
    windows: [{ id: "primary", label: "5-hour window", usedPercent }],
  });

  it("keeps only the latest snapshot per source and host", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T10:00:00.000Z", 41.5)]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.windows[0]?.usedPercent, 41.5);
  });

  it("does not let an older observation overwrite a newer one", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T10:00:00.000Z", 41.5)]);
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.observedAt, "2026-07-20T10:00:00.000Z");
    assert.equal(stored[0]?.windows[0]?.usedPercent, 41.5);
  });

  it("keeps snapshots from different sources side by side", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([
      snapshot("2026-07-20T09:00:00.000Z", 10),
      { ...snapshot("2026-07-20T09:00:00.000Z", 88), usageSourceId: "claude-code-local" },
    ]);
    assert.equal(ledger.quotaSnapshots().length, 2);
  });

  // The source half of the key is covered above. This is the host half: one
  // person running the same harness on a laptop and a workstation has two
  // independent quota readings, and collapsing them would show whichever
  // machine imported last as if it were the whole account.
  it("keeps snapshots for the same source on different hosts side by side", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([
      snapshot("2026-07-20T09:00:00.000Z", 10),
      { ...snapshot("2026-07-20T09:00:00.000Z", 88), sourceHostId: "host:b" },
    ]);
    const stored = ledger.quotaSnapshots();
    assert.equal(stored.length, 2);
    assert.deepEqual(stored.map((entry) => entry.sourceHostId).sort(), ["host:a", "host:b"]);
  });

  it("clears snapshots along with records", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([snapshot("2026-07-20T09:00:00.000Z", 10)]);
    ledger.clearRecords();
    assert.equal(ledger.quotaSnapshots().length, 0);
  });
});

describe("Ledger legacy migration", () => {
  it("reads a pre-identity record and upgrades it on the way out", () => {
    const ledger = create();
    ledger.database
      .prepare(
        "INSERT INTO usage_records (id, source_host_id, recorded_at, payload) VALUES (?, ?, ?, ?)",
      )
      .run(
        "codex:old:turn-1",
        "host:a",
        "2026-07-20T09:00:00.000Z",
        JSON.stringify({
          id: "codex:old:turn-1",
          sourceHostId: "host:a",
          timestamp: "2026-07-20T09:00:00.000Z",
          taskName: "legacy task",
          provider: "openai",
          model: "gpt-5-codex",
          reasoningLevel: "unknown",
          modeFlags: { ultra: false, fast: false },
          inputTokens: 10,
          cachedInputTokens: 4,
          outputTokens: 2,
          reasoningOutputTokens: 1,
          totalTokens: 12,
          lastTokenUsage: null,
          modelContextWindowTokens: 400000,
          rateLimits: { limitId: "x", limitName: "", planType: "plus" },
          source: "codex-local",
        }),
      );
    const [record] = ledger.records();
    assert.equal(record?.usageSourceId, "codex-local");
    assert.equal(record?.harnessId, "codex");
    assert.equal(record?.reasoningLevel, undefined);
  });
});

describe("Credential observations", () => {
  const sighting = (over: Partial<CredentialSighting> = {}): CredentialSighting => ({
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    mode: "subscription",
    fingerprint: "9a1b2c3d4e5f",
    inferred: false,
    observedAt: "2026-07-20T10:00:00.000Z",
    ...over,
  });

  it("dates a first sighting from when it was seen", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    const [observation] = store.credentialObservations();
    assert.equal(observation?.effectiveFrom, "2026-07-20T10:00:00.000Z");
    assert.equal(observation?.mode, "subscription");
  });

  it("does not open a new row when the same credential is seen again", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));

    // auth.json is rewritten on every token refresh. A row per sighting would
    // march effectiveFrom forward daily, leave no observation preceding any
    // record, and strand every record in the unattributed bucket forever.
    assert.equal(store.credentialObservations().length, 1);
    assert.equal(store.credentialObservations()[0]?.effectiveFrom, "2026-07-20T10:00:00.000Z");
    assert.equal(store.credentialObservations()[0]?.observedAt, "2026-07-25T10:00:00.000Z");
  });

  it("does not move the latest confirmation backwards", () => {
    const store = create();
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-20T10:00:00.000Z" }));
    assert.equal(store.credentialObservations()[0]?.observedAt, "2026-07-25T10:00:00.000Z");
  });

  it("opens a new row when the mode changes, keeping the old one", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(
      sighting({ mode: "api-key", observedAt: "2026-07-25T10:00:00.000Z" }),
    );
    assert.deepEqual(
      store
        .credentialObservations()
        .map((observation) => [observation.mode, observation.effectiveFrom]),
      [
        ["subscription", "2026-07-20T10:00:00.000Z"],
        ["api-key", "2026-07-25T10:00:00.000Z"],
      ],
    );
  });

  it("opens a new row when the account changes", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(
      sighting({ fingerprint: "0f1e2d3c4b5a", observedAt: "2026-07-25T10:00:00.000Z" }),
    );
    assert.equal(store.credentialObservations().length, 2);
  });

  it("keeps each usage source and host independent", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(sighting({ usageSourceId: "claude-code-local" }));
    store.recordCredentialObservation(sighting({ sourceHostId: "host:b" }));
    assert.equal(store.credentialObservations().length, 3);
  });

  it("returns observations oldest first", () => {
    const store = create();
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));
    store.recordCredentialObservation(
      sighting({ mode: "api-key", observedAt: "2026-07-20T10:00:00.000Z" }),
    );
    assert.deepEqual(
      store.credentialObservations().map((observation) => observation.effectiveFrom),
      ["2026-07-20T10:00:00.000Z", "2026-07-25T10:00:00.000Z"],
    );
  });

  it("survives clearing records", () => {
    const store = create();
    store.recordCredentialObservation(sighting());
    store.clearRecords();

    // A first-seen date cannot be recovered once lost: re-observing tomorrow
    // dates the credential to tomorrow and unattributes everything before it.
    // Clearing USAGE must not destroy an observation about the machine.
    assert.equal(store.credentialObservations().length, 1);
  });

  it("keeps the optional plan and the inferred flag", () => {
    const store = create();
    store.recordCredentialObservation(sighting({ plan: "claude_max_20x", inferred: true }));
    assert.equal(store.credentialObservations()[0]?.plan, "claude_max_20x");
    assert.equal(store.credentialObservations()[0]?.inferred, true);
  });
});

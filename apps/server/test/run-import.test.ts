import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageQuotaSnapshot, UsageRecord } from "@llm-usage-monitor/contracts";
import { UsageLedger } from "@llm-usage-monitor/usage-ledger";
import { runProviderImport } from "../src/run-import.ts";

const usage = (id: string): UsageRecord => ({
  id,
  sourceHostId: "host:a",
  usageSourceId: "fake-local",
  harnessId: "fake",
  timestamp: "2026-07-26T12:00:00.000Z",
  taskName: "Task",
  provider: "anthropic",
  model: "claude",
  modeFlags: { ultra: false, fast: false },
  inputTokens: 10,
  cachedInputTokens: 0,
  outputTokens: 5,
  totalTokens: 15,
  lastTokenUsage: null,
  source: "fake-local",
});

const goodSnapshot: UsageQuotaSnapshot = {
  usageSourceId: "fake-local",
  sourceHostId: "host:a",
  observedAt: "2026-07-26T22:37:38.317Z",
  windows: [{ id: "session", label: "5-hour window", usedPercent: 6 }],
};

/**
 * A snapshot whose `resetsAt` carries a UTC offset. `usageQuotaSnapshotSchema`
 * uses Zod's `.datetime()`, which rejects offsets outright, so the real ledger
 * really throws on this — no mock stands in for the failure.
 */
const rejectedSnapshot = {
  ...goodSnapshot,
  windows: [{ id: "session", label: "5-hour window", resetsAt: "2026-07-27T03:10:00+00:00" }],
} as UsageQuotaSnapshot;

const provider = (quotaSnapshots: UsageQuotaSnapshot[], records = [usage("record-1")]) => ({
  id: "fake-local",
  collect: async () => ({ records, quotaSnapshots, state: { scanned: true } }),
});

describe("runProviderImport", () => {
  it("commits records even when the quota snapshot is rejected", async () => {
    const ledger = new UsageLedger();
    try {
      const committed = await runProviderImport(
        provider([rejectedSnapshot]),
        ledger,
        "host:a",
        undefined,
        () => {},
      );

      // Quota is supplementary to records. Before this, the strict-schema throw
      // happened before any record was written, so one malformed quota field
      // discarded a whole run's usage.
      assert.equal(committed, 1);
      assert.equal(ledger.records().length, 1);
    } finally {
      ledger.close();
    }
  });

  it("advances import state even when the quota snapshot is rejected", async () => {
    const ledger = new UsageLedger();
    try {
      await runProviderImport(provider([rejectedSnapshot]), ledger, "host:a", undefined, () => {});

      // The sharper half of the bug: import state advances only inside
      // `commitProviderImport`, so a bad value that persists in the source file
      // blocked every future import too, not merely the run that met it.
      assert.deepEqual(ledger.importState("fake-local"), { scanned: true });
    } finally {
      ledger.close();
    }
  });

  it("reports the rejected snapshot rather than swallowing it", async () => {
    const ledger = new UsageLedger();
    const rejections: string[] = [];
    try {
      await runProviderImport(provider([rejectedSnapshot]), ledger, "host:a", undefined, (id) =>
        rejections.push(id),
      );

      assert.deepEqual(rejections, ["fake-local"]);
    } finally {
      ledger.close();
    }
  });

  it("stores an acceptable snapshot alongside the records", async () => {
    const ledger = new UsageLedger();
    try {
      const committed = await runProviderImport(
        provider([goodSnapshot]),
        ledger,
        "host:a",
        undefined,
        () => {},
      );

      assert.equal(committed, 1);
      assert.equal(ledger.quotaSnapshots().length, 1);
      assert.equal(ledger.quotaSnapshots()[0]?.windows[0]?.usedPercent, 6);
    } finally {
      ledger.close();
    }
  });

  it("passes the host and configured home through to the provider", async () => {
    const ledger = new UsageLedger();
    const seen: Array<[string, string | undefined, unknown]> = [];
    try {
      await runProviderImport(
        {
          id: "fake-local",
          collect: async (sourceHostId: string, home: string | undefined, previous: unknown) => {
            seen.push([sourceHostId, home, previous]);
            return { records: [], quotaSnapshots: [], state: {} };
          },
        },
        ledger,
        "host:b",
        "/configured/home",
        () => {},
      );

      assert.deepEqual(seen, [["host:b", "/configured/home", {}]]);
    } finally {
      ledger.close();
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeUsage } from "@llm-usage-monitor/usage-analysis";
import { UsageLedger } from "@llm-usage-monitor/usage-ledger";
import { CodexSessionProvider } from "../src/codex-importer.ts";

/**
 * Slice 3 splits quota handling across three packages: the importer produces a
 * snapshot (Task 17), the ledger validates and stores it (Task 16), and analysis
 * serves it (Task 18). Each half is unit-tested in its own package, but nothing
 * exercises the seams, and the seams are where this can fail silently:
 *
 * `replaceQuotaSnapshots` parses through `usageQuotaSnapshotSchema`, which is
 * `.strict()`. If the converter ever emits a field the contract does not declare
 * — an extra window property, a renamed key — every unit test still passes and
 * the failure appears only when a real import runs, as a thrown parse error on
 * the user's Refresh-sources button.
 */
const codexHome = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));

describe("Quota snapshot round trip", () => {
  it("carries an imported snapshot through the ledger into the overview", async () => {
    const ledger = new UsageLedger();
    try {
      const imported = await new CodexSessionProvider().collect("host:a", codexHome, {});
      assert.equal(imported.quotaSnapshots.length, 1, "fixture should yield one snapshot");

      // The strict-schema boundary. Throws here if the converter and the
      // contract have drifted.
      ledger.replaceQuotaSnapshots(imported.quotaSnapshots);

      const view = analyzeUsage({
        records: [],
        prices: [],
        memberships: [],
        quotaSnapshots: ledger.quotaSnapshots(),
        filters: { timeframe: "all" },
      });

      assert.deepEqual(view.quotaSnapshots, imported.quotaSnapshots);
      assert.equal(view.quotaSnapshots[0]?.plan, "plus");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.label, "5-hour window");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.usedPercent, 41.5);
    } finally {
      ledger.close();
    }
  });
});

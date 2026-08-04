import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeUsage } from "@llm-usage-monitor/usage-analysis";
import { UsageLedger } from "@llm-usage-monitor/usage-ledger";
import { ClaudeSessionProvider } from "../src/claude-importer.ts";
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
        now: new Date("2026-07-20T00:00:00.000Z"),
      });

      // The analysis enriches, never rewrites: the stored snapshot comes back
      // byte-for-byte with only the derived `active` marking added.
      assert.deepEqual(
        view.quotaSnapshots,
        imported.quotaSnapshots.map((snapshot) => ({ ...snapshot, active: true })),
      );
      assert.equal(view.quotaSnapshots[0]?.plan, "plus");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.label, "5-hour window");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.usedPercent, 41.5);
    } finally {
      ledger.close();
    }
  });
});

describe("Claude quota round trip", () => {
  it("carries the config cache through the ledger into the overview", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "lum-claude-rt-"));
    const ledger = new UsageLedger();
    try {
      await fs.writeFile(
        join(directory, ".claude.json"),
        JSON.stringify({
          oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" },
          cachedUsageUtilization: {
            fetchedAtMs: 1785105458317,
            utilization: {
              five_hour: { utilization: 2, resets_at: "2026-07-27T03:10:00.127734+00:00" },
              seven_day: { utilization: 6, resets_at: "2026-07-31T22:00:00.127758+00:00" },
              limits: [
                { kind: "session", percent: 2, resets_at: "2026-07-27T03:10:00.127734+00:00" },
                { kind: "weekly_all", percent: 6, resets_at: "2026-07-31T22:00:00.127758+00:00" },
              ],
            },
          },
        }),
        "utf8",
      );

      // No `projects` directory: this asserts quota is read even when the
      // transcript walk finds nothing, which is the state of a fresh install.
      const imported = await new ClaudeSessionProvider().collect(
        "host:a",
        join(directory, ".claude"),
        {},
      );
      assert.equal(imported.records.length, 0);
      assert.equal(imported.quotaSnapshots.length, 1);

      // The strict-schema boundary. Throws here if the mapper emits a field
      // the contract does not declare, or an offset timestamp.
      ledger.replaceQuotaSnapshots(imported.quotaSnapshots);

      const view = analyzeUsage({
        records: [],
        prices: [],
        memberships: [],
        quotaSnapshots: ledger.quotaSnapshots(),
        filters: { timeframe: "all" },
        // After the cache was fetched, before either window resets.
        now: new Date("2026-07-27T00:00:00.000Z"),
      });

      assert.equal(view.quotaSnapshots[0]?.usageSourceId, "claude-code-local");
      assert.equal(view.quotaSnapshots[0]?.plan, "claude_max_20x");
      assert.equal(view.quotaSnapshots[0]?.observedAt, "2026-07-26T22:37:38.317Z");
      assert.equal(view.quotaSnapshots[0]?.windows[0]?.label, "5-hour window");
      assert.equal(view.quotaSnapshots[0]?.windows[1]?.usedPercent, 6);
    } finally {
      ledger.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("survives a config whose fetchedAtMs is out of range instead of discarding the run", async () => {
    // A plausible ms->us unit reshape of `fetchedAtMs`. Before the fix, `instant()`
    // let the expanded-year ISO string escape, `usageQuotaSnapshotSchema`'s
    // `.datetime()` rejected it, and `replaceQuotaSnapshots` threw here — which,
    // in `server.ts`, happens BEFORE `commitProviderImport` and so would have
    // discarded every transcript record this run collected. The fix must make
    // this call return no snapshot and not throw.
    const directory = await fs.mkdtemp(join(tmpdir(), "lum-claude-rt-oor-"));
    const ledger = new UsageLedger();
    try {
      await fs.writeFile(
        join(directory, ".claude.json"),
        JSON.stringify({
          oauthAccount: { organizationRateLimitTier: "default_claude_max_20x" },
          cachedUsageUtilization: {
            fetchedAtMs: 1785105458317000,
            utilization: {
              limits: [{ kind: "session", percent: 2 }],
            },
          },
        }),
        "utf8",
      );

      const imported = await new ClaudeSessionProvider().collect(
        "host:a",
        join(directory, ".claude"),
        {},
      );
      assert.equal(imported.quotaSnapshots.length, 0);

      // The assertion that matters: this must not throw.
      assert.doesNotThrow(() => ledger.replaceQuotaSnapshots(imported.quotaSnapshots));
    } finally {
      ledger.close();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

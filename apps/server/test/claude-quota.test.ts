import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { claudeQuotaSnapshot, readClaudeConfig } from "../src/claude-quota.ts";

const scratch: string[] = [];
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-claude-"));
  scratch.push(dir);
  return dir;
}
after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

describe("readClaudeConfig", () => {
  it("finds the config beside the default home directory", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    // The importer's `home` is `<dir>/.claude`; the config is its sibling.
    assert.deepEqual(await readClaudeConfig(join(dir, ".claude")), { marker: "sibling" });
  });

  it("finds the config inside a configured home directory", async () => {
    const dir = await temp();
    const home = join(dir, "cfg");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), '{"marker":"inside"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "inside" });
  });

  it("returns null when no config exists", async () => {
    const dir = await temp();
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("falls through to the sibling when the inner config is malformed", async () => {
    const dir = await temp();
    const home = join(dir, ".claude");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), "{ not json", "utf8");
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "sibling" });
  });

  it("returns null for malformed JSON with nothing to fall through to", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "{ not json", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("skips a file larger than the size guard", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude"), 4), null);
  });

  it("rejects a top-level array", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "[1,2,3]", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });
});

const FIVE_HOUR_RESET = "2026-07-27T03:10:00.127734+00:00";
const SEVEN_DAY_RESET = "2026-07-31T22:00:00.127758+00:00";

/**
 * Overrides replace keys INSIDE `utilization`. Spreading them at the
 * `cachedUsageUtilization` level instead would let an `{ utilization: … }`
 * override silently replace the whole block rather than merge into it.
 */
function config(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    oauthAccount: {
      emailAddress: "someone@example.com",
      organizationType: "claude_max",
      organizationRateLimitTier: "default_claude_max_20x",
    },
    cachedUsageUtilization: {
      fetchedAtMs: 1785105458317,
      accountUuid: "937ec57b-57ff-4293-abce-493df76661c8",
      utilization: {
        five_hour: { utilization: 2, resets_at: FIVE_HOUR_RESET },
        seven_day: { utilization: 6, resets_at: SEVEN_DAY_RESET },
        tangelo: null,
        iguana_necktie: null,
        limits: [
          { kind: "session", group: "session", percent: 2, severity: "normal",
            resets_at: FIVE_HOUR_RESET, scope: null, is_active: false },
          { kind: "weekly_all", group: "weekly", percent: 6, severity: "normal",
            resets_at: SEVEN_DAY_RESET, scope: null, is_active: true },
          { kind: "weekly_scoped", group: "weekly", percent: 0, severity: "normal",
            resets_at: null, scope: { model: { id: null, display_name: "Fable" } },
            is_active: false },
        ],
        ...overrides,
      },
    },
  };
}

describe("claudeQuotaSnapshot", () => {
  it("maps the observed cache into a snapshot", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    assert.ok(snapshot);
    assert.equal(snapshot.usageSourceId, "claude-code-local");
    assert.equal(snapshot.sourceHostId, "host:a");
    assert.equal(snapshot.observedAt, "2026-07-26T22:37:38.317Z");
    assert.equal(snapshot.plan, "claude_max_20x");
    assert.equal(snapshot.windows.length, 3);
  });

  it("normalizes an offset timestamp to the instant the contract accepts", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    // Zod's .datetime() rejects "+00:00" outright. A passthrough value would
    // pass every mapper test and throw at the ledger.
    assert.equal(snapshot?.windows[0]?.resetsAt, "2026-07-27T03:10:00.127Z");
    assert.match(String(snapshot?.windows[0]?.resetsAt), /Z$/);
  });

  it("establishes window length by cross-reference, never by assumption", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    assert.equal(snapshot?.windows[0]?.windowMinutes, 300);
    assert.equal(snapshot?.windows[0]?.label, "5-hour window");
    assert.equal(snapshot?.windows[1]?.windowMinutes, 10_080);
    assert.equal(snapshot?.windows[1]?.label, "Weekly window");
  });

  it("omits the length when nothing corroborates it", () => {
    const snapshot = claudeQuotaSnapshot(config(), "host:a");
    const scoped = snapshot?.windows[2];
    assert.equal(scoped?.windowMinutes, undefined);
    assert.equal(scoped?.resetsAt, undefined);
    assert.equal(scoped?.label, "Weekly window · Fable");
  });

  it("gives scoped windows distinct ids so two models are two meters", () => {
    const snapshot = claudeQuotaSnapshot(
      config({
        limits: [
          { kind: "weekly_scoped", percent: 1, scope: { model: { display_name: "Fable" } } },
          { kind: "weekly_scoped", percent: 2, scope: { model: { display_name: "Opus 5" } } },
        ],
      }),
      "host:a",
    );
    assert.deepEqual(
      snapshot?.windows.map((window) => window.id),
      ["weekly_scoped:fable", "weekly_scoped:opus-5"],
    );
    assert.equal(new Set(snapshot?.windows.map((w) => w.id)).size, 2);
  });

  it("keeps an unrecognised kind rather than dropping it", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [{ kind: "monthly_all", percent: 12 }] }),
      "host:a",
    );
    assert.equal(snapshot?.windows.length, 1);
    assert.equal(snapshot?.windows[0]?.id, "monthly_all");
    assert.equal(snapshot?.windows[0]?.label, "Monthly all");
    assert.equal(snapshot?.windows[0]?.usedPercent, 12);
  });

  it("omits an unreported percentage instead of calling it zero", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [{ kind: "session", percent: null }] }),
      "host:a",
    );
    assert.equal(snapshot?.windows[0]?.usedPercent, undefined);
    assert.ok(!("usedPercent" in (snapshot?.windows[0] ?? {})));
  });

  it("falls back to the organization type when no tier is stated", () => {
    const snapshot = claudeQuotaSnapshot(
      { ...config(), oauthAccount: { organizationType: "claude_max" } },
      "host:a",
    );
    assert.equal(snapshot?.plan, "claude_max");
  });

  it("caps windows at the contract's limit", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      kind: `kind_${index}`,
      percent: 1,
    }));
    const snapshot = claudeQuotaSnapshot(config({ limits: many }), "host:a");
    assert.equal(snapshot?.windows.length, 50);
  });

  it("returns null when the cache is absent, empty, or undated", () => {
    assert.equal(claudeQuotaSnapshot({}, "host:a"), null);
    assert.equal(claudeQuotaSnapshot(null, "host:a"), null);
    assert.equal(claudeQuotaSnapshot({ cachedUsageUtilization: {} }, "host:a"), null);
    assert.equal(
      claudeQuotaSnapshot({ cachedUsageUtilization: { utilization: {} } }, "host:a"),
      null,
    );
  });

  it("emits a snapshot with no windows when the cache reports no limits", () => {
    const snapshot = claudeQuotaSnapshot(
      config({ limits: [], five_hour: null, seven_day: null }),
      "host:a",
    );
    // "We know this account exists and have nothing current about it" is a
    // different statement from "no such account".
    assert.deepEqual(snapshot?.windows, []);
    assert.equal(snapshot?.plan, "claude_max_20x");
  });

  it("stores no account identifier", () => {
    const serialized = JSON.stringify(claudeQuotaSnapshot(config(), "host:a"));
    assert.ok(!serialized.includes("someone@example.com"));
    assert.ok(!serialized.includes("937ec57b-57ff-4293-abce-493df76661c8"));
  });
});

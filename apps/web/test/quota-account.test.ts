import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation, UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { quotaAccounts } from "../src/model/quota-account.ts";

const snapshot = (over: Partial<UsageQuotaSnapshot> = {}): UsageQuotaSnapshot => ({
  usageSourceId: "codex-local",
  sourceHostId: "host:a",
  plan: "pro",
  observedAt: "2026-08-30T02:00:00.000Z",
  windows: [{ id: "primary", label: "Weekly window", usedPercent: 8 }],
  ...over,
});

const observation = (over: Partial<CredentialObservation> = {}): CredentialObservation => ({
  usageSourceId: "codex-local",
  sourceHostId: "host:a",
  mode: "subscription",
  fingerprint: "9a1b2c3d4e5f",
  inferred: false,
  effectiveFrom: "2026-07-10T00:00:00.000Z",
  observedAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

describe("quotaAccounts", () => {
  /**
   * The case the function exists for: one subscription signed in on two
   * machines produced two identical "Codex · pro" meters.
   */
  it("folds hosts on the same account into one meter, keeping the newest reading", () => {
    const accounts = quotaAccounts(
      [
        snapshot({ sourceHostId: "host:a", observedAt: "2026-08-30T02:00:00.000Z" }),
        snapshot({ sourceHostId: "managed:b", observedAt: "2026-08-30T02:30:00.000Z" }),
      ],
      [observation({ sourceHostId: "host:a" }), observation({ sourceHostId: "managed:b" })],
    );
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]!.snapshot.sourceHostId, "managed:b");
    assert.equal(accounts[0]!.credential?.sourceHostId, "managed:b");
    assert.deepEqual(accounts[0]!.sourceHostIds, ["managed:b", "host:a"]);
  });

  it("keeps two accounts on the same source apart", () => {
    const accounts = quotaAccounts(
      [snapshot({ sourceHostId: "host:a" }), snapshot({ sourceHostId: "managed:b" })],
      [
        observation({ sourceHostId: "host:a" }),
        observation({ sourceHostId: "managed:b", fingerprint: "0f0f0f0f0f0f" }),
      ],
    );
    assert.equal(accounts.length, 2);
  });

  it("keeps the same account apart across usage sources", () => {
    const accounts = quotaAccounts(
      [snapshot(), snapshot({ usageSourceId: "claude-code-local" })],
      [observation(), observation({ usageSourceId: "claude-code-local" })],
    );
    assert.equal(accounts.length, 2);
  });

  /**
   * An empty fingerprint says the source named no account. Two API keys are
   * not one credential just because neither could be identified.
   */
  it("does not fold hosts whose credential names no account", () => {
    const accounts = quotaAccounts(
      [snapshot({ sourceHostId: "host:a" }), snapshot({ sourceHostId: "managed:b" })],
      [
        observation({ sourceHostId: "host:a", mode: "api-key", fingerprint: "" }),
        observation({ sourceHostId: "managed:b", mode: "api-key", fingerprint: "" }),
      ],
    );
    assert.equal(accounts.length, 2);
  });

  it("does not fold a host whose credential was never observed", () => {
    const accounts = quotaAccounts(
      [snapshot({ sourceHostId: "host:a" }), snapshot({ sourceHostId: "managed:b" })],
      [observation({ sourceHostId: "host:a" })],
    );
    assert.equal(accounts.length, 2);
    assert.equal(accounts[1]!.credential, undefined);
  });

  it("follows the credential a host is on now, not one it left", () => {
    const accounts = quotaAccounts(
      [snapshot({ sourceHostId: "host:a" }), snapshot({ sourceHostId: "managed:b" })],
      [
        observation({ sourceHostId: "host:a" }),
        observation({ sourceHostId: "managed:b" }),
        observation({
          sourceHostId: "managed:b",
          fingerprint: "0f0f0f0f0f0f",
          effectiveFrom: "2026-08-01T00:00:00.000Z",
        }),
      ],
    );
    assert.equal(accounts.length, 2);
  });

  it("returns nothing for no snapshots", () => {
    assert.deepEqual(quotaAccounts([], [observation()]), []);
  });
});

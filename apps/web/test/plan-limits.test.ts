import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { cardInferred, planCards } from "../src/model/plan-limits.ts";

const snapshot = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({
  usageSourceId: "claude-code-local",
  sourceHostId: "host:a",
  observedAt: "2026-08-03T10:00:00.000Z",
  windows: [],
  active: true,
  ...over,
});

describe("planCards", () => {
  it("groups the same credential across hosts into one card", () => {
    const cards = planCards([
      snapshot({ credentialId: "subscription:aaaaaaaaaaaa" }),
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        sourceHostId: "host:b",
        observedAt: "2026-08-02T10:00:00.000Z",
      }),
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.snapshots.length, 2);
    assert.equal(cards[0]?.mode, "subscription");
  });

  it("keeps unattributed snapshots on per-source cards, never one shared bucket", () => {
    const cards = planCards([snapshot(), snapshot({ usageSourceId: "codex-local" })]);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.credentialId),
      [null, null],
    );
  });

  it("orders active cards first, then by most recent observation", () => {
    const cards = planCards([
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        active: false,
        observedAt: "2026-07-01T10:00:00.000Z",
      }),
      snapshot({
        credentialId: "subscription:cccccccccccc",
        active: false,
        observedAt: "2026-07-15T10:00:00.000Z",
      }),
      snapshot({ credentialId: "subscription:bbbbbbbbbbbb" }),
    ]);
    assert.deepEqual(
      cards.map((card) => card.credentialId),
      ["subscription:bbbbbbbbbbbb", "subscription:cccccccccccc", "subscription:aaaaaaaaaaaa"],
    );
  });

  it("takes the plan tier from the newest snapshot naming one", () => {
    const cards = planCards([
      snapshot({ credentialId: "subscription:aaaaaaaaaaaa" }),
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        sourceHostId: "host:b",
        observedAt: "2026-08-01T10:00:00.000Z",
        plan: "claude_max_20x",
      }),
    ]);
    assert.equal(cards[0]?.plan, "claude_max_20x");
  });
});

describe("cardInferred", () => {
  const observation = (over: Partial<CredentialObservation> = {}): CredentialObservation => ({
    usageSourceId: "claude-code-local",
    sourceHostId: "host:a",
    mode: "subscription",
    fingerprint: "aaaaaaaaaaaa",
    inferred: true,
    effectiveFrom: "2026-07-10T00:00:00.000Z",
    observedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  });

  it("reports the newest matching observation's inferred flag", () => {
    const [card] = planCards([snapshot({ credentialId: "subscription:aaaaaaaaaaaa" })]);
    assert.equal(cardInferred(card!, [observation()]), true);
    assert.equal(
      cardInferred(card!, [
        observation(),
        observation({ inferred: false, observedAt: "2026-08-01T00:00:00.000Z" }),
      ]),
      false,
    );
  });

  it("is never inferred for an unattributed card", () => {
    const [card] = planCards([snapshot()]);
    assert.equal(cardInferred(card!, [observation()]), false);
  });
});

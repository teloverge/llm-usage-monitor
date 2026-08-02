import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  credentialIdFor,
  credentialObservationSchema,
  credentialSightingSchema,
  dashboardActionSchema,
  filtersSchema,
  timeframeSchema,
  UNATTRIBUTED_CREDENTIAL,
  usageQuotaSnapshotSchema,
  usageRecordSchema,
} from "../src/index.ts";

describe("dashboard contracts", () => {
  it("accepts the rolling last 24 hour timeframe", () =>
    assert.equal(timeframeSchema.parse("last24"), "last24"));
  it("rejects unknown action fields", () =>
    assert.throws(() =>
      dashboardActionSchema.parse({
        version: 1,
        type: "clear-records",
        confirmation: "clear-usage-records",
        surprise: true,
      }),
    ));
  it("defaults legacy Usage Records to no recorded modes", () => {
    const parsed = usageRecordSchema.parse({
      id: "record:1",
      sourceHostId: "host:1",
      usageSourceId: "codex-local",
      harnessId: "codex",
      timestamp: "2026-07-23T12:00:00.000Z",
      taskName: "Task",
      provider: "openai",
      model: "gpt",
      reasoningLevel: "high",
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
      totalTokens: 2,
      lastTokenUsage: null,
      modelContextWindowTokens: 0,
      source: "test",
    });
    assert.deepEqual(parsed.modeFlags, { ultra: false, fast: false });
  });
});

describe("Usage quota snapshots", () => {
  it("accepts a snapshot whose windows omit optional measurements", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "claude-code-local",
      sourceHostId: "host:a",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [{ id: "five-hour", label: "5-hour window" }],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, undefined);
    assert.equal(snapshot.plan, undefined);
  });

  it("accepts a fully populated Codex-shaped snapshot", () => {
    const snapshot = usageQuotaSnapshotSchema.parse({
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      plan: "plus",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [
        {
          id: "primary",
          label: "5-hour window",
          usedPercent: 41.5,
          windowMinutes: 300,
          resetsAt: "2026-07-23T12:06:40.000Z",
        },
      ],
    });
    assert.equal(snapshot.windows[0]?.usedPercent, 41.5);
  });

  // Snapshots round-trip through the ledger as JSON (Task 16), so a field the
  // schema does not know about is silently dropped on the way in rather than
  // surfacing as a bug at the source. Strictness turns that into a parse error.
  it("rejects a snapshot carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
        creditsRemaining: 12,
      }),
    );
  });

  it("rejects a window carrying an unknown field", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [{ id: "primary", label: "5-hour window", resets_at: 1785300000 }],
      }),
    );
  });

  it("rejects a snapshot with no usage source", () => {
    assert.throws(() =>
      usageQuotaSnapshotSchema.parse({
        sourceHostId: "host:a",
        observedAt: "2026-07-23T10:00:00.000Z",
        windows: [],
      }),
    );
  });
});

describe("credential contracts", () => {
  const sighting = {
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    mode: "subscription" as const,
    fingerprint: "9a1b2c3d4e5f",
    inferred: false,
    observedAt: "2026-07-26T22:00:00.000Z",
  };

  it("accepts a sighting a collector can state", () => {
    assert.deepEqual(credentialSightingSchema.parse(sighting), sighting);
  });

  it("refuses a sighting that tries to set its own effective date", () => {
    // The whole point of the split: a collector able to set `effectiveFrom`
    // could backdate attribution, which the spec forbids outright.
    assert.throws(() =>
      credentialSightingSchema.parse({ ...sighting, effectiveFrom: "2020-01-01T00:00:00.000Z" }),
    );
  });

  it("accepts an observation once the ledger has dated it", () => {
    const observation = { ...sighting, effectiveFrom: "2026-07-26T22:00:00.000Z" };
    assert.deepEqual(credentialObservationSchema.parse(observation), observation);
  });

  it("accepts an empty fingerprint for a source that states no account", () => {
    assert.equal(credentialSightingSchema.parse({ ...sighting, fingerprint: "" }).fingerprint, "");
  });

  it("refuses a fingerprint that is not 12 lowercase hex", () => {
    for (const fingerprint of ["9A1B2C3D4E5F", "9a1b2c", "9a1b2c3d4e5fa", "zzzzzzzzzzzz"]) {
      assert.throws(
        () => credentialSightingSchema.parse({ ...sighting, fingerprint }),
        new RegExp(""),
        `should refuse ${fingerprint}`,
      );
    }
  });

  it("refuses a mode outside the known set", () => {
    assert.throws(() => credentialSightingSchema.parse({ ...sighting, mode: "oauth" }));
  });

  it("derives a bucket key that is stable and carries no secret", () => {
    assert.equal(credentialIdFor(sighting), "subscription:9a1b2c3d4e5f");
    assert.equal(credentialIdFor({ mode: "api-key", fingerprint: "" }), "api-key:");
  });

  it("names the unattributed bucket distinctly", () => {
    assert.equal(UNATTRIBUTED_CREDENTIAL, "unattributed");
    assert.notEqual(UNATTRIBUTED_CREDENTIAL, credentialIdFor({ mode: "unknown", fingerprint: "" }));
  });

  it("accepts a credential filter", () => {
    assert.equal(
      filtersSchema.parse({ timeframe: "30", credentialId: "subscription:9a1b2c3d4e5f" })
        .credentialId,
      "subscription:9a1b2c3d4e5f",
    );
  });
});

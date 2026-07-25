import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeUsageRecord } from "../src/legacy.ts";

const legacy = {
  id: "codex:session-a:turn-1",
  sourceHostId: "host:a",
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
};

describe("Legacy Usage Record decoding", () => {
  it("derives usageSourceId and harnessId from the legacy source field", () => {
    const record = decodeUsageRecord(legacy);
    assert.equal(record.usageSourceId, "codex-local");
    assert.equal(record.harnessId, "codex");
  });

  it("maps an unknown reasoning level to unreported rather than a bucket", () => {
    const record = decodeUsageRecord({ ...legacy, reasoningLevel: "unknown" });
    assert.equal(record.reasoningLevel, undefined);
  });

  it("maps an empty reasoning level to unreported", () => {
    const record = decodeUsageRecord({ ...legacy, reasoningLevel: "" });
    assert.equal(record.reasoningLevel, undefined);
  });

  it("preserves a reported reasoning level", () => {
    assert.equal(decodeUsageRecord(legacy).reasoningLevel, "high");
  });

  it("drops embedded rate limits from the canonical record", () => {
    const record = decodeUsageRecord({
      ...legacy,
      rateLimits: { limitId: "x", limitName: "", planType: "plus" },
    });
    assert.ok(!("rateLimits" in record));
  });

  it("leaves an already-migrated record unchanged", () => {
    const migrated = decodeUsageRecord({
      ...legacy,
      usageSourceId: "claude-code-local",
      harnessId: "claude-code",
    });
    assert.equal(migrated.usageSourceId, "claude-code-local");
    assert.equal(migrated.harnessId, "claude-code");
  });

  it("preserves zero cached tokens as source evidence, not as unreported", () => {
    const record = decodeUsageRecord({ ...legacy, cachedInputTokens: 0 });
    assert.equal(record.cachedInputTokens, 0);
  });
});

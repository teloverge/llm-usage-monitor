import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation } from "@llm-usage-monitor/contracts";
import {
  countsAgainstPlan,
  credentialModeKey,
  latestCredential,
  parseCredentialId,
} from "../src/model/credential.ts";

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

describe("latestCredential", () => {
  it("picks the most recent observation for the source and host", () => {
    const found = latestCredential(
      [observation(), observation({ mode: "api-key", effectiveFrom: "2026-07-20T00:00:00.000Z" })],
      "codex-local",
      "host:a",
    );
    assert.equal(found?.mode, "api-key");
  });

  it("does not borrow another source's or host's credential", () => {
    assert.equal(latestCredential([observation()], "claude-code-local", "host:a"), undefined);
    assert.equal(latestCredential([observation()], "codex-local", "host:b"), undefined);
  });

  it("reports nothing when none has been observed", () => {
    assert.equal(latestCredential([], "codex-local", "host:a"), undefined);
  });
});

describe("credentialModeKey", () => {
  it("maps each mode to a translation key segment", () => {
    assert.equal(credentialModeKey("subscription"), "subscription");
    // The mode id has a hyphen; the key must not, so it can be addressed by
    // dotted path in both locale files.
    assert.equal(credentialModeKey("api-key"), "apiKey");
    assert.equal(credentialModeKey("bedrock"), "bedrock");
    assert.equal(credentialModeKey("vertex"), "vertex");
  });

  it("falls back to the unknown key for anything unrecognised", () => {
    assert.equal(credentialModeKey("unknown"), "unknown");
    assert.equal(credentialModeKey("device-code"), "unknown");
  });
});

describe("countsAgainstPlan", () => {
  it("is true only for a subscription", () => {
    assert.equal(countsAgainstPlan("subscription"), true);
    // The distinction the whole feature exists to draw: usage on any of these
    // never touches the plan window shown above the badge.
    for (const mode of ["api-key", "bedrock", "vertex", "unknown"]) {
      assert.equal(countsAgainstPlan(mode), false, mode);
    }
  });
});

describe("parseCredentialId", () => {
  it("splits a bucket key into its mode and fingerprint", () => {
    assert.deepEqual(parseCredentialId("subscription:9a1b2c3d4e5f"), {
      unattributed: false,
      modeKey: "subscription",
      fingerprint: "9a1b2c3d4e5f",
    });
  });

  it("keeps an empty fingerprint empty", () => {
    assert.deepEqual(parseCredentialId("api-key:"), {
      unattributed: false,
      modeKey: "apiKey",
      fingerprint: "",
    });
  });

  it("recognises the unattributed bucket", () => {
    assert.equal(parseCredentialId("unattributed").unattributed, true);
  });
});

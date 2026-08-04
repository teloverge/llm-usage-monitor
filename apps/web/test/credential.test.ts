import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation } from "@llm-usage-monitor/contracts";
import {
  countsAgainstPlan,
  credentialLabel,
  credentialModeKey,
  credentialOptions,
  parseCredentialId,
} from "../src/model/credential.ts";

/**
 * Stands in for i18next: returns the key itself, so a test can assert WHICH key
 * a label is built from without pinning copy that lives in the locale files.
 */
const t = (key: string) => key;

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

describe("credentialLabel", () => {
  it("names a credential by its translated mode and its fingerprint", () => {
    assert.equal(
      credentialLabel("api-key:a1b2c3d4e5f6", t),
      "credential.mode.apiKey · a1b2c3d4e5f6",
    );
  });

  it("drops the separator when the source named no account", () => {
    assert.equal(credentialLabel("api-key:", t), "credential.mode.apiKey");
  });

  it("names the unattributed bucket without a fingerprint", () => {
    assert.equal(credentialLabel("unattributed", t), "credential.unattributed");
  });
});

describe("credentialOptions", () => {
  /**
   * The regression this function exists to prevent: the options once came from
   * `byCredential`, which analysis narrows to the selected credential, so
   * choosing one removed every other from the list. Observations are not
   * filtered, so the full set survives no matter what is selected.
   */
  it("offers every observed credential regardless of what is selected", () => {
    const options = credentialOptions(
      [
        observation({ fingerprint: "aaaaaaaaaaaa" }),
        observation({ mode: "api-key", fingerprint: "bbbbbbbbbbbb" }),
      ],
      t,
    );
    assert.deepEqual(
      options.map((option) => option.value),
      ["", "subscription:aaaaaaaaaaaa", "api-key:bbbbbbbbbbbb", "unattributed"],
    );
  });

  it("always offers the unattributed bucket, which no observation backs", () => {
    const values = credentialOptions([], t).map((option) => option.value);
    assert.deepEqual(values, ["", "unattributed"]);
  });

  it("does not repeat a credential observed more than once", () => {
    const values = credentialOptions(
      [observation({ fingerprint: "aaaaaaaaaaaa" }), observation({ fingerprint: "aaaaaaaaaaaa" })],
      t,
    ).map((option) => option.value);
    assert.deepEqual(values, ["", "subscription:aaaaaaaaaaaa", "unattributed"]);
  });
});

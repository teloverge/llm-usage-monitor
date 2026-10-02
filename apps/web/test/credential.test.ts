import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation } from "@llm-usage-monitor/contracts";
import {
  countsAgainstPlan,
  credentialLabel,
  credentialLabeler,
  credentialModeKey,
  credentialOptions,
  fingerprintTag,
  latestCredential,
  parseCredentialId,
  planLabel,
} from "../src/model/credential.ts";

/**
 * Stands in for i18next: returns the key itself, so a test can assert WHICH key
 * a label is built from without pinning copy that lives in the locale files.
 */
const t = (key: string) => key;

/** Stands in for `usageSourceLabel`, so the source name is visible in assertions. */
const source = (usageSourceId: string) => `<${usageSourceId}>`;

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

describe("planLabel", () => {
  it("drops a product prefix and capitalises the words", () => {
    assert.equal(planLabel("claude_max_20x"), "Max 20x");
    assert.equal(planLabel("pro"), "Pro");
  });

  it("keeps a single word even when it is a product name", () => {
    assert.equal(planLabel("claude"), "Claude");
  });

  it("leaves words that already carry capitals as written", () => {
    assert.equal(planLabel("SuperGrok Heavy"), "SuperGrok Heavy");
    assert.equal(planLabel("Free"), "Free");
  });
});

describe("fingerprintTag", () => {
  it("is the last four characters of the fingerprint", () => {
    assert.equal(fingerprintTag("ddf56ff57053"), "…7053");
  });

  it("is empty when the source named no account", () => {
    assert.equal(fingerprintTag(""), "");
  });
});

describe("credentialLabeler", () => {
  it("names a credential by its source, plan, and fingerprint tag", () => {
    const label = credentialLabeler([observation({ plan: "claude_max_20x" })], t, source);
    assert.equal(label("subscription:9a1b2c3d4e5f"), "<codex-local> · Max 20x · …4e5f");
  });

  it("borrows the plan from a quota snapshot on a host where the credential is current", () => {
    const label = credentialLabeler([observation()], t, source, [
      {
        usageSourceId: "codex-local",
        sourceHostId: "host:a",
        plan: "pro",
        observedAt: "2026-07-20T00:00:00.000Z",
        windows: [],
      },
    ]);
    assert.equal(label("subscription:9a1b2c3d4e5f"), "<codex-local> · Pro · …4e5f");
  });

  it("does not lend a snapshot's plan to an account the host has moved off", () => {
    const label = credentialLabeler(
      [
        observation({ fingerprint: "aaaaaaaa1111" }),
        observation({ fingerprint: "bbbbbbbb2222", effectiveFrom: "2026-07-20T00:00:00.000Z" }),
      ],
      t,
      source,
      [
        {
          usageSourceId: "codex-local",
          sourceHostId: "host:a",
          plan: "plus",
          observedAt: "2026-07-25T00:00:00.000Z",
          windows: [],
        },
      ],
    );
    assert.equal(label("subscription:bbbbbbbb2222"), "<codex-local> · Plus · …2222");
    assert.equal(
      label("subscription:aaaaaaaa1111"),
      "<codex-local> · credential.mode.subscription · …1111",
    );
  });

  it("falls back to the mode when no plan was reported", () => {
    const label = credentialLabeler([observation({ mode: "api-key" })], t, source);
    assert.equal(label("api-key:9a1b2c3d4e5f"), "<codex-local> · credential.mode.apiKey · …4e5f");
  });

  it("omits the tag when the source named no account", () => {
    const label = credentialLabeler([observation({ mode: "api-key", fingerprint: "" })], t, source);
    assert.equal(label("api-key:"), "<codex-local> · credential.mode.apiKey");
  });

  it("takes the plan from the newest observation", () => {
    const label = credentialLabeler(
      [
        observation({ plan: "plus", observedAt: "2026-07-01T00:00:00.000Z" }),
        observation({ plan: "pro", observedAt: "2026-07-20T00:00:00.000Z" }),
      ],
      t,
      source,
    );
    assert.equal(label("subscription:9a1b2c3d4e5f"), "<codex-local> · Pro · …4e5f");
  });

  it("tells two subscriptions on the same plan apart by their tags", () => {
    const label = credentialLabeler(
      [
        observation({ fingerprint: "aaaaaaaa1111", plan: "pro" }),
        observation({ fingerprint: "bbbbbbbb2222", plan: "pro" }),
      ],
      t,
      source,
    );
    assert.equal(label("subscription:aaaaaaaa1111"), "<codex-local> · Pro · …1111");
    assert.equal(label("subscription:bbbbbbbb2222"), "<codex-local> · Pro · …2222");
  });

  it("widens to the full fingerprint when two tags collide", () => {
    const label = credentialLabeler(
      [
        observation({ fingerprint: "aaaaaaaa1111", plan: "pro" }),
        observation({ fingerprint: "bbbbbbbb1111", plan: "pro" }),
      ],
      t,
      source,
    );
    assert.equal(label("subscription:aaaaaaaa1111"), "<codex-local> · Pro · aaaaaaaa1111");
    assert.equal(label("subscription:bbbbbbbb1111"), "<codex-local> · Pro · bbbbbbbb1111");
  });

  it("lists every source signed in with one credential", () => {
    const label = credentialLabeler(
      [observation(), observation({ usageSourceId: "opencode-local" })],
      t,
      source,
    );
    assert.equal(
      label("subscription:9a1b2c3d4e5f"),
      "<codex-local> / <opencode-local> · credential.mode.subscription · …4e5f",
    );
  });

  it("falls back to mode and fingerprint for a credential nothing describes", () => {
    const label = credentialLabeler([], t, source);
    assert.equal(label("api-key:a1b2c3d4e5f6"), "credential.mode.apiKey · a1b2c3d4e5f6");
    assert.equal(label("unattributed"), "credential.unattributed");
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
      source,
    );
    assert.deepEqual(
      options.map((option) => option.value),
      ["", "subscription:aaaaaaaaaaaa", "api-key:bbbbbbbbbbbb", "unattributed"],
    );
  });

  it("always offers the unattributed bucket, which no observation backs", () => {
    const values = credentialOptions([], t, source).map((option) => option.value);
    assert.deepEqual(values, ["", "unattributed"]);
  });

  it("does not repeat a credential observed more than once", () => {
    const values = credentialOptions(
      [observation({ fingerprint: "aaaaaaaaaaaa" }), observation({ fingerprint: "aaaaaaaaaaaa" })],
      t,
      source,
    ).map((option) => option.value);
    assert.deepEqual(values, ["", "subscription:aaaaaaaaaaaa", "unattributed"]);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeCredentialSighting } from "../src/claude-credential.ts";
import { credentialFingerprint } from "../src/credential-fingerprint.ts";

const OBSERVED = "2026-07-26T22:00:00.000Z";
const config = {
  oauthAccount: {
    emailAddress: "someone@example.com",
    accountUuid: "937ec57b-57ff-4293-abce-493df76661c8",
    organizationType: "claude_max",
    organizationRateLimitTier: "default_claude_max_20x",
  },
};

describe("claudeCredentialSighting", () => {
  it("reads a subscription from the cached account", () => {
    const sighting = claudeCredentialSighting(config, {}, "host:a", OBSERVED);
    assert.equal(sighting?.usageSourceId, "claude-code-local");
    assert.equal(sighting?.mode, "subscription");
    assert.equal(sighting?.plan, "claude_max_20x");
    assert.match(String(sighting?.fingerprint), /^[0-9a-f]{12}$/);
    // Nothing local states Claude's mode, so every reading here is deduced.
    assert.equal(sighting?.inferred, true);
  });

  it("prefers a gateway over an API key when both are set", () => {
    // A shell with CLAUDE_CODE_USE_BEDROCK reaches the model through Bedrock;
    // calling that a direct API key would name the wrong biller.
    const env = { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "sk-ant-value" };
    assert.equal(claudeCredentialSighting(config, env, "host:a", OBSERVED)?.mode, "bedrock");
    assert.equal(
      claudeCredentialSighting(config, { CLAUDE_CODE_USE_VERTEX: "true" }, "host:a", OBSERVED)
        ?.mode,
      "vertex",
    );
  });

  it("reads an API key from either environment variable", () => {
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
      const sighting = claudeCredentialSighting(
        config,
        { [key]: "sk-ant-value" },
        "host:a",
        OBSERVED,
      );
      assert.equal(sighting?.mode, "api-key", key);
      assert.ok(!JSON.stringify(sighting).includes("sk-ant-value"));
    }
  });

  it("still fingerprints the account in api-key mode", () => {
    // The account is what tells two credentials apart; the key is never touched.
    const withKey = claudeCredentialSighting(
      config,
      { ANTHROPIC_API_KEY: "k" },
      "host:a",
      OBSERVED,
    );
    const without = claudeCredentialSighting(config, {}, "host:a", OBSERVED);
    assert.equal(withKey?.fingerprint, without?.fingerprint);
  });

  it("treats a disabled gateway flag as unset", () => {
    for (const value of ["0", "false", "", "  "]) {
      assert.equal(
        claudeCredentialSighting(config, { CLAUDE_CODE_USE_BEDROCK: value }, "host:a", OBSERVED)
          ?.mode,
        "subscription",
        `should ignore ${JSON.stringify(value)}`,
      );
    }
  });

  it("reports an API key even with no cached account", () => {
    const sighting = claudeCredentialSighting(null, { ANTHROPIC_API_KEY: "k" }, "host:a", OBSERVED);
    assert.equal(sighting?.mode, "api-key");
    assert.equal(sighting?.fingerprint, "");
    assert.equal(sighting?.plan, undefined);
  });

  it("reports nothing when there is no evidence at all", () => {
    assert.equal(claudeCredentialSighting(null, {}, "host:a", OBSERVED), null);
    assert.equal(claudeCredentialSighting({}, {}, "host:a", OBSERVED), null);
  });

  it("stores no account identifier", () => {
    const sighting = claudeCredentialSighting(config, {}, "host:a", OBSERVED);
    const serialized = JSON.stringify(sighting);
    assert.ok(!serialized.includes("someone@example.com"));
    assert.ok(!serialized.includes("937ec57b-57ff-4293-abce-493df76661c8"));

    // A SHA-256 digest contains none of its input's text, so absence of the
    // literal above proves nothing about what was actually hashed — fingerprinting
    // the wrong field would pass every assertion so far. Pin the source field by
    // computing the fingerprint independently over `accountUuid` and comparing.
    assert.equal(sighting?.fingerprint, credentialFingerprint(config.oauthAccount.accountUuid));

    // Prove emailAddress/organizationType are not inputs to the fingerprint: the
    // same accountUuid with different email and org values yields the same
    // fingerprint, while changing accountUuid changes it.
    const sameAccountDifferentDetails = claudeCredentialSighting(
      {
        oauthAccount: {
          emailAddress: "different@example.com",
          accountUuid: config.oauthAccount.accountUuid,
          organizationType: "claude_pro",
          organizationRateLimitTier: "default_claude_pro",
        },
      },
      {},
      "host:a",
      OBSERVED,
    );
    assert.equal(sameAccountDifferentDetails?.fingerprint, sighting?.fingerprint);

    const differentAccount = claudeCredentialSighting(
      {
        oauthAccount: {
          ...config.oauthAccount,
          accountUuid: "aaaaaaaa-1111-2222-3333-444444444444",
        },
      },
      {},
      "host:a",
      OBSERVED,
    );
    assert.notEqual(differentAccount?.fingerprint, sighting?.fingerprint);
  });
});

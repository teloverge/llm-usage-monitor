import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialFingerprint } from "../src/credential-fingerprint.ts";

const ACCOUNT = "937ec57b-57ff-4293-abce-493df76661c8";

describe("credentialFingerprint", () => {
  it("is stable for the same account", () => {
    assert.equal(credentialFingerprint(ACCOUNT), credentialFingerprint(ACCOUNT));
  });

  it("produces 12 lowercase hex characters", () => {
    assert.match(credentialFingerprint(ACCOUNT), /^[0-9a-f]{12}$/);
  });

  it("distinguishes two accounts", () => {
    assert.notEqual(credentialFingerprint(ACCOUNT), credentialFingerprint("a-different-account"));
  });

  it("does not contain the value it digested", () => {
    // The ledger must never hold an account identifier, even in part.
    assert.ok(!credentialFingerprint(ACCOUNT).includes("937ec57b"));
  });

  it("reports no fingerprint when the source names no account", () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      assert.equal(credentialFingerprint(value), "", `should be empty for ${String(value)}`);
    }
  });

  it("ignores surrounding whitespace", () => {
    assert.equal(credentialFingerprint(` ${ACCOUNT} `), credentialFingerprint(ACCOUNT));
  });
});

import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { codexCredentialSighting } from "../src/codex-credential.ts";
import { credentialFingerprint } from "../src/credential-fingerprint.ts";

const scratch: string[] = [];
async function homeWith(auth: unknown): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-codex-auth-"));
  scratch.push(dir);
  if (auth !== undefined) {
    await fs.writeFile(
      join(dir, "auth.json"),
      typeof auth === "string" ? auth : JSON.stringify(auth),
      "utf8",
    );
  }
  return dir;
}
after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

const OBSERVED = "2026-07-26T22:00:00.000Z";

describe("codexCredentialSighting", () => {
  it("reads a subscription from the stated auth mode", async () => {
    const home = await homeWith({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: { account_id: "c8c541e4-1234", access_token: "secret-token-value" },
    });
    const sighting = await codexCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.usageSourceId, "codex-local");
    assert.equal(sighting?.mode, "subscription");
    assert.equal(sighting?.observedAt, OBSERVED);
    // Codex says so outright; nothing is being deduced.
    assert.equal(sighting?.inferred, false);
    assert.match(String(sighting?.fingerprint), /^[0-9a-f]{12}$/);
  });

  it("never lets token material reach the sighting", async () => {
    const accountId = "c8c541e4-1234";
    const home = await homeWith({
      auth_mode: "chatgpt",
      tokens: {
        account_id: accountId,
        access_token: "secret-token-value",
        refresh_token: "rt.secret",
      },
    });
    const sighting = await codexCredentialSighting(home, "host:a", OBSERVED);
    const serialized = JSON.stringify(sighting);

    // A digest of a secret contains none of the secret's text, so absence of the
    // literal proves nothing about what was hashed. Test that we hashed the
    // right field by computing it independently and comparing.
    assert.equal(sighting?.fingerprint, credentialFingerprint(accountId));

    // Substring checks guard against verbatim copies but don't prove the source.
    // These remain valuable: they catch a different failure (copying the secret).
    assert.ok(!serialized.includes("secret-token-value"));
    assert.ok(!serialized.includes("rt.secret"));
    assert.ok(!serialized.includes(accountId));

    // Prove tokens are not an input: same account_id with different tokens
    // produces the same fingerprint.
    const home2 = await homeWith({
      auth_mode: "chatgpt",
      tokens: {
        account_id: accountId,
        access_token: "different-token",
        refresh_token: "rt.different",
      },
    });
    const sighting2 = await codexCredentialSighting(home2, "host:a", OBSERVED);
    assert.equal(sighting?.fingerprint, sighting2?.fingerprint);

    // Prove the source field matters: different account_id produces different
    // fingerprint.
    const home3 = await homeWith({
      auth_mode: "chatgpt",
      tokens: {
        account_id: "other-account-id-9999",
        access_token: "secret-token-value",
        refresh_token: "rt.secret",
      },
    });
    const sighting3 = await codexCredentialSighting(home3, "host:a", OBSERVED);
    assert.notEqual(sighting?.fingerprint, sighting3?.fingerprint);
  });

  it("reads an API key from the stated auth mode", async () => {
    const home = await homeWith({ auth_mode: "apikey", OPENAI_API_KEY: "sk-live-value" });
    const sighting = await codexCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.mode, "api-key");
    // No account is stated in this mode, and a key is never fingerprinted.
    assert.equal(sighting?.fingerprint, "");
    assert.ok(!JSON.stringify(sighting).includes("sk-live-value"));
  });

  it("falls back to a key present with no stated mode", async () => {
    const home = await homeWith({ OPENAI_API_KEY: "sk-live-value" });
    assert.equal((await codexCredentialSighting(home, "host:a", OBSERVED))?.mode, "api-key");
  });

  it("classifies an unrecognised mode as unknown rather than dropping it", async () => {
    const home = await homeWith({ auth_mode: "device-code" });
    assert.equal((await codexCredentialSighting(home, "host:a", OBSERVED))?.mode, "unknown");
  });

  it("reports nothing when there is no evidence at all", async () => {
    assert.equal(
      await codexCredentialSighting(await homeWith(undefined), "host:a", OBSERVED),
      null,
    );
    assert.equal(
      await codexCredentialSighting(await homeWith("{ not json"), "host:a", OBSERVED),
      null,
    );
    assert.equal(await codexCredentialSighting(await homeWith([1, 2]), "host:a", OBSERVED), null);
    assert.equal(await codexCredentialSighting(await homeWith({}), "host:a", OBSERVED), null);
  });
});

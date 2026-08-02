import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { credentialFingerprint } from "../src/credential-fingerprint.ts";
import { grokCredentialSighting } from "../src/grok-credential.ts";

const scratch: string[] = [];
async function homeWith(auth: unknown): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-grok-auth-"));
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

const OBSERVED = "2026-08-02T22:00:00.000Z";
const USER = "2b350b60-9f0c-4f6a-828c-92c08fe96a87";

/** One auth.json entry as Grok Build writes it, keyed by issuer and account. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: "sk-secret-key-material",
    auth_mode: "oidc",
    create_time: "2026-08-02T13:35:00.000Z",
    user_id: USER,
    email: "someone@example.com",
    principal_type: "User",
    refresh_token: "rt.secret",
    ...overrides,
  };
}

describe("grokCredentialSighting", () => {
  it("reads a subscription from the stated oidc mode", async () => {
    const home = await homeWith({ [`https://auth.x.ai::${USER}`]: entry() });
    const sighting = await grokCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.usageSourceId, "grok-build-local");
    assert.equal(sighting?.mode, "subscription");
    assert.equal(sighting?.observedAt, OBSERVED);
    // Grok Build says so outright; nothing is being deduced.
    assert.equal(sighting?.inferred, false);
    assert.match(String(sighting?.fingerprint), /^[0-9a-f]{12}$/);
  });

  it("never lets key material or identifiers reach the sighting", async () => {
    const home = await homeWith({ [`https://auth.x.ai::${USER}`]: entry() });
    const sighting = await grokCredentialSighting(home, "host:a", OBSERVED);
    const serialized = JSON.stringify(sighting);

    // Test that the right field was hashed by computing it independently.
    assert.equal(sighting?.fingerprint, credentialFingerprint(USER));
    assert.ok(!serialized.includes("sk-secret-key-material"));
    assert.ok(!serialized.includes("rt.secret"));
    assert.ok(!serialized.includes(USER));
    assert.ok(!serialized.includes("someone@example.com"));

    // Same account with rotated secrets is the same credential.
    const rotated = await homeWith({
      [`https://auth.x.ai::${USER}`]: entry({ key: "sk-other", refresh_token: "rt.other" }),
    });
    const sighting2 = await grokCredentialSighting(rotated, "host:a", OBSERVED);
    assert.equal(sighting?.fingerprint, sighting2?.fingerprint);

    // A different account is a different credential.
    const other = await homeWith({
      "https://auth.x.ai::other": entry({ user_id: "0f0e0d0c-0b0a-4998-8776-655443322110" }),
    });
    const sighting3 = await grokCredentialSighting(other, "host:a", OBSERVED);
    assert.notEqual(sighting?.fingerprint, sighting3?.fingerprint);
  });

  it("reads an API key from the stated auth mode", async () => {
    const home = await homeWith({
      [`https://auth.x.ai::${USER}`]: entry({ auth_mode: "api_key" }),
    });
    const sighting = await grokCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.mode, "api-key");
  });

  it("treats the deprecated web_login mode as the subscription it was", async () => {
    const home = await homeWith({
      [`https://auth.x.ai::${USER}`]: entry({ auth_mode: "web_login" }),
    });
    assert.equal((await grokCredentialSighting(home, "host:a", OBSERVED))?.mode, "subscription");
  });

  it("classifies an unrecognised mode as unknown rather than dropping it", async () => {
    const home = await homeWith({
      [`https://auth.x.ai::${USER}`]: entry({ auth_mode: "external" }),
    });
    assert.equal((await grokCredentialSighting(home, "host:a", OBSERVED))?.mode, "unknown");
  });

  it("uses the most recently created entry when several accounts exist", async () => {
    const newer = "11111111-2222-4333-8444-555566667777";
    const home = await homeWith({
      [`https://auth.x.ai::${USER}`]: entry({ create_time: "2026-07-01T00:00:00.000Z" }),
      [`https://auth.x.ai::${newer}`]: entry({
        user_id: newer,
        create_time: "2026-08-01T00:00:00.000Z",
      }),
    });
    const sighting = await grokCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.fingerprint, credentialFingerprint(newer));
  });

  it("reports nothing when there is no evidence at all", async () => {
    assert.equal(await grokCredentialSighting(await homeWith(undefined), "host:a", OBSERVED), null);
    assert.equal(
      await grokCredentialSighting(await homeWith("{ not json"), "host:a", OBSERVED),
      null,
    );
    assert.equal(await grokCredentialSighting(await homeWith([1, 2]), "host:a", OBSERVED), null);
    assert.equal(await grokCredentialSighting(await homeWith({}), "host:a", OBSERVED), null);
  });
});

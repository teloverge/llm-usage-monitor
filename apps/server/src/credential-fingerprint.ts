import { createHash } from "node:crypto";

/**
 * One-way digest of an ACCOUNT identifier, for telling two accounts apart.
 *
 * Twelve hex characters is 48 bits — ample to distinguish the handful of
 * accounts on one machine, and short enough that the stored value never looks
 * like an identifier someone could use.
 *
 * Never call this on key material. Hashing is one-way, but the project's promise
 * is not to READ credentials at all, and an account id is enough to tell
 * accounts apart without ever touching a secret.
 */
export function credentialFingerprint(value: unknown): string {
  const account = typeof value === "string" ? value.trim() : "";
  if (!account) return "";
  return createHash("sha256").update(account).digest("hex").slice(0, 12);
}

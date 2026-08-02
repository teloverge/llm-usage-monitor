import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CredentialMode, CredentialSighting } from "@llm-usage-monitor/contracts";
import { credentialFingerprint } from "./credential-fingerprint.ts";

const MAX_AUTH_BYTES = 4 * 1024 * 1024;

/**
 * Reads the credential Grok Build is currently using.
 *
 * Grok Build STATES its mode per account entry in `auth.json`, so this is an
 * observation rather than an inference. Only `auth_mode`, `user_id`, and
 * `create_time` are read — the key and refresh token beside them are never
 * read, hashed, or logged. The fingerprint comes from `user_id`, an opaque
 * account UUID, in preference to the email sitting next to it.
 *
 * The file maps `issuer::account` keys to entries, so several accounts can
 * coexist; the most recently created entry is the credential in effect. As
 * with Codex: no file, no evidence, no sighting.
 */
export async function grokCredentialSighting(
  home: string,
  sourceHostId: string,
  observedAt: string,
): Promise<CredentialSighting | null> {
  let parsed: unknown;
  try {
    const path = join(home, "auth.json");
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) return null;
    parsed = JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const entries = Object.values(parsed).filter(
    (value): value is Record<string, unknown> =>
      Boolean(value) && typeof value === "object" && !Array.isArray(value),
  );
  const current = entries
    .sort((a, b) => String(a.create_time ?? "").localeCompare(String(b.create_time ?? "")))
    .at(-1);
  const mode = current && grokMode(current.auth_mode);
  if (!current || !mode) return null;
  return {
    usageSourceId: "grok-build-local",
    sourceHostId,
    mode,
    // The ACCOUNT id, never the key beside it.
    fingerprint: credentialFingerprint(current.user_id),
    inferred: false,
    observedAt,
  };
}

/**
 * `AuthMode` in Grok Build's source serializes as snake_case: `web_login`
 * (alias "grok", deprecated), `oidc`, `external`, `api_key`. The interactive
 * logins are an account subscription; an external auth binary is a credential
 * we saw but cannot classify, which is exactly what "unknown" states.
 */
function grokMode(value: unknown): CredentialMode | null {
  const mode = String(value ?? "")
    .trim()
    .toLocaleLowerCase();
  if (!mode) return null;
  if (mode === "oidc" || mode === "web_login" || mode === "grok") return "subscription";
  if (mode === "api_key" || mode === "api-key" || mode === "apikey") return "api-key";
  return "unknown";
}

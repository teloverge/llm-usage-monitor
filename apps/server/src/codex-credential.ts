import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CredentialMode, CredentialSighting } from "@llm-usage-monitor/contracts";
import { credentialFingerprint } from "./credential-fingerprint.ts";

const MAX_AUTH_BYTES = 4 * 1024 * 1024;

/**
 * Reads the credential Codex is currently using.
 *
 * Codex STATES its mode in `auth.json`, so this is an observation rather than an
 * inference and the sighting is marked accordingly. Only `auth_mode`, the
 * presence of `OPENAI_API_KEY`, and `tokens.account_id` are read — the token
 * bodies sitting beside them are never read, hashed, or logged.
 *
 * No file, no evidence, no sighting: absence is reported as nothing observed,
 * never as an "unknown" credential, which would claim we looked and found
 * something we could not classify.
 */
export async function codexCredentialSighting(
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
  const auth =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const mode = auth && codexMode(auth);
  if (!auth || !mode) return null;
  const tokens =
    auth.tokens && typeof auth.tokens === "object" && !Array.isArray(auth.tokens)
      ? (auth.tokens as Record<string, unknown>)
      : null;
  return {
    usageSourceId: "codex-local",
    sourceHostId,
    mode,
    // The ACCOUNT id, never the key. In api-key mode Codex names no account and
    // the credential is distinguished by its mode alone.
    fingerprint: credentialFingerprint(tokens?.account_id),
    inferred: false,
    observedAt,
  };
}

function codexMode(auth: Record<string, unknown>): CredentialMode | null {
  const stated = typeof auth.auth_mode === "string" ? auth.auth_mode.trim().toLowerCase() : "";
  if (stated === "chatgpt") return "subscription";
  if (stated === "apikey") return "api-key";
  if (stated) return "unknown";
  // Older layouts state no mode and simply carry the key.
  return typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim() ? "api-key" : null;
}

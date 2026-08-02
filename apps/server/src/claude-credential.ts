import type { CredentialMode, CredentialSighting } from "@llm-usage-monitor/contracts";
import { planLabel } from "./claude-quota.ts";
import { credentialFingerprint } from "./credential-fingerprint.ts";

/**
 * Deduces the credential Claude Code is reaching Anthropic with.
 *
 * Nothing local STATES this. Claude Code's transcripts carry no auth field and
 * its session files carry none either, so the mode is assembled from the
 * environment this process can see plus the presence of a cached OAuth account.
 * Every sighting is therefore marked `inferred`, and there is a real hole behind
 * that flag: Claude Code launched from a shell carrying `ANTHROPIC_API_KEY` that
 * the Usage Monitor Server's own process cannot see reads as a subscription.
 * There is no local artefact that would reveal it. The flag is how the dashboard
 * declines to present this with the authority it gives Codex.
 *
 * `env` is a parameter rather than a read of `process.env` so the inference can
 * be tested without mutating the process.
 */
export function claudeCredentialSighting(
  config: Record<string, unknown> | null,
  env: Record<string, string | undefined>,
  sourceHostId: string,
  observedAt: string,
): CredentialSighting | null {
  const account = asRecord(config?.oauthAccount);
  const mode = claudeMode(account, env);
  if (!mode) return null;
  const plan = account ? planLabel(account) : undefined;
  return {
    usageSourceId: "claude-code-local",
    sourceHostId,
    mode,
    // Always the ACCOUNT, never the key — including in api-key mode, where the
    // account is what distinguishes two credentials and the key is untouched.
    fingerprint: credentialFingerprint(account?.accountUuid),
    ...(plan ? { plan } : {}),
    inferred: true,
    observedAt,
  };
}

/**
 * Gateways are tested before the API key because they are explicit routing
 * decisions: a shell setting `CLAUDE_CODE_USE_BEDROCK` alongside an Anthropic
 * key is reaching the model through Bedrock, and reporting that as a direct API
 * key would name the wrong biller.
 */
function claudeMode(
  account: Record<string, unknown> | null,
  env: Record<string, string | undefined>,
): CredentialMode | null {
  if (enabled(env.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (enabled(env.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (present(env.ANTHROPIC_API_KEY) || present(env.ANTHROPIC_AUTH_TOKEN)) return "api-key";
  if (account) return "subscription";
  // No account and no environment signal is nothing observed, not an unknown
  // credential — the same distinction the rest of the dashboard draws between
  // "did not say" and "said none".
  return null;
}

function enabled(value: string | undefined): boolean {
  const flag = (value ?? "").trim().toLowerCase();
  return flag !== "" && flag !== "0" && flag !== "false";
}
function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

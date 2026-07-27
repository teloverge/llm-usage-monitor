import { UNATTRIBUTED_CREDENTIAL, type CredentialObservation } from "@llm-usage-monitor/contracts";

/**
 * Translation key segment per mode. The mode ids are contract values and one of
 * them contains a hyphen, which cannot be addressed by dotted i18n path, so the
 * view never interpolates a raw mode into a key.
 */
const MODE_KEYS: Record<string, string> = {
  subscription: "subscription",
  "api-key": "apiKey",
  bedrock: "bedrock",
  vertex: "vertex",
};

export function credentialModeKey(mode: string): string {
  return MODE_KEYS[mode] ?? "unknown";
}

/**
 * Whether usage on this credential consumes the plan window shown beside it.
 *
 * Only a subscription does. API-key, Bedrock and Vertex usage is billed
 * elsewhere entirely, which is why the panel says so instead of letting a
 * percentage sit next to spend it has nothing to do with.
 */
export function countsAgainstPlan(mode: string): boolean {
  return mode === "subscription";
}

/** The credential a source is on NOW, for the badge. */
export function latestCredential(
  credentials: CredentialObservation[],
  usageSourceId: string,
  sourceHostId: string,
): CredentialObservation | undefined {
  let latest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (credential.usageSourceId !== usageSourceId) continue;
    if (credential.sourceHostId !== sourceHostId) continue;
    if (!latest || credential.effectiveFrom > latest.effectiveFrom) latest = credential;
  }
  return latest;
}

/** Splits a `byCredential` row key back into the parts a label needs. */
export function parseCredentialId(id: string): {
  unattributed: boolean;
  modeKey: string;
  fingerprint: string;
} {
  if (id === UNATTRIBUTED_CREDENTIAL) {
    return { unattributed: true, modeKey: "unknown", fingerprint: "" };
  }
  const separator = id.lastIndexOf(":");
  const mode = separator === -1 ? id : id.slice(0, separator);
  return {
    unattributed: false,
    modeKey: credentialModeKey(mode),
    fingerprint: separator === -1 ? "" : id.slice(separator + 1),
  };
}

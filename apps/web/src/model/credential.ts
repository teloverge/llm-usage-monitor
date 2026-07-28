import {
  credentialIdFor,
  UNATTRIBUTED_CREDENTIAL,
  type CredentialObservation,
} from "@llm-usage-monitor/contracts";

/**
 * Translation key segment per mode. The mode ids are contract values and one of
 * them contains a hyphen, which cannot be addressed by dotted i18n path, so the
 * view never interpolates a raw mode into a key.
 *
 * Typed as a literal union, not `string`: the view interpolates this into a
 * `t(`credential.mode.${...}`)` call, and i18next's `strictKeyChecks` can only
 * catch a typo'd key when the interpolated segment is narrow enough to check
 * against the resource file's actual keys.
 */
const MODE_KEYS: Record<string, "subscription" | "apiKey" | "bedrock" | "vertex"> = {
  subscription: "subscription",
  "api-key": "apiKey",
  bedrock: "bedrock",
  vertex: "vertex",
};

export function credentialModeKey(
  mode: string,
): "subscription" | "apiKey" | "bedrock" | "vertex" | "unknown" {
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

/**
 * How a credential is named wherever it appears — the Breakdown row and the
 * filter chip both call this.
 *
 * One function rather than the same ternary in two files: the two lists sit
 * side by side on screen, and a reader picking "API key · a1b2c3d4e5f6" from
 * the chip has to find that exact string in the rows. Two copies of the rule
 * are two chances for them to drift apart.
 *
 * The fingerprint is shown rather than hidden. It is what tells two accounts on
 * the same mode apart, and it identifies nothing on its own — it is a one-way
 * digest of an account id.
 */
export function credentialLabel(id: string, t: (key: string) => string): string {
  const parsed = parseCredentialId(id);
  if (parsed.unattributed) return t("credential.unattributed");
  const mode = t(`credential.mode.${parsed.modeKey}`);
  return parsed.fingerprint ? `${mode} · ${parsed.fingerprint}` : mode;
}

/**
 * The credential filter's options.
 *
 * Built from the observations, which analysis passes through untouched, and
 * deliberately NOT from `byCredential`, which is computed AFTER
 * `filters.credentialId` has been applied. A chip fed from `byCredential` drops
 * every alternative the moment one is chosen, stranding the reader on their own
 * selection with no way across to another credential except back through
 * "All credentials" — the same trap the Host chip avoids by reading the host
 * catalog rather than `bySourceHost`.
 *
 * The unattributed bucket is appended unconditionally. No observation stands
 * behind it, so it never appears in `credentials`, and deriving it from
 * `byCredential` instead would reintroduce exactly the filter dependency above
 * for this one entry. On a fully attributed ledger it selects nothing — the
 * same harmless outcome as picking a host with no records in the period, and
 * far better than the reverse, since on a real ledger this bucket starts out
 * holding almost every record.
 */
export function credentialOptions(
  credentials: CredentialObservation[],
  t: (key: string) => string,
): { value: string; label: string }[] {
  const ids = [...new Set([...credentials.map(credentialIdFor), UNATTRIBUTED_CREDENTIAL])];
  return [
    { value: "", label: t("filters.allCredentials") },
    ...ids.map((id) => ({ value: id, label: credentialLabel(id, t) })),
  ];
}

/**
 * Splits a `byCredential` row key back into the parts a label needs.
 *
 * `modeKey` is typed as the same literal union `credentialModeKey` returns,
 * not widened to `string`: callers interpolate it into a
 * `t(`credential.mode.${...}`)` call, and i18next's `strictKeyChecks` can
 * only catch a typo'd key when the interpolated segment is narrow enough to
 * check against the resource file's actual keys.
 */
export function parseCredentialId(id: string): {
  unattributed: boolean;
  modeKey: "subscription" | "apiKey" | "bedrock" | "vertex" | "unknown";
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

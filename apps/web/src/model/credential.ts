import {
  credentialIdFor,
  UNATTRIBUTED_CREDENTIAL,
  type CredentialObservation,
  type UsageQuotaSnapshot,
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
 * A credential named by its mode and fingerprint alone — the fallback when no
 * observation says which harness or plan it belongs to.
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
 * Product prefixes a plan id repeats from the harness name beside it:
 * `claude_max_20x` under "Claude Code" reads as "Max 20x".
 */
const PLAN_PREFIXES = new Set(["anthropic", "claude", "chatgpt", "openai", "codex", "grok", "xai"]);

/**
 * A plan as the reader would name it. Sources report plans as ids —
 * `claude_max_20x`, `pro`, `Free` — so this drops a leading product prefix,
 * splits on separators, and capitalises each word that starts lowercase.
 * Words that already carry capitals ("SuperGrok") are left as written.
 */
export function planLabel(plan: string): string {
  const words = plan
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length > 1 && PLAN_PREFIXES.has(words[0]!.toLowerCase())) words.shift();
  return words
    .map((word) => (/^[a-z]/.test(word) ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * A short, stable tag for one account: the last four characters of its
 * fingerprint, as "…5053". It is what tells two subscriptions on the same
 * harness and plan apart at a glance.
 *
 * The fingerprint, not the account's own id, because the id is never read
 * into the ledger — the fingerprint is a one-way digest of it. Four characters
 * collide only about once in 65,000 pairs; `credentialLabeler` widens to the
 * full fingerprint if two ever do.
 */
export function fingerprintTag(fingerprint: string): string {
  return fingerprint ? `…${fingerprint.slice(-4)}` : "";
}

/**
 * How a credential is named wherever it appears — the Breakdown rows, the
 * Overview's harness panel, and the filter chip all use this, so a reader
 * picking an entry from the chip finds that exact string in the rows.
 *
 * Named by what the reader recognises: the harness that uses it, its plan
 * ("Claude Code · Max 20x") or its mode when no plan was reported
 * ("Codex · API key"), and the account's fingerprint tag. The tag is shown on
 * every account that has one, not only when two would otherwise share a name:
 * the same subscription then reads the same in every list, and a second
 * account on the same plan is told apart without the first one's label
 * changing under the reader.
 *
 * Not every source states its plan with the credential — Codex reports it
 * only in its quota reading. A plan-less credential therefore borrows the plan
 * from a quota snapshot taken on a host where it is the CURRENT credential, so
 * the chip and the plan-limits card agree ("Codex · Pro"), and a snapshot
 * never lends its plan to an account that host has since signed out of.
 *
 * A credential no observation describes falls back to `credentialLabel`.
 */
export function credentialLabeler(
  credentials: CredentialObservation[],
  t: (key: string) => string,
  sourceLabel: (usageSourceId: string) => string,
  snapshots: UsageQuotaSnapshot[] = [],
): (id: string) => string {
  const snapshotPlans = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (!snapshot.plan?.trim()) continue;
    const current = latestCredential(credentials, snapshot.usageSourceId, snapshot.sourceHostId);
    if (current) snapshotPlans.set(credentialIdFor(current), snapshot.plan);
  }
  const byId = new Map<string, CredentialObservation[]>();
  for (const credential of credentials) {
    const id = credentialIdFor(credential);
    const list = byId.get(id);
    if (list) list.push(credential);
    else byId.set(id, [credential]);
  }
  const bases = new Map<string, string>();
  for (const [id, observations] of byId) {
    const sources = [...new Set(observations.map((item) => sourceLabel(item.usageSourceId)))];
    const latest = observations.reduce((newest, item) =>
      item.observedAt > newest.observedAt ? item : newest,
    );
    const rawPlan = latest.plan?.trim() || snapshotPlans.get(id) || "";
    const plan = rawPlan ? planLabel(rawPlan) : "";
    const kind = plan || t(`credential.mode.${credentialModeKey(latest.mode)}`);
    bases.set(id, `${sources.join(" / ")} · ${kind}`);
  }
  const tagged = (id: string, base: string, full: boolean) => {
    const { fingerprint } = parseCredentialId(id);
    if (!fingerprint) return base;
    return `${base} · ${full ? fingerprint : fingerprintTag(fingerprint)}`;
  };
  const uses = new Map<string, number>();
  for (const [id, base] of bases) {
    const name = tagged(id, base, false);
    uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  return (id) => {
    const base = bases.get(id);
    if (base === undefined) return credentialLabel(id, t);
    const name = tagged(id, base, false);
    return (uses.get(name) ?? 0) < 2 ? name : tagged(id, base, true);
  };
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
  sourceLabel: (usageSourceId: string) => string,
  snapshots: UsageQuotaSnapshot[] = [],
): { value: string; label: string }[] {
  const label = credentialLabeler(credentials, t, sourceLabel, snapshots);
  const ids = [...new Set([...credentials.map(credentialIdFor), UNATTRIBUTED_CREDENTIAL])];
  return [
    { value: "", label: t("filters.allCredentials") },
    ...ids.map((id) => ({ value: id, label: label(id) })),
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

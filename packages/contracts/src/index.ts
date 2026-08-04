import { z } from "zod";

export const tokenShapeSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative(),
    cacheCreationInputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative(),
    reasoningOutputTokens: z.number().nonnegative(),
    totalTokens: z.number().nonnegative(),
  })
  .strict();
export const usageModeFlagsSchema = z.object({ ultra: z.boolean(), fast: z.boolean() }).strict();
const limitWindowSchema = z
  .object({
    usedPercent: z.number().nonnegative(),
    windowMinutes: z.number().int().nonnegative(),
    resetsAt: z.number().int().nonnegative(),
  })
  .strict();
export const rateLimitsSchema = z
  .object({
    limitId: z.string().max(200),
    limitName: z.string().max(200).default(""),
    planType: z.string().max(200),
    rateLimitReachedType: z.string().max(200),
    primary: limitWindowSchema.nullable(),
    secondary: limitWindowSchema.nullable(),
    credits: z
      .object({
        hasCredits: z.boolean(),
        unlimited: z.boolean(),
        balance: z.number().nonnegative(),
      })
      .strict()
      .nullable(),
    individualLimit: z
      .object({
        limitId: z.string().max(200),
        limitName: z.string().max(200),
        usedPercent: z.number().nonnegative(),
        windowMinutes: z.number().int().nonnegative(),
        resetsAt: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * One quota window as the dashboard understands it, normalized away from any
 * one harness's shape. Every measurement is optional because a source that does
 * not report a window's usage is unreported, not zero — see `quotaStatus` in
 * `apps/web/src/model/format.ts`, which renders absence as "unreported" rather
 * than a full or empty meter. `resetsAt` is an ISO instant, not the Unix epoch
 * seconds Codex emits; conversion belongs in the importer.
 */
/**
 * What SHAPE of label a window wants, so the view can render it in the reader's
 * language. `label` below is the same thing already rendered into English.
 */
export const quotaWindowKindSchema = z.enum([
  "session",
  "weekly",
  "daily",
  "hourly",
  "minute",
  "extra-usage",
]);

export const usageQuotaWindowSchema = z
  .object({
    id: z.string().min(1).max(200),
    /**
     * The window's name in English, as the server derived it.
     *
     * Required, and NOT superseded by `kind`: snapshots written before `kind`
     * existed are still sitting in ledgers, and the schema is strict, so this
     * must keep parsing them. It is also the escape hatch for a window whose
     * kind this codebase does not recognise — a new cap must still appear,
     * even if only in English.
     */
    label: z.string().min(1).max(200),
    /**
     * Optional because it is the newer half of the pair. Present, the view
     * translates; absent, the view falls back to `label`.
     */
    kind: quotaWindowKindSchema.optional(),
    /**
     * A per-model cap's model name, appended to the label. Source-owned copy —
     * Anthropic's own display name for the model — so it is never translated.
     */
    scope: z.string().min(1).max(200).optional(),
    usedPercent: z.number().nonnegative().optional(),
    windowMinutes: z.number().int().nonnegative().optional(),
    resetsAt: z.string().datetime().optional(),
  })
  .strict();
export type QuotaWindowKind = z.infer<typeof quotaWindowKindSchema>;
/**
 * A point-in-time observation of one usage source's plan quota on one host.
 * Keyed by (usageSourceId, sourceHostId): quota is a property of the account as
 * seen from a machine, so two harnesses on the same host hold separate
 * snapshots, and the same harness on two hosts does too.
 */
export const usageQuotaSnapshotSchema = z
  .object({
    usageSourceId: z.string().min(1).max(200),
    sourceHostId: z.string().min(1).max(200),
    accountScope: z.string().max(200).optional(),
    plan: z.string().max(200).optional(),
    /**
     * `credentialIdFor` of the Credential in effect when this was observed,
     * stamped by the import pipeline rather than the source. Absent means no
     * credential was observed alongside the reading — the snapshot then reads
     * as unattributed, the same statement the record attribution makes.
     */
    credentialId: z.string().min(1).max(220).optional(),
    observedAt: z.string().datetime(),
    windows: z.array(usageQuotaWindowSchema).max(50),
    balance: z
      .object({ amount: z.number(), unit: z.string().max(50) })
      .strict()
      .optional(),
  })
  .strict();
export type UsageQuotaSnapshot = z.infer<typeof usageQuotaSnapshotSchema>;
export type UsageQuotaWindow = z.infer<typeof usageQuotaWindowSchema>;

export const credentialModeSchema = z.enum([
  "subscription",
  "api-key",
  "bedrock",
  "vertex",
  "unknown",
]);

/**
 * The facts a collector can state about a credential.
 *
 * `fingerprint` is a one-way digest of an ACCOUNT identifier — 12 lowercase hex,
 * or empty when the source names no account. It exists to tell two accounts
 * apart, never to identify one, and it is never taken from key material.
 */
const credentialFacts = {
  usageSourceId: z.string().min(1).max(200),
  sourceHostId: z.string().min(1).max(200),
  mode: credentialModeSchema,
  fingerprint: z.string().regex(/^([0-9a-f]{12})?$/),
  plan: z.string().max(200).optional(),
  /** True when the mode was deduced rather than stated by the source. */
  inferred: z.boolean(),
  observedAt: z.string().datetime(),
};

/**
 * What a collector hands the ledger. `effectiveFrom` is absent BY CONSTRUCTION:
 * it means "first time this credential was seen", which only the ledger knows,
 * and a collector able to set it could backdate attribution.
 */
export const credentialSightingSchema = z.object(credentialFacts).strict();

/** A sighting the ledger has dated. */
export const credentialObservationSchema = z
  .object({ ...credentialFacts, effectiveFrom: z.string().datetime() })
  .strict();

export type CredentialMode = z.infer<typeof credentialModeSchema>;
export type CredentialSighting = z.infer<typeof credentialSightingSchema>;
export type CredentialObservation = z.infer<typeof credentialObservationSchema>;

/**
 * Bucket key and filter value. Derivable from the observation itself, so no
 * lookup is needed to group or filter by credential, and it carries a
 * fingerprint rather than an identifier.
 */
export function credentialIdFor(credential: { mode: string; fingerprint: string }): string {
  return `${credential.mode}:${credential.fingerprint}`;
}

/**
 * The bucket for records older than the earliest observation for their
 * (usage source, host). Deliberately not a valid `credentialIdFor` output, so it
 * can never collide with a real credential — including `unknown:`, which means
 * "we saw a credential and could not classify it", a different statement from
 * "we had not started looking yet".
 */
export const UNATTRIBUTED_CREDENTIAL = "unattributed";

export const usageRecordSchema = z
  .object({
    id: z.string().min(1).max(500),
    sourceHostId: z.string().min(1).max(200),
    usageSourceId: z.string().min(1).max(200),
    harnessId: z.string().min(1).max(200),
    timestamp: z.string().datetime(),
    taskName: z.string().min(1).max(500),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    reasoningLevel: z.string().min(1).max(100).optional(),
    modeFlags: usageModeFlagsSchema.default({ ultra: false, fast: false }),
    /**
     * TOTAL input, inclusive of both cache subsets below. Importers whose source
     * reports the three figures disjointly (Anthropic does) must add them up
     * before setting this, or every input-token total in the dashboard
     * under-reports by the cached volume.
     */
    inputTokens: z.number().int().nonnegative(),
    /** Input served from cache at the discounted read rate. A subset of `inputTokens`. */
    cachedInputTokens: z.number().int().nonnegative().optional(),
    /**
     * Input written INTO the cache, a disjoint subset of `inputTokens` alongside
     * `cachedInputTokens`. Separate from a cache read because the two bill at
     * opposite ends of the rate card: a read is discounted well below base input,
     * a write is charged at a premium above it. Codex reports one undifferentiated
     * cached figure and leaves this undefined, which costs identically to how it
     * always has; only a source that distinguishes the two sets it.
     */
    cacheCreationInputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative().optional(),
    totalTokens: z.number().int().nonnegative(),
    lastTokenUsage: tokenShapeSchema.nullable(),
    modelContextWindowTokens: z.number().int().nonnegative().optional(),
    source: z.string().min(1).max(200),
    sessionId: z.string().max(200).optional(),
    turnId: z.string().max(200).optional(),
  })
  .strict();
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type RateLimits = z.infer<typeof rateLimitsSchema>;
export type UsageModeFlags = z.infer<typeof usageModeFlagsSchema>;
/**
 * Carries `sourceHostId` rather than a rendered label. The label is display
 * copy: a host whose hostname is a MAC address falls back to positional wording
 * that is translated, and the analysis layer has no idea what language the
 * reader is using. Resolving the id against the catalog is the consumer's job —
 * the same split `byHarness` already uses, where the row key is the raw harness
 * id and the view renders it.
 */
export type UsageHistoryRecord = UsageRecord & {
  estimatedCost: number | null;
};

export interface SourceHost {
  id: string;
  hostname: string | null;
  platform: string;
  architecture: string;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface SourceHostObservation {
  sourceHostId: string;
  kind: "hostname" | "ip-address";
  value: string;
  firstSeenAt: string;
  lastSeenAt: string;
}
export interface HostGroup {
  id: string;
  name: string;
}
export interface HostGroupMembership {
  hostGroupId: string;
  sourceHostId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}
export interface ModelPrice {
  provider: string;
  model: string;
  input: number;
  cachedInput: number;
  /**
   * Rate for writing input into the cache. Optional because most rate cards do
   * not bill it separately; when absent, cache writes cost the base `input` rate,
   * which is exactly right for a provider that does not surcharge them.
   */
  cacheWrite?: number;
  output: number;
  source: string;
  effectiveDate: string;
}

export const timeframeSchema = z.enum(["today", "last24", "7", "30", "90", "all", "custom"]);
export type Timeframe = z.infer<typeof timeframeSchema>;
export interface UsageTotals {
  estimatedCost: number;
  pricedRecords: number;
  records: number;
  tasks: number;
  models: number;
  inputTokens: number;
  cachedInputTokens: number;
  /**
   * Cache writes across the selection. Kept out of `cachedInputTokens` so the
   * cache-efficiency ratio keeps meaning "share of input served from cache" —
   * folding writes in would let a cold run that merely populated the cache read
   * as though it had been served by one.
   */
  cacheCreationInputTokens: number;
  /**
   * Coverage for `cacheEfficiency`, which is token-weighted rather than
   * record-weighted. Both are exposed because they can diverge: a handful of large
   * calls that do not report caching can dominate token volume while looking
   * negligible as a record count. A consumer disclosing coverage should say what
   * share of TOKENS the ratio speaks for, not just how many records reported.
   */
  cacheReportingRecords: number;
  cacheReportingInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  cacheEfficiency: number;
}
export interface RankedUsage {
  key: string;
  estimatedCost: number;
  totalTokens: number;
  records: number;
  modeFlags: UsageModeFlags;
  // provider/model/reasoningLevel exist because they are structured sub-fields
  // distinct from a model row's key. There is deliberately no harnessId: for a
  // byHarness row the harness id IS `key`, so the field would only duplicate it.
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  children?: RankedUsage[];
}
export interface TimelinePoint extends UsageTotals {
  bucket: string;
}
/**
 * A snapshot as the analysis serves it. `active` marks the latest observation
 * per (usage source, host) — the credential that source is on NOW. It is
 * derived, which is why it lives on a view type rather than in the stored
 * snapshot schema a collector validates against.
 */
export interface QuotaSnapshotView extends UsageQuotaSnapshot {
  active: boolean;
}

export interface OverviewView {
  filters: UsageFilters;
  totals: UsageTotals;
  timeline: TimelinePoint[];
  byModel: RankedUsage[];
  byTask: RankedUsage[];
  bySourceHost: RankedUsage[];
  byHostGroup: RankedUsage[];
  byHarness: RankedUsage[];
  /**
   * Keyed by `credentialIdFor` output, plus the `UNATTRIBUTED_CREDENTIAL`
   * bucket for records older than the earliest observation for their source and
   * host. That bucket is never merged into a real credential — it is the guard
   * that keeps a thin signal from reading as a confident one.
   */
  byCredential: RankedUsage[];
  /**
   * The observations themselves, so a view can render a badge and label a filter
   * without a second request. Not filtered by `filters`, for the same reason
   * `quotaSnapshots` is not: which credential a machine uses is a standing fact,
   * not a property of the selected records.
   */
  credentials: CredentialObservation[];
  /**
   * The Plan limits tab's data: snapshots retained per credential, marked
   * `active` for the latest observation per (usage source, host), filtered by
   * period (on observation time), host, and credential — never by the task
   * query. Empty means nothing matching was observed, which is distinct from a
   * source reporting itself as unused.
   */
  quotaSnapshots: QuotaSnapshotView[];
}

export const filtersSchema = z
  .object({
    timeframe: timeframeSchema.default("30"),
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
    provider: z.string().max(100).optional(),
    model: z.string().max(200).optional(),
    reasoningLevel: z.string().max(100).optional(),
    query: z.string().max(500).optional(),
    sourceHostId: z.string().max(200).optional(),
    hostGroupId: z.string().max(200).optional(),
    harnessId: z.string().max(200).optional(),
    usageSourceId: z.string().max(200).optional(),
    credentialId: z.string().max(200).optional(),
  })
  .strict();
/**
 * Derived from `filtersSchema` rather than hand-written, so the two cannot
 * drift again: an earlier hand-written copy of this interface only stayed in
 * sync because someone happened to notice and patch it by hand mid-branch.
 * `timeframe` has a `.default()` in the schema, but `z.infer` (the output
 * type) still makes it required here, matching what every consumer expects.
 */
export type UsageFilters = z.infer<typeof filtersSchema>;
export const modelPriceSchema = z
  .object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    input: z.number().nonnegative(),
    cachedInput: z.number().nonnegative(),
    cacheWrite: z.number().nonnegative().optional(),
    output: z.number().nonnegative(),
    source: z.string().max(500),
    effectiveDate: z.string().max(20),
  })
  .strict();
export const dashboardActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      version: z.literal(1),
      type: z.literal("import-codex"),
      codexHome: z.string().max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("import-claude"),
      claudeHome: z.string().max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("import-grok"),
      grokHome: z.string().max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("migrate-legacy"),
      migrationId: z.string().min(1).max(200),
      records: z.array(usageRecordSchema.omit({ sourceHostId: true }).passthrough()).max(100_000),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("replace-prices"),
      prices: z.array(modelPriceSchema).max(5_000),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("clear-records"),
      confirmation: z.literal("clear-usage-records"),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      type: z.literal("set-host-group"),
      hostGroupId: z.string().min(1).max(200),
      name: z.string().min(1).max(200),
      sourceHostIds: z.array(z.string().min(1).max(200)).max(10_000),
      effectiveAt: z.string().datetime(),
    })
    .strict(),
]);
export type DashboardAction = z.infer<typeof dashboardActionSchema>;
export interface DashboardActionOutcome {
  ok: boolean;
  code: string;
  affectedRecords?: number;
}

// `exports` in package.json points only at this file (no subpath exports), so
// consumers that need the legacy decoder import it from the package root.
export { decodeUsageRecord, harnessForSource } from "./legacy.ts";

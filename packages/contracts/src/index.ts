import { z } from "zod";

export const tokenShapeSchema = z
  .object({
    inputTokens: z.number().nonnegative(),
    cachedInputTokens: z.number().nonnegative(),
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

export const usageRecordSchema = z
  .object({
    id: z.string().min(1).max(500),
    sourceHostId: z.string().min(1).max(200),
    timestamp: z.string().datetime(),
    taskName: z.string().min(1).max(500),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    reasoningLevel: z.string().max(100),
    modeFlags: usageModeFlagsSchema.default({ ultra: false, fast: false }),
    inputTokens: z.number().int().nonnegative(),
    cachedInputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    reasoningOutputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    lastTokenUsage: tokenShapeSchema.nullable(),
    modelContextWindowTokens: z.number().int().nonnegative(),
    rateLimits: rateLimitsSchema.nullable(),
    source: z.string().min(1).max(200),
    sessionId: z.string().max(200).optional(),
    turnId: z.string().max(200).optional(),
  })
  .strict();
export type UsageRecord = z.infer<typeof usageRecordSchema>;
export type RateLimits = z.infer<typeof rateLimitsSchema>;
export type UsageModeFlags = z.infer<typeof usageModeFlagsSchema>;
export type UsageHistoryRecord = Omit<UsageRecord, "sourceHostId"> & {
  sourceHostLabel: string;
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
  output: number;
  source: string;
  effectiveDate: string;
}

export const timeframeSchema = z.enum(["today", "last24", "7", "30", "90", "all", "custom"]);
export type Timeframe = z.infer<typeof timeframeSchema>;
export interface UsageFilters {
  timeframe: Timeframe;
  from?: string;
  to?: string;
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  query?: string;
  sourceHostId?: string;
  hostGroupId?: string;
}
export interface UsageTotals {
  estimatedCost: number;
  pricedRecords: number;
  records: number;
  tasks: number;
  models: number;
  inputTokens: number;
  cachedInputTokens: number;
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
  provider?: string;
  model?: string;
  reasoningLevel?: string;
  children?: RankedUsage[];
}
export interface TimelinePoint extends UsageTotals {
  bucket: string;
}
export interface OverviewView {
  filters: UsageFilters;
  totals: UsageTotals;
  timeline: TimelinePoint[];
  byModel: RankedUsage[];
  byTask: RankedUsage[];
  bySourceHost: RankedUsage[];
  byHostGroup: RankedUsage[];
  latestRateLimits: RateLimits | null;
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
  })
  .strict();
export const modelPriceSchema = z
  .object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    input: z.number().nonnegative(),
    cachedInput: z.number().nonnegative(),
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

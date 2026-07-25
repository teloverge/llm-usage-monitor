import type {
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  RankedUsage,
  SourceHost,
  UsageFilters,
  UsageHistoryRecord,
  UsageModeFlags,
  UsageRecord,
  UsageTotals,
} from "@llm-usage-monitor/contracts";

export interface AnalysisInput {
  records: UsageRecord[];
  prices: ModelPrice[];
  sourceHosts: SourceHost[];
  memberships: HostGroupMembership[];
  filters: UsageFilters;
  now?: Date;
}

export function analyzeUsage(input: AnalysisInput): OverviewView {
  const now = input.now ?? new Date();
  const selected = filterUsageRecords(input.records, input.filters, input.memberships, now);
  const priced = selected.map((record) => ({
    record,
    estimatedCost: calculateCost(record, input.prices),
  }));
  const hostNames = new Map(
    input.sourceHosts.map((host, index) => [host.id, sourceHostLabel(host, index)]),
  );
  const groupFor = (record: UsageRecord) =>
    effectiveGroup(input.memberships, record.sourceHostId, record.timestamp) ?? "Ungrouped";
  return {
    filters: input.filters,
    totals: summarize(priced),
    timeline: group(priced, ({ record }) =>
      timelineBucket(record.timestamp, input.filters.timeframe),
    ).map(({ key, items }) => ({ bucket: key, ...summarize(items) })),
    byModel: rankModels(priced),
    byTask: rank(priced, ({ record }) => record.taskName),
    bySourceHost: rank(
      priced,
      ({ record }) => hostNames.get(record.sourceHostId) ?? "Unknown Source Host",
    ),
    byHostGroup: rank(priced, ({ record }) => groupFor(record)),
    latestRateLimits:
      [...selected]
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
        .find((record) => record.rateLimits)?.rateLimits ?? null,
  };
}

export function filterUsageRecords(
  records: UsageRecord[],
  filters: UsageFilters,
  memberships: HostGroupMembership[],
  now = new Date(),
): UsageRecord[] {
  const [from, to] = timeframeRange(filters, now);
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return records.filter((record) => {
    const timestamp = Date.parse(record.timestamp);
    const groupId = effectiveGroup(memberships, record.sourceHostId, record.timestamp);
    return (
      timestamp >= from &&
      timestamp <= to &&
      (!filters.provider || record.provider === filters.provider) &&
      (!filters.model || record.model === filters.model) &&
      (!filters.reasoningLevel || record.reasoningLevel === filters.reasoningLevel) &&
      (!filters.sourceHostId || record.sourceHostId === filters.sourceHostId) &&
      (!filters.hostGroupId || groupId === filters.hostGroupId) &&
      (!query || record.taskName.toLocaleLowerCase().includes(query))
    );
  });
}

export function timeframeRange(filters: UsageFilters, now: Date): [number, number] {
  const end = now.getTime();
  if (filters.timeframe === "all") return [-Infinity, Infinity];
  if (filters.timeframe === "last24") return [end - 24 * 60 * 60 * 1_000, end];
  if (filters.timeframe === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return [start.getTime(), end];
  }
  if (filters.timeframe === "custom") {
    const from = filters.from ? Date.parse(filters.from) : -Infinity;
    const to = filters.to ? Date.parse(filters.to) : Infinity;
    return [Number.isFinite(from) ? from : -Infinity, Number.isFinite(to) ? to : Infinity];
  }
  const days = Number(filters.timeframe);
  return [end - Math.max(1, days) * 86_400_000, end];
}

export function calculateCost(record: UsageRecord, prices: ModelPrice[]): number | null {
  const price = prices.find(
    (item) =>
      normalize(item.provider) === normalize(record.provider) &&
      normalize(item.model) === normalize(record.model),
  );
  if (!price) return null;
  const cached = Math.min(record.inputTokens, record.cachedInputTokens);
  return (
    ((record.inputTokens - cached) * price.input +
      cached * price.cachedInput +
      record.outputTokens * price.output) /
    1_000_000
  );
}

export function analyzeHistory(
  records: UsageRecord[],
  prices: ModelPrice[],
  sourceHosts: SourceHost[],
): UsageHistoryRecord[] {
  const labels = new Map(sourceHosts.map((host, index) => [host.id, sourceHostLabel(host, index)]));
  return records.map((record) => {
    const { sourceHostId, ...publicRecord } = record;
    return {
      ...publicRecord,
      sourceHostLabel: labels.get(sourceHostId) ?? "Unknown Source Host",
      estimatedCost: calculateCost(record, prices),
    };
  });
}

export function sourceHostLabel(host: SourceHost, index: number): string {
  const name = host.hostname?.trim();
  return name && !looksLikeHardwareAddress(name) ? name : `Source Host ${index + 1}`;
}

function looksLikeHardwareAddress(value: string): boolean {
  return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value) || /^[0-9a-f]{12}$/i.test(value);
}

type PricedRecord = { record: UsageRecord; estimatedCost: number | null };
function summarize(items: PricedRecord[]): UsageTotals {
  const totals = items.reduce(
    (sum, { record, estimatedCost }) => ({
      estimatedCost: sum.estimatedCost + (estimatedCost ?? 0),
      pricedRecords: sum.pricedRecords + (estimatedCost === null ? 0 : 1),
      records: sum.records + 1,
      inputTokens: sum.inputTokens + record.inputTokens,
      cachedInputTokens: sum.cachedInputTokens + record.cachedInputTokens,
      outputTokens: sum.outputTokens + record.outputTokens,
      reasoningOutputTokens: sum.reasoningOutputTokens + record.reasoningOutputTokens,
      totalTokens: sum.totalTokens + record.totalTokens,
    }),
    {
      estimatedCost: 0,
      pricedRecords: 0,
      records: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
  return {
    ...totals,
    tasks: new Set(items.map(({ record }) => record.taskName)).size,
    models: new Set(items.map(({ record }) => `${record.provider}/${record.model}`)).size,
    cacheEfficiency: totals.inputTokens ? totals.cachedInputTokens / totals.inputTokens : 0,
  };
}

function rank(items: PricedRecord[], key: (item: PricedRecord) => string): RankedUsage[] {
  return group(items, key)
    .map(({ key: label, items: values }) => {
      const total = summarize(values);
      return {
        key: label,
        estimatedCost: total.estimatedCost,
        totalTokens: total.totalTokens,
        records: total.records,
        modeFlags: summarizeModes(values),
      };
    })
    .sort(
      (left, right) =>
        right.estimatedCost - left.estimatedCost || right.totalTokens - left.totalTokens,
    );
}
function rankModels(items: PricedRecord[]): RankedUsage[] {
  return group(items, ({ record }) => `${record.provider}\u0000${record.model}`)
    .map(({ items: values }) => {
      const first = values[0]!.record;
      const total = summarize(values);
      const children = rank(values, ({ record }) => record.reasoningLevel || "unknown")
        .map((child) => ({ ...child, reasoningLevel: child.key }))
        .sort(
          (left, right) =>
            reasoningOrder(left.key) - reasoningOrder(right.key) ||
            left.key.localeCompare(right.key),
        );
      return {
        key: first.model,
        provider: first.provider,
        model: first.model,
        estimatedCost: total.estimatedCost,
        totalTokens: total.totalTokens,
        records: total.records,
        modeFlags: summarizeModes(values),
        children,
      };
    })
    .sort(
      (left, right) =>
        right.estimatedCost - left.estimatedCost || right.totalTokens - left.totalTokens,
    );
}
function summarizeModes(items: PricedRecord[]): UsageModeFlags {
  return {
    ultra: items.some(({ record }) => record.modeFlags.ultra),
    fast: items.some(({ record }) => record.modeFlags.fast),
  };
}
function reasoningOrder(value: string): number {
  const order = [
    "ultra",
    "ultrathink",
    "xhigh",
    "high",
    "medium",
    "low",
    "minimal",
    "none",
    "unknown",
  ];
  const index = order.indexOf(value.trim().toLocaleLowerCase());
  return index === -1 ? order.length : index;
}
function group<T>(items: T[], key: (item: T) => string): Array<{ key: string; items: T[] }> {
  const values = new Map<string, T[]>();
  for (const item of items) {
    const label = key(item);
    values.set(label, [...(values.get(label) ?? []), item]);
  }
  return [...values]
    .map(([label, grouped]) => ({ key: label, items: grouped }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
function effectiveGroup(
  memberships: HostGroupMembership[],
  sourceHostId: string,
  timestamp: string,
): string | null {
  const at = Date.parse(timestamp);
  return (
    memberships.find(
      (membership) =>
        membership.sourceHostId === sourceHostId &&
        Date.parse(membership.effectiveFrom) <= at &&
        (!membership.effectiveTo || Date.parse(membership.effectiveTo) > at),
    )?.hostGroupId ?? null
  );
}
function timelineBucket(timestamp: string, timeframe: UsageFilters["timeframe"]): string {
  return timeframe === "last24"
    ? new Date(timestamp).toISOString().slice(0, 13) + ":00:00.000Z"
    : new Date(timestamp).toISOString().slice(0, 10);
}
function normalize(value: string): string {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized === "codex" || normalized === "openai-api" ? "openai" : normalized;
}

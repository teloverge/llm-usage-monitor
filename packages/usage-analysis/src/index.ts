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
    byTask: rankTasks(priced),
    bySourceHost: rank(
      priced,
      ({ record }) => hostNames.get(record.sourceHostId) ?? "Unknown Source Host",
    ),
    byHostGroup: rank(priced, ({ record }) => groupFor(record)),
    byHarness: rank(priced, ({ record }) => record.harnessId),
    // PLACEHOLDER (Task 9/10 of the 2026-07-24 dashboard-redesign plan): `rateLimits`
    // was removed from UsageRecord because it conflated per-record evidence with a
    // point-in-time plan-quota snapshot. There is nowhere left to read a rate-limit
    // snapshot from until Tasks 15-18 land normalized quota snapshots in the ledger
    // and thread them through here. Hardcoding `null` is the honest placeholder —
    // it does not fabricate a snapshot the ledger no longer has.
    latestRateLimits: null,
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
      (!filters.harnessId || record.harnessId === filters.harnessId) &&
      (!filters.usageSourceId || record.usageSourceId === filters.usageSourceId) &&
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
  // A source that does not report caching is costed as if nothing were cached, so
  // all input bills at the full rate. This is a deliberate assumption, not an
  // oversight: it is the conservative direction (over- rather than under-stating
  // an estimate the user reads as a spend figure), and the alternative — refusing
  // to price the record at all — would hide real usage entirely. Ratios get the
  // opposite treatment: cacheEfficiency EXCLUDES non-reporting records rather than
  // counting them as zero, because a ratio can honestly say "not measured" where a
  // total cannot.
  const cached = Math.min(record.inputTokens, record.cachedInputTokens ?? 0);
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
      cachedInputTokens: sum.cachedInputTokens + (record.cachedInputTokens ?? 0),
      cacheReportingRecords:
        sum.cacheReportingRecords + (record.cachedInputTokens === undefined ? 0 : 1),
      cacheReportingInputTokens:
        sum.cacheReportingInputTokens +
        (record.cachedInputTokens === undefined ? 0 : record.inputTokens),
      outputTokens: sum.outputTokens + record.outputTokens,
      reasoningOutputTokens: sum.reasoningOutputTokens + (record.reasoningOutputTokens ?? 0),
      totalTokens: sum.totalTokens + record.totalTokens,
    }),
    {
      estimatedCost: 0,
      pricedRecords: 0,
      records: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheReportingRecords: 0,
      cacheReportingInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  );
  return {
    ...totals,
    tasks: new Set(items.map(({ record }) => record.taskName)).size,
    models: new Set(items.map(({ record }) => `${record.provider}/${record.model}`)).size,
    // Denominator is the reporting records' input tokens, never the grand total —
    // counting a silent source's input as uncached would understate the ratio.
    cacheEfficiency: totals.cacheReportingInputTokens
      ? totals.cachedInputTokens / totals.cacheReportingInputTokens
      : 0,
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
      const children = rank(values, ({ record }) => record.reasoningLevel ?? "not reported")
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
function rankTasks(items: PricedRecord[]): RankedUsage[] {
  return group(items, ({ record }) => record.taskName)
    .map(({ key, items: values }) => {
      const total = summarize(values);
      return {
        key,
        estimatedCost: total.estimatedCost,
        totalTokens: total.totalTokens,
        records: total.records,
        modeFlags: summarizeModes(values),
        children: rank(values, ({ record }) => record.sessionId?.trim() || record.id),
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
    "not reported",
  ];
  const index = order.indexOf(value.trim().toLocaleLowerCase());
  return index === -1 ? order.length : index;
}
function group<T>(items: T[], key: (item: T) => string): Array<{ key: string; items: T[] }> {
  const values = new Map<string, T[]>();
  for (const item of items) {
    const label = key(item);
    // Push into the existing array rather than rebuilding it. Spreading on every
    // item makes this O(n²): with 6,600 records collapsing into a single group —
    // the ordinary case for bySourceHost on a one-machine ledger — the spread
    // form measures ~40ms against ~0.2ms for push.
    const bucket = values.get(label);
    if (bucket) bucket.push(item);
    else values.set(label, [item]);
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

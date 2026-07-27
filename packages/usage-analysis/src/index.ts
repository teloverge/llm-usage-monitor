import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  RankedUsage,
  UsageFilters,
  UsageHistoryRecord,
  UsageModeFlags,
  UsageQuotaSnapshot,
  UsageRecord,
  UsageTotals,
} from "@llm-usage-monitor/contracts";

export interface AnalysisInput {
  records: UsageRecord[];
  prices: ModelPrice[];
  /**
   * Optional so the many analysis tests that predate named groups keep
   * compiling. Absent means no group has a known name, and rows fall back to
   * the raw group id rather than disappearing.
   */
  hostGroups?: HostGroup[];
  memberships: HostGroupMembership[];
  filters: UsageFilters;
  /**
   * Deliberately NOT filtered by `filters`. Quota is the account's standing with
   * the provider, not a property of the selected records — narrowing the period
   * or typing in the search box must not change what the meter reads, and a
   * filter matching nothing must not render as 0% used.
   */
  quotaSnapshots?: UsageQuotaSnapshot[];
  now?: Date;
}

export function analyzeUsage(input: AnalysisInput): OverviewView {
  const now = input.now ?? new Date();
  const selected = filterUsageRecords(input.records, input.filters, input.memberships, now);
  const priced = selected.map((record) => ({
    record,
    estimatedCost: calculateCost(record, input.prices),
  }));
  const groupNames = new Map((input.hostGroups ?? []).map((group) => [group.id, group.name]));
  const groupFor = (record: UsageRecord) => {
    const groupId = effectiveGroup(input.memberships, record.sourceHostId, record.timestamp);
    return groupId === null ? "Ungrouped" : (groupNames.get(groupId) ?? groupId);
  };
  return {
    filters: input.filters,
    totals: summarize(priced),
    timeline: group(priced, ({ record }) =>
      timelineBucket(record.timestamp, input.filters.timeframe),
    ).map(({ key, items }) => ({ bucket: key, ...summarize(items) })),
    byModel: rankModels(priced),
    byTask: rankTasks(priced),
    // Keyed by raw host id, not a rendered name — exactly as `byHarness` is
    // keyed by raw harness id. The label is display copy (an unnamed host falls
    // back to translated positional wording), and this layer does not know the
    // reader's language. The view resolves the id against the host catalog.
    bySourceHost: rank(priced, ({ record }) => record.sourceHostId),
    byHostGroup: rank(priced, ({ record }) => groupFor(record)),
    byHarness: rank(priced, ({ record }) => record.harnessId),
    quotaSnapshots: currentQuota(input.quotaSnapshots ?? [], now),
  };
}

/**
 * Drops windows whose reset instant has already passed.
 *
 * Filtered here rather than in an importer because a snapshot is written once
 * and served for days afterwards: a window that was live at import goes expired
 * while sitting in SQLite, so an expiry decision taken at write time is stale
 * before it is ever read. `analyzeUsage` already carries an injectable `now`,
 * which makes this both correct and testable.
 *
 * An expired window's percentage is not merely old, it is known-wrong — the
 * window has since cleared. A snapshot left with no windows keeps its group,
 * plan, and observation time: "we know this account exists and have nothing
 * current about it" is a different statement from "no such account".
 */
export function currentQuota(snapshots: UsageQuotaSnapshot[], now: Date): UsageQuotaSnapshot[] {
  const at = now.getTime();
  return snapshots.map((snapshot) => ({
    ...snapshot,
    windows: snapshot.windows.filter((window) => {
      if (!window.resetsAt) return true;
      const resets = Date.parse(window.resetsAt);
      // An unparseable instant is not evidence of expiry.
      return Number.isNaN(resets) || resets > at;
    }),
  }));
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
  // Input is partitioned into three shares that bill at different rates: fresh,
  // read from cache, and written to cache. Reads and writes are clamped in
  // sequence and fresh takes what survives, so the shares sum to `inputTokens`
  // exactly even if a source reports subsets that overstate their total. Order
  // decides only which share absorbs a malformed overage; reads win because a
  // read is the figure sources report most reliably.
  //
  // A source that reports no caching at all is costed as if nothing were cached,
  // so every share collapses into `fresh` and all input bills at the full rate.
  // That is a deliberate assumption, not an oversight: it errs toward over- rather
  // than under-stating a figure the user reads as spend, and the alternative —
  // refusing to price the record — would hide real usage entirely. Ratios get the
  // opposite treatment: cacheEfficiency EXCLUDES non-reporting records rather than
  // counting them as zero, because a ratio can honestly say "not measured" where a
  // total cannot.
  const cacheRead = Math.min(record.inputTokens, record.cachedInputTokens ?? 0);
  const cacheWrite = Math.min(record.inputTokens - cacheRead, record.cacheCreationInputTokens ?? 0);
  const fresh = record.inputTokens - cacheRead - cacheWrite;
  return (
    (fresh * price.input +
      cacheRead * price.cachedInput +
      // Falls back to the base input rate rather than to zero: an unpriced cache
      // write is one the rate card does not surcharge, not one that is free.
      cacheWrite * (price.cacheWrite ?? price.input) +
      record.outputTokens * price.output) /
    1_000_000
  );
}

/**
 * Prices each record and passes `sourceHostId` straight through. It deliberately
 * does NOT resolve a host label: naming an unnamed host requires translated
 * wording, and this layer runs on the server with no idea of the reader's
 * language. `apps/web/src/model/source-host.ts` owns that decision.
 */
export function analyzeHistory(records: UsageRecord[], prices: ModelPrice[]): UsageHistoryRecord[] {
  return records.map((record) => ({
    ...record,
    estimatedCost: calculateCost(record, prices),
  }));
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
      cacheCreationInputTokens:
        sum.cacheCreationInputTokens + (record.cacheCreationInputTokens ?? 0),
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
      cacheCreationInputTokens: 0,
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

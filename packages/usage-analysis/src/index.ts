import type {
  CredentialObservation,
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  RankedUsage,
  UsageCostBreakdown,
  UsageFilters,
  UsageHistoryGroup,
  UsageHistorySession,
  UsageHistoryView,
  UsageModeFlags,
  UsageQuotaSnapshot,
  UsageRecord,
  UsageTotals,
} from "@llm-usage-monitor/contracts";
import { credentialIdFor, UNATTRIBUTED_CREDENTIAL } from "@llm-usage-monitor/contracts";

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
  /**
   * Optional so the analysis tests that predate credentials keep compiling.
   * Absent means nothing has been observed, and every record is unattributed —
   * which is the truthful reading, not a degraded one.
   */
  credentials?: CredentialObservation[];
  now?: Date;
}

export function analyzeUsage(input: AnalysisInput): OverviewView {
  const now = input.now ?? new Date();
  const credentials = input.credentials ?? [];
  const selected = filterUsageRecords(
    input.records,
    input.filters,
    input.memberships,
    now,
    credentials,
  );
  const priced = selected.map((record) => pricedRecord(record, input.prices));
  const groupNames = new Map((input.hostGroups ?? []).map((group) => [group.id, group.name]));
  const groupFor = (record: UsageRecord) => {
    const groupId = effectiveGroup(input.memberships, record.sourceHostId, record.timestamp);
    return groupId === null ? "Ungrouped" : (groupNames.get(groupId) ?? groupId);
  };
  const buckets = group(priced, ({ record }) =>
    timelineBucket(record.timestamp, input.filters.timeframe),
  );
  return {
    filters: input.filters,
    totals: summarize(priced),
    timeline: buckets.map(({ key, items }) => ({ bucket: key, ...summarize(items) })),
    // Nested rather than grouped on a `${bucket}|${hostId}` composite key: a
    // host id is free text and nothing stops it containing the delimiter.
    timelineBySourceHost: buckets.flatMap(({ key: bucket, items }) =>
      group(items, ({ record }) => record.sourceHostId).map(({ key, items: hostItems }) => ({
        bucket,
        sourceHostId: key,
        ...summarize(hostItems),
      })),
    ),
    byModel: rankModels(priced),
    byTask: rankTasks(priced),
    // Keyed by raw host id, not a rendered name — exactly as `byHarness` is
    // keyed by raw harness id. The label is display copy (an unnamed host falls
    // back to translated positional wording), and this layer does not know the
    // reader's language. The view resolves the id against the host catalog.
    bySourceHost: rank(priced, ({ record }) => record.sourceHostId),
    byHostGroup: rank(priced, ({ record }) => groupFor(record)),
    byHarness: rank(priced, ({ record }) => record.harnessId),
    byCredential: rank(priced, ({ record }) => credentialKey(credentials, record)),
    credentials,
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
  credentials: CredentialObservation[] = [],
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
      (!filters.credentialId || credentialKey(credentials, record) === filters.credentialId) &&
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
  const parts = costComponents(record, prices);
  return parts === null ? null : parts.input + parts.cacheRead + parts.cacheWrite + parts.output;
}

/**
 * The estimate split by rate, or null when no card matches the record's model.
 *
 * Input is partitioned into three shares that bill at different rates: fresh,
 * read from cache, and written to cache. Reads and writes are clamped in
 * sequence and fresh takes what survives, so the shares sum to `inputTokens`
 * exactly even if a source reports subsets that overstate their total. Order
 * decides only which share absorbs a malformed overage; reads win because a
 * read is the figure sources report most reliably.
 *
 * A source that reports no caching at all is costed as if nothing were cached,
 * so every share collapses into `fresh` and all input bills at the full rate.
 * That is a deliberate assumption, not an oversight: it errs toward over- rather
 * than under-stating a figure the user reads as spend, and the alternative —
 * refusing to price the record — would hide real usage entirely. Ratios get the
 * opposite treatment: cacheEfficiency EXCLUDES non-reporting records rather than
 * counting them as zero, because a ratio can honestly say "not measured" where a
 * total cannot.
 */
export function costComponents(
  record: UsageRecord,
  prices: ModelPrice[],
): UsageCostBreakdown | null {
  const price = prices.find(
    (item) =>
      normalize(item.provider) === normalize(record.provider) &&
      normalizeModel(item.model) === normalizeModel(record.model),
  );
  if (!price) return null;
  const cacheRead = Math.min(record.inputTokens, record.cachedInputTokens ?? 0);
  const cacheWrite = Math.min(record.inputTokens - cacheRead, record.cacheCreationInputTokens ?? 0);
  const fresh = record.inputTokens - cacheRead - cacheWrite;
  return {
    input: (fresh * price.input) / 1_000_000,
    cacheRead: (cacheRead * price.cachedInput) / 1_000_000,
    // Falls back to the base input rate rather than to zero: an unpriced cache
    // write is one the rate card does not surcharge, not one that is free.
    cacheWrite: (cacheWrite * (price.cacheWrite ?? price.input)) / 1_000_000,
    output: (record.outputTokens * price.output) / 1_000_000,
    cacheSavings: (cacheRead * Math.max(0, price.input - price.cachedInput)) / 1_000_000,
  };
}

function pricedRecord(record: UsageRecord, prices: ModelPrice[]): PricedRecord {
  const breakdown = costComponents(record, prices);
  return {
    record,
    breakdown,
    estimatedCost:
      breakdown === null
        ? null
        : breakdown.input + breakdown.cacheRead + breakdown.cacheWrite + breakdown.output,
  };
}

const EMPTY_BREAKDOWN: UsageCostBreakdown = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  cacheSavings: 0,
};

function addBreakdown(sum: UsageCostBreakdown, part: UsageCostBreakdown): UsageCostBreakdown {
  return {
    input: sum.input + part.input,
    cacheRead: sum.cacheRead + part.cacheRead,
    cacheWrite: sum.cacheWrite + part.cacheWrite,
    output: sum.output + part.output,
    cacheSavings: sum.cacheSavings + part.cacheSavings,
  };
}

/**
 * Model ids are matched loosely enough to survive the ways harnesses and rate
 * sources spell the same model: Claude Code reports `claude-opus-4-8` where
 * OpenRouter lists `claude-opus-4.8`, and Haiku arrives date-stamped as
 * `claude-haiku-4-5-20251001`. Version dots become dashes and a trailing
 * eight-digit date is dropped, so one card prices every spelling.
 */
function normalizeModel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .replace(/-\d{8}$/, "")
    .replace(/(\d)\.(?=\d)/g, "$1-");
}

/**
 * Groups every record into conversations — by normalized task name, then by
 * session within each — and prices them. Nothing is capped or filtered here:
 * History is the ledger's full table of contents, and the grouping is what keeps
 * it small enough to send whole (see `UsageHistoryView`).
 *
 * It deliberately does NOT resolve a host label or "not reported" wording:
 * naming an unnamed host requires translated copy, and this layer runs on the
 * server with no idea of the reader's language. Ids pass straight through and
 * `apps/web/src/model/source-host.ts` owns that decision.
 */
export function analyzeHistory(records: UsageRecord[], prices: ModelPrice[]): UsageHistoryView {
  const grouped = new Map<string, PricedRecord[]>();
  for (const record of records) {
    const key = normalizeTaskName(record.taskName);
    // push, not spread — see the note in group(): rebuilding the array per item
    // makes this O(n²) once a bucket gets large.
    const item = pricedRecord(record, prices);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(item);
    else grouped.set(key, [item]);
  }
  const groups: UsageHistoryGroup[] = [...grouped]
    .map(([key, items]) => {
      const sorted = newestFirst(items);
      const sessions = groupSessions(sorted);
      const agents = sessions.filter((session) => session.parentSessionId !== null);
      const pricedAgents = agents.filter((session) => session.estimatedCost !== null);
      return {
        key,
        taskName: sorted[0]?.record.taskName.trim() ?? "",
        sessions,
        agents: {
          sessions: agents.length,
          totalTokens: agents.reduce((sum, session) => sum + session.totalTokens, 0),
          estimatedCost: pricedAgents.length
            ? pricedAgents.reduce((sum, session) => sum + (session.estimatedCost ?? 0), 0)
            : null,
        },
        firstActiveAt: sorted.at(-1)?.record.timestamp ?? "",
        lastActiveAt: sorted[0]?.record.timestamp ?? "",
        records: sorted.length,
        totalTokens: sorted.reduce((sum, { record }) => sum + record.totalTokens, 0),
        estimatedCost: sumEstimate(sorted),
        costBreakdown: sumBreakdown(sorted),
      };
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
  return { groups, records: records.length };
}

function groupSessions(items: PricedRecord[]): UsageHistorySession[] {
  const sessions = new Map<string, PricedRecord[]>();
  for (const item of items) {
    const key = item.record.sessionId?.trim() || item.record.id;
    const bucket = sessions.get(key);
    if (bucket) bucket.push(item);
    else sessions.set(key, [item]);
  }
  const flat = [...sessions]
    .map(([key, sessionItems]): UsageHistorySession => {
      const sorted = newestFirst(sessionItems);
      const newest = sorted[0]?.record;
      return {
        key,
        parentSessionId: newest?.parentSessionId ?? null,
        agentNickname: newest?.agentNickname ?? null,
        depth: 0,
        firstActiveAt: sorted.at(-1)?.record.timestamp ?? "",
        lastActiveAt: newest?.timestamp ?? "",
        records: sorted.length,
        totalTokens: sorted.reduce((sum, { record }) => sum + record.totalTokens, 0),
        estimatedCost: sumEstimate(sorted),
        costBreakdown: sumBreakdown(sorted),
        sourceHostIds: unique(sorted.map(({ record }) => record.sourceHostId)),
        models: unique(sorted.map(({ record }) => `${record.model} · ${record.provider}`)),
        reasoningLevels: unique(sorted.map(({ record }) => record.reasoningLevel ?? null)),
        harnesses: unique(sorted.map(({ record }) => record.harnessId)),
        modeFlags: {
          ultra: sorted.some(({ record }) => record.modeFlags.ultra),
          fast: sorted.some(({ record }) => record.modeFlags.fast),
        },
      };
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
  return orderByLineage(flat);
}

/**
 * Roots newest first, each followed depth-first by the agents it spawned, with
 * `depth` filled in. A session whose parent is not in the group — the parent's
 * rollout is gone, or it was grouped elsewhere — stands as a root, still
 * flagged as an agent by its `parentSessionId`. A cycle, which no harness
 * should write, degrades to listing rather than looping.
 */
function orderByLineage(sessions: UsageHistorySession[]): UsageHistorySession[] {
  const keys = new Set(sessions.map((session) => session.key));
  const children = new Map<string, UsageHistorySession[]>();
  const roots: UsageHistorySession[] = [];
  for (const session of sessions) {
    const parent = session.parentSessionId;
    if (parent && parent !== session.key && keys.has(parent)) {
      const siblings = children.get(parent);
      if (siblings) siblings.push(session);
      else children.set(parent, [session]);
    } else roots.push(session);
  }
  const ordered: UsageHistorySession[] = [];
  const seen = new Set<string>();
  const visit = (session: UsageHistorySession, depth: number) => {
    if (seen.has(session.key)) return;
    seen.add(session.key);
    ordered.push({ ...session, depth });
    for (const child of children.get(session.key) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const session of sessions) visit(session, 0);
  return ordered;
}

function newestFirst(items: PricedRecord[]): PricedRecord[] {
  return [...items].sort(
    (left, right) => Date.parse(right.record.timestamp) - Date.parse(left.record.timestamp),
  );
}

function normalizeTaskName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function sumBreakdown(items: PricedRecord[]): UsageCostBreakdown | null {
  const priced = items.flatMap((item) => (item.breakdown ? [item.breakdown] : []));
  return priced.length ? priced.reduce(addBreakdown, EMPTY_BREAKDOWN) : null;
}

function sumEstimate(items: PricedRecord[]): number | null {
  const priced = items.filter((item) => item.estimatedCost !== null);
  return priced.length ? priced.reduce((sum, item) => sum + (item.estimatedCost ?? 0), 0) : null;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

type PricedRecord = {
  record: UsageRecord;
  estimatedCost: number | null;
  breakdown: UsageCostBreakdown | null;
};
function summarize(items: PricedRecord[]): UsageTotals {
  const totals = items.reduce(
    (sum, { record, estimatedCost, breakdown }) => ({
      estimatedCost: sum.estimatedCost + (estimatedCost ?? 0),
      costBreakdown: breakdown ? addBreakdown(sum.costBreakdown, breakdown) : sum.costBreakdown,
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
      costBreakdown: EMPTY_BREAKDOWN,
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
/**
 * The credential in effect for one (usage source, host) at one instant: the
 * observation with the greatest `effectiveFrom` at or before it.
 *
 * Unlike `effectiveGroup`, observations carry no `effectiveTo` — a credential
 * stays in effect until a different one is observed — so this scans for the
 * latest qualifying row rather than the first containing window.
 *
 * Nothing before the earliest observation qualifies. That is deliberate and is
 * the guard the whole feature rests on: the first observation says nothing about
 * the month before it, so those records stay unattributed rather than being
 * credited to a credential that may not have been in use.
 */
export function effectiveCredential(
  credentials: CredentialObservation[],
  usageSourceId: string,
  sourceHostId: string,
  timestamp: string,
): CredentialObservation | undefined {
  const at = Date.parse(timestamp);
  let latest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (credential.usageSourceId !== usageSourceId) continue;
    if (credential.sourceHostId !== sourceHostId) continue;
    const from = Date.parse(credential.effectiveFrom);
    if (Number.isNaN(from) || from > at) continue;
    if (!latest || from > Date.parse(latest.effectiveFrom)) latest = credential;
  }
  return latest;
}

function credentialKey(credentials: CredentialObservation[], record: UsageRecord): string {
  const credential = effectiveCredential(
    credentials,
    record.usageSourceId,
    record.sourceHostId,
    record.timestamp,
  );
  return credential ? credentialIdFor(credential) : UNATTRIBUTED_CREDENTIAL;
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

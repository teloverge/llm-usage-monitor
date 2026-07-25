import type { RankedUsage, UsageHistoryRecord, UsageModeFlags } from "@llm-usage-monitor/contracts";

export interface HistorySession {
  key: string;
  lastActiveAt: string;
  records: number;
  totalTokens: number;
  estimatedCost: number | null;
  sourceHosts: string[];
  models: string[];
  reasoningLevels: string[];
  plans: string[];
  modeFlags: UsageModeFlags;
}

export interface HistoryTaskGroup {
  key: string;
  label: string;
  records: UsageHistoryRecord[];
  sessions: HistorySession[];
  lastActiveAt: string;
  totalTokens: number;
  estimatedCost: number | null;
}

export interface ProviderModelGroup {
  key: string;
  label: string;
  rows: RankedUsage[];
  records: number;
  totalTokens: number;
  estimatedCost: number;
}

export function groupHistoryByTask(records: UsageHistoryRecord[]): HistoryTaskGroup[] {
  const grouped = new Map<string, UsageHistoryRecord[]>();
  for (const record of records) {
    const key = normalizeTaskName(record.taskName);
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return [...grouped]
    .map(([key, taskRecords]) => {
      const sorted = [...taskRecords].sort(
        (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
      );
      return {
        key,
        label: sorted[0]?.taskName.trim() || "Untitled task",
        records: sorted,
        sessions: groupSessions(sorted),
        lastActiveAt: sorted[0]?.timestamp ?? "",
        totalTokens: sorted.reduce((sum, record) => sum + record.totalTokens, 0),
        estimatedCost: sumEstimate(sorted),
      };
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
}

export function groupModelsByProvider(rows: RankedUsage[]): ProviderModelGroup[] {
  const providers = new Map<string, RankedUsage[]>();
  for (const row of rows) {
    const label = row.provider?.trim() || "Unknown provider";
    providers.set(label, [...(providers.get(label) ?? []), row]);
  }
  return [...providers]
    .map(([label, providerRows]) => ({
      key: label.toLocaleLowerCase(),
      label,
      rows: providerRows,
      records: providerRows.reduce((sum, row) => sum + row.records, 0),
      totalTokens: providerRows.reduce((sum, row) => sum + row.totalTokens, 0),
      estimatedCost: providerRows.reduce((sum, row) => sum + row.estimatedCost, 0),
    }))
    .sort(
      (left, right) =>
        right.estimatedCost - left.estimatedCost || right.totalTokens - left.totalTokens,
    );
}

function groupSessions(records: UsageHistoryRecord[]): HistorySession[] {
  const sessions = new Map<string, UsageHistoryRecord[]>();
  for (const record of records) {
    const key = record.sessionId?.trim() || record.id;
    sessions.set(key, [...(sessions.get(key) ?? []), record]);
  }
  return [...sessions]
    .map(([key, sessionRecords]) => {
      const sorted = [...sessionRecords].sort(
        (left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp),
      );
      return {
        key,
        lastActiveAt: sorted[0]?.timestamp ?? "",
        records: sorted.length,
        totalTokens: sorted.reduce((sum, record) => sum + record.totalTokens, 0),
        estimatedCost: sumEstimate(sorted),
        sourceHosts: unique(sorted.map((record) => record.sourceHostLabel)),
        models: unique(sorted.map((record) => `${record.model} · ${record.provider}`)),
        reasoningLevels: unique(sorted.map((record) => record.reasoningLevel || "unknown")),
        plans: unique(
          sorted.flatMap((record) =>
            record.rateLimits?.planType ? [record.rateLimits.planType] : [],
          ),
        ),
        modeFlags: {
          ultra: sorted.some((record) => record.modeFlags.ultra),
          fast: sorted.some((record) => record.modeFlags.fast),
        },
      };
    })
    .sort((left, right) => Date.parse(right.lastActiveAt) - Date.parse(left.lastActiveAt));
}

function normalizeTaskName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function sumEstimate(records: UsageHistoryRecord[]): number | null {
  const priced = records.filter((record) => record.estimatedCost !== null);
  return priced.length
    ? priced.reduce((sum, record) => sum + (record.estimatedCost ?? 0), 0)
    : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

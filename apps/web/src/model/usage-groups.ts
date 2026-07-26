import type { UsageHistoryRecord, UsageModeFlags } from "@llm-usage-monitor/contracts";

export interface HistorySession {
  key: string;
  lastActiveAt: string;
  records: number;
  totalTokens: number;
  estimatedCost: number | null;
  sourceHosts: string[];
  models: string[];
  reasoningLevels: string[];
  /**
   * Harness ids, in the order they last appeared. Raw ids, not labels — a view
   * renders them through `harnessLabel`, which is also what turns the "unknown"
   * sentinel into readable text.
   */
  harnesses: string[];
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

export function groupHistoryByTask(records: UsageHistoryRecord[]): HistoryTaskGroup[] {
  const grouped = new Map<string, UsageHistoryRecord[]>();
  for (const record of records) {
    const key = normalizeTaskName(record.taskName);
    // push, not spread — see the note in usage-analysis' group(): rebuilding the
    // array per item makes this O(n²) once a bucket gets large.
    const bucket = grouped.get(key);
    if (bucket) bucket.push(record);
    else grouped.set(key, [record]);
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

function groupSessions(records: UsageHistoryRecord[]): HistorySession[] {
  const sessions = new Map<string, UsageHistoryRecord[]>();
  for (const record of records) {
    const key = record.sessionId?.trim() || record.id;
    const bucket = sessions.get(key);
    if (bucket) bucket.push(record);
    else sessions.set(key, [record]);
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
        // "not reported" rather than "unknown": the phrasing the rest of the
        // dashboard uses for a metric a source did not supply, and it must not
        // read as a reasoning level literally named "unknown".
        reasoningLevels: unique(sorted.map((record) => record.reasoningLevel ?? "not reported")),
        harnesses: unique(sorted.map((record) => record.harnessId)),
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

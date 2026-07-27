import { createReadStream, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { RateLimits, UsageQuotaSnapshot, UsageRecord } from "@llm-usage-monitor/contracts";
import { windowLabel } from "./quota-window-label.ts";

// Bumped 4 -> 5 for Task 17: entries cached under v4 have no `rateLimits`, so
// every file must be re-parsed once to pick up its quota evidence.
const CACHE_SCHEMA_VERSION = 5;
const MAX_FILES = 100_000;

type ParsedRecord = Omit<UsageRecord, "sourceHostId">;

/**
 * Rate limits are cached per file alongside the records because the cached path
 * below skips parsing entirely. Without them here, an unchanged session file
 * would contribute its records but silently drop its quota evidence, and a run
 * where nothing changed would report no quota at all.
 */
type ImportState = {
  schemaVersion?: number;
  files?: Record<
    string,
    { fingerprint: string; records: ParsedRecord[]; rateLimits?: RateLimits | null }
  >;
  home?: string;
};
export class CodexSessionProvider {
  readonly id = "codex-local";
  async collect(
    sourceHostId: string,
    configuredHome: string | undefined,
    previousState: unknown = {},
  ) {
    const state = previousState as ImportState;
    const home = expandHome(
      configuredHome?.trim() || process.env.CODEX_HOME || join(homedir(), ".codex"),
    );
    const taskNames = await readTaskIndex(join(home, "session_index.jsonl"));
    const files = [
      ...(await walkJsonl(join(home, "sessions"))),
      ...(await walkJsonl(join(home, "archived_sessions"))),
    ].slice(0, MAX_FILES);
    const nextFiles: NonNullable<ImportState["files"]> = {};
    const records: UsageRecord[] = [];
    let parsedFiles = 0;
    // The newest observation across every file wins: quota state is a moment in
    // time, so the most recent turn's limits are the only ones still true.
    let latestRateLimits: RateLimits | null = null;
    let latestObservedAt = "";
    for (const file of files) {
      let stat;
      try {
        stat = await fs.stat(file);
      } catch {
        continue;
      }
      const fingerprint = `${stat.size}:${stat.mtimeMs}`;
      const prior = state.schemaVersion === CACHE_SCHEMA_VERSION ? state.files?.[file] : undefined;
      let parsed: ParsedRecord[];
      let rateLimits: RateLimits | null;
      if (prior?.fingerprint === fingerprint) {
        parsed = prior.records.map((record) => ({
          ...record,
          taskName: taskNames.get(record.sessionId ?? "") ?? record.taskName,
        }));
        rateLimits = prior.rateLimits ?? null;
      } else {
        const result = await parseSession(file, taskNames);
        parsed = result.records;
        rateLimits = result.rateLimits;
        parsedFiles += 1;
      }
      nextFiles[file] = { fingerprint, records: parsed, rateLimits };
      records.push(...parsed.map((record) => ({ ...record, sourceHostId })));
      const newest = parsed.at(-1)?.timestamp;
      if (rateLimits && newest && newest > latestObservedAt) {
        latestObservedAt = newest;
        latestRateLimits = rateLimits;
      }
    }
    const snapshot = quotaSnapshotFromRateLimits(
      latestRateLimits,
      sourceHostId,
      latestObservedAt || new Date().toISOString(),
    );
    return {
      records,
      quotaSnapshots: snapshot ? [snapshot] : [],
      state: {
        schemaVersion: CACHE_SCHEMA_VERSION,
        files: nextFiles,
        home,
        lastScan: new Date().toISOString(),
      },
      stats: { discoveredFiles: files.length, parsedFiles, records: records.length, home },
    };
  }
}

export async function parseSession(
  file: string,
  taskNames: Map<string, string>,
): Promise<{ records: ParsedRecord[]; rateLimits: RateLimits | null }> {
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let sessionId = sessionIdFromFilename(file);
  let provider = "openai";
  let sessionTimestamp: string | null = null;
  let currentTurn: Turn | null = null;
  let latestRateLimits: RateLimits | null = null;
  const turns: Turn[] = [];
  for await (const line of lines) {
    if (!line.trim() || line.length > 5_000_000) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = event?.payload ?? {};
    if (event.type === "session_meta") {
      sessionId = String(payload.id || sessionId);
      provider = normalizeProvider(payload.model_provider);
      sessionTimestamp = payload.timestamp || event.timestamp || sessionTimestamp;
    } else if (event.type === "turn_context") {
      const reasoningLevel = payload.effort ? String(payload.effort) : undefined;
      currentTurn = {
        turnId: String(payload.turn_id || `turn-${turns.length + 1}`),
        model: String(payload.model || "unknown"),
        reasoningLevel,
        modeFlags: usageModeFlags(payload, reasoningLevel ?? ""),
        timestamp: event.timestamp || sessionTimestamp || new Date().toISOString(),
        total: null,
        last: null,
        modelContextWindowTokens: 0,
      };
      turns.push(currentTurn);
    } else if (payload.type === "token_count") {
      if (payload.rate_limits) latestRateLimits = rateLimitShape(payload.rate_limits);
      if (currentTurn && payload.info?.total_token_usage) {
        currentTurn.total = tokenShape(payload.info.total_token_usage);
        currentTurn.last = payload.info.last_token_usage
          ? tokenShape(payload.info.last_token_usage)
          : null;
        currentTurn.modelContextWindowTokens = integer(payload.info.model_context_window);
        currentTurn.timestamp = event.timestamp || currentTurn.timestamp;
      }
    }
  }
  const taskName =
    taskNames.get(sessionId) ||
    `Codex session ${basename(dirname(file))} · ${sessionId.slice(0, 8)}`;
  let previous = tokenShape({});
  const records = turns.flatMap((turn) => {
    if (!turn.total) return [];
    const delta = subtractTokenShapes(turn.total, previous);
    previous = turn.total;
    if (delta.totalTokens <= 0 && delta.inputTokens <= 0 && delta.outputTokens <= 0) return [];
    return [
      {
        id: `codex:${sessionId}:${turn.turnId}`,
        // Hardcoded, not a placeholder: this importer only ever produces Codex-local
        // records. Task 14 is expected to source these from a usage-source registry
        // once other harnesses exist, but the values themselves are already correct.
        usageSourceId: "codex-local",
        harnessId: "codex",
        timestamp: new Date(turn.timestamp).toISOString(),
        taskName,
        provider,
        model: turn.model,
        ...(turn.reasoningLevel ? { reasoningLevel: turn.reasoningLevel } : {}),
        modeFlags: turn.modeFlags,
        ...delta,
        lastTokenUsage: turn.last,
        modelContextWindowTokens: turn.modelContextWindowTokens,
        source: "codex-local",
        sessionId,
        turnId: turn.turnId,
      },
    ];
  });
  // The file-level rate limits, not per-turn: quota is a property of the account
  // at a moment in time, and `collect` converts the newest one it sees across
  // every file into a single snapshot.
  return { records, rateLimits: latestRateLimits };
}

type Tokens = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};
type Turn = {
  turnId: string;
  model: string;
  reasoningLevel: string | undefined;
  modeFlags: { ultra: boolean; fast: boolean };
  timestamp: string;
  total: Tokens | null;
  last: Tokens | null;
  modelContextWindowTokens: number;
};
export function usageModeFlags(value: any, reasoningLevel: string) {
  const normalizedReasoning = reasoningLevel.trim().toLocaleLowerCase();
  const mode = String(value?.mode ?? "")
    .trim()
    .toLocaleLowerCase();
  const serviceTier = String(value?.service_tier ?? value?.serviceTier ?? "")
    .trim()
    .toLocaleLowerCase();
  return {
    ultra:
      normalizedReasoning === "ultra" ||
      normalizedReasoning === "ultrathink" ||
      value?.ultra === true ||
      value?.ultrathink === true,
    fast:
      value?.fast === true ||
      value?.fast_mode === true ||
      value?.fastMode === true ||
      mode === "fast" ||
      serviceTier === "priority" ||
      serviceTier === "fast",
  };
}
export function tokenShape(value: any): Tokens {
  return {
    inputTokens: integer(value?.input_tokens),
    cachedInputTokens: integer(value?.cached_input_tokens),
    outputTokens: integer(value?.output_tokens),
    reasoningOutputTokens: integer(value?.reasoning_output_tokens),
    totalTokens: integer(value?.total_tokens),
  };
}
export function subtractTokenShapes(current: Tokens, previous: Tokens): Tokens {
  const delta = (key: keyof Tokens) =>
    current[key] - previous[key] >= 0 ? current[key] - previous[key] : current[key];
  const result = {
    inputTokens: delta("inputTokens"),
    cachedInputTokens: delta("cachedInputTokens"),
    outputTokens: delta("outputTokens"),
    reasoningOutputTokens: delta("reasoningOutputTokens"),
    totalTokens: delta("totalTokens"),
  };
  result.cachedInputTokens = Math.min(result.inputTokens, result.cachedInputTokens);
  return result;
}
/** Converts a Codex rate-limit payload into a normalized quota snapshot. */
export function quotaSnapshotFromRateLimits(
  limits: RateLimits | null,
  sourceHostId: string,
  observedAt: string,
): UsageQuotaSnapshot | null {
  if (!limits) return null;
  const windows = (["primary", "secondary"] as const).flatMap((id) => {
    const window = limits[id];
    if (!window) return [];
    return [
      {
        id,
        label: windowLabel(id, window.windowMinutes),
        usedPercent: window.usedPercent,
        windowMinutes: window.windowMinutes,
        ...(window.resetsAt ? { resetsAt: new Date(window.resetsAt * 1000).toISOString() } : {}),
      },
    ];
  });
  return {
    usageSourceId: "codex-local",
    sourceHostId,
    ...(limits.planType ? { plan: limits.planType } : {}),
    observedAt,
    windows,
    ...(limits.credits && !limits.credits.unlimited
      ? { balance: { amount: limits.credits.balance, unit: "credits" } }
      : {}),
  };
}

function rateLimitShape(value: any): RateLimits {
  const window = (item: any) =>
    item && typeof item === "object"
      ? {
          usedPercent: number(item.used_percent),
          windowMinutes: integer(item.window_minutes),
          resetsAt: integer(item.resets_at),
        }
      : null;
  return {
    limitId: text(value.limit_id),
    limitName: text(value.limit_name),
    planType: text(value.plan_type),
    rateLimitReachedType: text(value.rate_limit_reached_type),
    primary: window(value.primary),
    secondary: window(value.secondary),
    credits: value.credits
      ? {
          hasCredits: Boolean(value.credits.has_credits),
          unlimited: Boolean(value.credits.unlimited),
          balance: number(value.credits.balance),
        }
      : null,
    individualLimit: value.individual_limit
      ? {
          limitId: text(value.individual_limit.limit_id),
          limitName: text(value.individual_limit.limit_name),
          usedPercent: number(value.individual_limit.used_percent),
          windowMinutes: integer(value.individual_limit.window_minutes),
          resetsAt: integer(value.individual_limit.resets_at),
        }
      : null,
  };
}
async function readTaskIndex(file: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    const lines = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.id && item.thread_name) names.set(String(item.id), String(item.thread_name));
      } catch {}
    }
  } catch {}
  return names;
}
async function walkJsonl(root: string): Promise<string[]> {
  const result: string[] = [];
  const pending = [root];
  while (pending.length && result.length < MAX_FILES) {
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(full);
    }
  }
  return result.sort();
}
function sessionIdFromFilename(file: string): string {
  return (
    basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i)?.[1] ?? basename(file, ".jsonl")
  );
}
function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`) || value.startsWith("~/") || value.startsWith("~\\"))
    return join(homedir(), value.slice(2));
  return resolve(value);
}
function normalizeProvider(value: unknown): string {
  const provider = String(value || "openai").toLocaleLowerCase();
  return provider === "codex" || provider === "openai-api" ? "openai" : provider;
}
function integer(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}
function number(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}
function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).slice(0, 200);
}

import { createReadStream, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { UsageQuotaSnapshot, UsageRecord } from "@llm-usage-monitor/contracts";
import { windowKind, windowLabel } from "./quota-window-label.ts";

const MAX_SESSIONS = 100_000;

type ParsedRecord = Omit<UsageRecord, "sourceHostId">;

const CACHE_SCHEMA_VERSION = 1;

/**
 * One cache entry for the whole home, not one per file as the Codex and Claude
 * importers keep: a Grok record is a join, so a change to EITHER the unified
 * log OR any session's metadata invalidates every cached record. The
 * fingerprint is correspondingly composite — the log plus each session's
 * `events.jsonl` and `summary.json`.
 */
type ImportState = {
  schemaVersion?: number;
  fingerprint?: string;
  records?: ParsedRecord[];
  quotaSnapshot?: UsageQuotaSnapshot | null;
  home?: string;
};

/** One token-bearing inference observation from the unified log. */
type InferenceEvent = {
  sessionId: string;
  timestamp: string;
  loopIndex: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
};

/** What one session's metadata files state about model identity and task. */
type SessionFacts = {
  timeline: Array<{ timestamp: string; model: string }>;
  currentModelId: string;
  title: string;
};

/** The freshest `billing: fetched credits config` observation in the log. */
type BillingObservation = {
  observedAt: string;
  tier: string;
  onDemandCap: number;
  onDemandUsed: number;
  periodStart: string;
  periodEnd: string;
};

/**
 * Reads Grok Build's local session metadata.
 *
 * Grok Build is the first source whose token counts and model identity live in
 * different files, so a record here is a JOIN — tokens from the global
 * `logs/unified.jsonl` (`shell.turn.inference_done`, keyed by session id, no
 * model id), model from the per-session `events.jsonl` `turn_started` timeline.
 * See ADR 0001 for why, and for why `chat_history.jsonl` (the only per-message
 * source of model ids) must never be opened: it is conversation content.
 */
export class GrokSessionProvider {
  readonly id = "grok-build-local";
  async collect(
    sourceHostId: string,
    configuredHome: string | undefined,
    previousState: unknown = {},
  ) {
    const state = previousState as ImportState;
    const home = expandHome(
      configuredHome?.trim() || process.env.GROK_HOME || join(homedir(), ".grok"),
    );
    const logFile = join(home, "logs", "unified.jsonl");
    const sessionDirectories = await findSessionDirectories(join(home, "sessions"));
    const fingerprint = await homeFingerprint(logFile, sessionDirectories);
    let parsed: ParsedRecord[];
    let snapshot: UsageQuotaSnapshot | null;
    let parsedLog = false;
    if (
      state.schemaVersion === CACHE_SCHEMA_VERSION &&
      state.fingerprint === fingerprint &&
      state.records
    ) {
      parsed = state.records;
      snapshot = state.quotaSnapshot ?? null;
    } else {
      const { inferences, billing } = await readUnifiedLog(logFile);
      parsedLog = true;
      parsed = [];
      const bySession = new Map<string, InferenceEvent[]>();
      for (const event of inferences) {
        const list = bySession.get(event.sessionId) ?? [];
        list.push(event);
        bySession.set(event.sessionId, list);
      }
      for (const [sessionId, events] of bySession) {
        const facts = await readSessionFacts(sessionDirectories.get(sessionId));
        // Keyed by record id: a log line Grok Build rewrites or replays is the
        // same observation, not a second spend.
        const byId = new Map(
          events.map((event) => {
            const record = recordFromInference(event, facts);
            return [record.id, record] as const;
          }),
        );
        parsed.push(...byId.values());
      }
      snapshot = quotaSnapshotFromBilling(billing, sourceHostId);
    }
    const records = parsed.map((record) => ({ ...record, sourceHostId }));
    return {
      records,
      quotaSnapshots: snapshot ? [{ ...snapshot, sourceHostId }] : [],
      state: {
        schemaVersion: CACHE_SCHEMA_VERSION,
        fingerprint,
        records: parsed,
        quotaSnapshot: snapshot,
        home,
        lastScan: new Date().toISOString(),
      },
      stats: { records: records.length, parsedLog, home },
    };
  }
}

function recordFromInference(event: InferenceEvent, facts: SessionFacts): ParsedRecord {
  return {
    id: `grok:${event.sessionId}:${event.timestamp}:${event.loopIndex}`,
    usageSourceId: "grok-build-local",
    harnessId: "grok-build",
    timestamp: new Date(event.timestamp).toISOString(),
    taskName: facts.title || `Grok session ${event.sessionId.slice(0, 8)}`,
    provider: "xai",
    model: modelInEffect(facts, event.timestamp),
    modeFlags: { ultra: false, fast: false },
    inputTokens: event.promptTokens,
    cachedInputTokens: Math.min(event.cachedPromptTokens, event.promptTokens),
    outputTokens: event.completionTokens,
    reasoningOutputTokens: Math.min(event.reasoningTokens, event.completionTokens),
    totalTokens: event.promptTokens + event.completionTokens,
    lastTokenUsage: null,
    source: "grok-build-local",
    sessionId: event.sessionId,
    turnId: `${event.timestamp}:${event.loopIndex}`,
  };
}

/**
 * The model in effect at an inference timestamp: the last `turn_started` at or
 * before it. An inference always follows its turn's start, so a later-only
 * timeline means clock jitter; the earliest entry is then the honest choice.
 * No timeline falls back to the summary's current model — and a model is never
 * guessed, so both absent means "unknown".
 *
 * The two timestamps come from two different files, so they are compared as
 * instants, not strings: "…00Z" sorts lexicographically AFTER "…00.500Z", and
 * a string join would hand that inference to the previous turn's model.
 */
function modelInEffect(facts: SessionFacts, timestamp: string): string {
  const at = instant(timestamp);
  let model = "";
  for (const entry of facts.timeline) {
    if (instant(entry.timestamp) <= at) model = entry.model;
  }
  if (!model) model = facts.timeline[0]?.model ?? "";
  if (!model) model = facts.currentModelId;
  return model || "unknown";
}

/** Epoch milliseconds; an unparseable timestamp sorts before everything. */
function instant(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

/**
 * `size:mtime` of the log and of every session metadata file the join reads.
 * Session directories are listed sorted so the composite is order-stable.
 */
async function homeFingerprint(
  logFile: string,
  sessionDirectories: Map<string, string>,
): Promise<string> {
  const parts: string[] = [await fileFingerprint(logFile)];
  for (const [sessionId, directory] of [...sessionDirectories.entries()].sort()) {
    parts.push(
      `${sessionId}=${await fileFingerprint(join(directory, "events.jsonl"))},${await fileFingerprint(join(directory, "summary.json"))}`,
    );
  }
  return parts.join("|");
}

async function fileFingerprint(file: string): Promise<string> {
  try {
    const stat = await fs.stat(file);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "absent";
  }
}

async function readUnifiedLog(
  file: string,
): Promise<{ inferences: InferenceEvent[]; billing: BillingObservation | null }> {
  const inferences: InferenceEvent[] = [];
  let billing: BillingObservation | null = null;
  let lines: ReturnType<typeof createInterface>;
  try {
    await fs.access(file);
    lines = createInterface({
      input: createReadStream(file, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
  } catch {
    return { inferences, billing };
  }
  for await (const line of lines) {
    if (!line.trim() || line.length > 5_000_000) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.msg === "shell.turn.inference_done" && event.sid && event.ts && event.ctx) {
      inferences.push({
        sessionId: String(event.sid),
        timestamp: String(event.ts),
        loopIndex: integer(event.ctx.loop_index),
        promptTokens: integer(event.ctx.prompt_tokens),
        cachedPromptTokens: integer(event.ctx.cached_prompt_tokens),
        completionTokens: integer(event.ctx.completion_tokens),
        reasoningTokens: integer(event.ctx.reasoning_tokens),
      });
    } else if (event?.msg === "billing: fetched credits config" && event.ts && event.ctx) {
      const observed = billingObservation(event);
      // The newest observation wins: quota is a moment in time, and only the
      // most recent reading is still true — same rule as the Codex importer.
      if (observed && (!billing || observed.observedAt > billing.observedAt)) billing = observed;
    }
  }
  return { inferences, billing };
}

function billingObservation(event: any): BillingObservation | null {
  const config = event.ctx?.config;
  if (!config || typeof config !== "object") return null;
  return {
    observedAt: String(event.ts),
    tier: text(event.ctx.subscriptionTier),
    onDemandCap: integer(config.onDemandCap?.val),
    onDemandUsed: integer(config.onDemandUsed?.val),
    periodStart: text(config.currentPeriod?.start),
    periodEnd: text(config.currentPeriod?.end),
  };
}

/**
 * The free tier caps nothing, and a zero-of-zero meter is indistinguishable
 * from an exhausted one — so with no positive cap the snapshot carries the
 * plan name alone, and the panel's "windows" section simply has nothing to
 * draw. The prepaid balance is deliberately not mapped: its unit is not stated
 * anywhere local, and inventing one would put a number on the dashboard the
 * source never asserted.
 */
function quotaSnapshotFromBilling(
  billing: BillingObservation | null,
  sourceHostId: string,
): UsageQuotaSnapshot | null {
  if (!billing) return null;
  const windows = [];
  if (billing.onDemandCap > 0) {
    const started = Date.parse(billing.periodStart);
    const ends = Date.parse(billing.periodEnd);
    const windowMinutes =
      Number.isFinite(started) && Number.isFinite(ends) && ends > started
        ? Math.round((ends - started) / 60_000)
        : 0;
    const kind = windowKind(windowMinutes);
    windows.push({
      id: "on-demand",
      label: windowLabel("on-demand", windowMinutes),
      ...(kind === undefined ? {} : { kind }),
      usedPercent: Math.min(100, (billing.onDemandUsed / billing.onDemandCap) * 100),
      ...(windowMinutes > 0 ? { windowMinutes } : {}),
      ...(Number.isFinite(ends) ? { resetsAt: new Date(ends).toISOString() } : {}),
    });
  }
  return {
    usageSourceId: "grok-build-local",
    sourceHostId,
    ...(billing.tier ? { plan: billing.tier } : {}),
    observedAt: new Date(billing.observedAt).toISOString(),
    windows,
  };
}

/**
 * Session directories sit two levels deep: `sessions/<encoded cwd>/<session id>`.
 * The map is keyed by session id, which is how the unified log names sessions.
 */
async function findSessionDirectories(root: string): Promise<Map<string, string>> {
  const directories = new Map<string, string>();
  let groups;
  try {
    groups = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return directories;
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    let entries;
    try {
      entries = await fs.readdir(join(root, group.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) directories.set(entry.name, join(root, group.name, entry.name));
      if (directories.size >= MAX_SESSIONS) return directories;
    }
  }
  return directories;
}

async function readSessionFacts(directory: string | undefined): Promise<SessionFacts> {
  const facts: SessionFacts = { timeline: [], currentModelId: "", title: "" };
  if (!directory) return facts;
  try {
    const lines = createInterface({
      input: createReadStream(join(directory, "events.jsonl"), { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.trim() || line.length > 5_000_000) continue;
      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.type === "turn_started" && event.model_id && event.ts) {
        facts.timeline.push({ timestamp: String(event.ts), model: String(event.model_id) });
      }
    }
  } catch {
    // No timeline is evidence we do not have, not a failure.
  }
  facts.timeline.sort((a, b) => instant(a.timestamp) - instant(b.timestamp));
  try {
    const summary = JSON.parse(await fs.readFile(join(directory, "summary.json"), "utf8"));
    if (summary && typeof summary === "object") {
      facts.currentModelId = text(summary.current_model_id);
      facts.title = text(summary.generated_title);
    }
  } catch {
    // Same: an absent or malformed summary only narrows what we can state.
  }
  return facts;
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`) || value.startsWith("~/") || value.startsWith("~\\"))
    return join(homedir(), value.slice(2));
  return resolve(value);
}

function integer(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).slice(0, 500);
}

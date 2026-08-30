import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { usageModeFlags } from "./codex-importer.ts";

const CACHE_SCHEMA_VERSION = 1;

type ParsedRecord = Omit<UsageRecord, "sourceHostId">;

export class OpenCodeSessionProvider {
  readonly id = "opencode-local";

  async collect(sourceHostId: string, configuredHome: string | undefined) {
    const databases = await findDatabases(configuredHome);
    const records: UsageRecord[] = [];
    for (const database of databases) {
      records.push(
        ...(await parseOpenCodeDatabase(database)).map((record) => ({ ...record, sourceHostId })),
      );
    }
    return {
      records: [...new Map(records.map((record) => [record.id, record])).values()],
      quotaSnapshots: [],
      state: {
        schemaVersion: CACHE_SCHEMA_VERSION,
        databases,
        lastScan: new Date().toISOString(),
      },
      stats: {
        home: databases[0] ? dirname(databases[0]) : defaultDataDirectories()[0]!,
        discoveredFiles: databases.length,
        records: records.length,
      },
    };
  }
}

/**
 * Reads only indexed identity, timestamp, model, and token fields. OpenCode's
 * database also contains prompts, responses, credentials, paths, and command
 * output, so this query must never widen to SELECT * or return the raw JSON.
 */
export async function parseOpenCodeDatabase(databasePath: string): Promise<ParsedRecord[]> {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const tables = new Set(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('message','session_message')",
        )
        .all()
        .map((row) => String(row.name)),
    );
    const records = new Map<string, ParsedRecord>();
    if (tables.has("message")) {
      for (const row of database
        .prepare(`SELECT id, session_id, time_created,
          json_extract(data, '$.role') AS role,
          json_extract(data, '$.providerID') AS provider_id,
          json_extract(data, '$.modelID') AS model_id,
          json_extract(data, '$.mode') AS mode,
          json_extract(data, '$.tokens.input') AS input_tokens,
          json_extract(data, '$.tokens.output') AS output_tokens,
          json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
          json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
          json_extract(data, '$.tokens.cache.write') AS cache_write_tokens
        FROM message
        WHERE json_extract(data, '$.role') = 'assistant'`)
        .all()) {
        const record = recordFromRow(row, "v1");
        if (record) records.set(record.id, record);
      }
    }
    if (tables.has("session_message")) {
      for (const row of database
        .prepare(`SELECT id, session_id, time_created,
          json_extract(data, '$.type') AS role,
          json_extract(data, '$.model.providerID') AS provider_id,
          json_extract(data, '$.model.id') AS model_id,
          json_extract(data, '$.agent') AS mode,
          json_extract(data, '$.tokens.input') AS input_tokens,
          json_extract(data, '$.tokens.output') AS output_tokens,
          json_extract(data, '$.tokens.reasoning') AS reasoning_tokens,
          json_extract(data, '$.tokens.cache.read') AS cache_read_tokens,
          json_extract(data, '$.tokens.cache.write') AS cache_write_tokens
        FROM session_message
        WHERE json_extract(data, '$.type') = 'assistant'`)
        .all()) {
        const record = recordFromRow(row, "v2");
        if (record) records.set(record.id, record);
      }
    }
    return [...records.values()];
  } finally {
    database?.close();
  }
}

function recordFromRow(row: Record<string, unknown>, generation: "v1" | "v2"): ParsedRecord | null {
  const sessionId = text(row.session_id);
  const messageId = text(row.id);
  if (!sessionId || !messageId) return null;
  const freshInput = integer(row.input_tokens);
  const cacheRead = integer(row.cache_read_tokens);
  const cacheWrite = integer(row.cache_write_tokens);
  const plainOutput = integer(row.output_tokens);
  const reasoning = integer(row.reasoning_tokens);
  const inputTokens = freshInput + cacheRead + cacheWrite;
  const outputTokens = plainOutput + reasoning;
  if (inputTokens === 0 && outputTokens === 0) return null;
  const timestamp = timestampFromEpoch(row.time_created);
  if (!timestamp) return null;
  const mode = text(row.mode);
  return {
    id: `opencode:${generation}:${sessionId}:${messageId}`,
    usageSourceId: "opencode-local",
    harnessId: "opencode",
    timestamp,
    taskName: `OpenCode session ${sessionId.slice(0, 8)}`,
    provider: text(row.provider_id).toLocaleLowerCase() || "unknown",
    model: text(row.model_id) || "unknown",
    modeFlags: usageModeFlags({ mode }, mode),
    inputTokens,
    cachedInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
    outputTokens,
    reasoningOutputTokens: reasoning,
    totalTokens: inputTokens + outputTokens,
    lastTokenUsage: null,
    source: "opencode-local",
    sessionId,
    turnId: messageId,
  };
}

async function findDatabases(configuredHome: string | undefined): Promise<string[]> {
  const explicitDatabase = process.env.OPENCODE_DB?.trim();
  if (explicitDatabase) return [resolve(expandHome(explicitDatabase))];
  const roots = configuredHome?.trim()
    ? [expandHome(configuredHome)]
    : process.env.OPENCODE_DATA_DIR?.trim()
      ? [expandHome(process.env.OPENCODE_DATA_DIR)]
      : defaultDataDirectories();
  const result = new Set<string>();
  for (const root of roots) {
    if (basename(root).match(/^opencode(?:-[A-Za-z0-9._-]+)?\.db$/)) {
      result.add(resolve(root));
      continue;
    }
    let entries;
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries)
      if (entry.isFile() && /^opencode(?:-[A-Za-z0-9._-]+)?\.db$/.test(entry.name))
        result.add(join(root, entry.name));
  }
  return [...result].sort();
}

export function defaultDataDirectories(): string[] {
  const directories = new Set<string>();
  if (process.env.XDG_DATA_HOME) directories.add(join(process.env.XDG_DATA_HOME, "opencode"));
  directories.add(join(homedir(), ".local", "share", "opencode"));
  if (process.env.LOCALAPPDATA) directories.add(join(process.env.LOCALAPPDATA, "opencode"));
  if (process.env.APPDATA) directories.add(join(process.env.APPDATA, "opencode"));
  directories.add(join(homedir(), "Library", "Application Support", "opencode"));
  return [...directories];
}

function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (/^~[\\/]/.test(value)) return join(homedir(), value.slice(2));
  return value;
}

function timestampFromEpoch(value: unknown): string | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  const date = new Date(number < 10_000_000_000 ? number * 1_000 : number);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function integer(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 500) : "";
}

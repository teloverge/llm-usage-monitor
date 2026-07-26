import { createReadStream, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import type { UsageRecord } from "@llm-usage-monitor/contracts";
import { usageModeFlags } from "./codex-importer.ts";

const CACHE_SCHEMA_VERSION = 1;
const MAX_FILES = 100_000;

type ParsedRecord = Omit<UsageRecord, "sourceHostId">;
type ImportState = {
  schemaVersion?: number;
  files?: Record<string, { fingerprint: string; records: ParsedRecord[] }>;
  home?: string;
};

/**
 * Reads Claude Code's local session transcripts.
 *
 * Unlike Codex, which reports a running cumulative total per turn and needs
 * successive differences taken, Claude reports each assistant message's own
 * usage. Records here are therefore parsed directly with no subtraction — see
 * `parseClaudeSession`, whose only real subtlety is deduplication.
 *
 * No quota snapshots: the transcripts carry no rate-limit evidence. That absence
 * surfaces as "unreported" in the dashboard rather than as an empty meter, which
 * is the honest reading — we have not observed the plan's quota, and a Claude
 * Code plan certainly has one.
 */
export class ClaudeSessionProvider {
  readonly id = "claude-code-local";
  async collect(
    sourceHostId: string,
    configuredHome: string | undefined,
    previousState: unknown = {},
  ) {
    const state = previousState as ImportState;
    const home = expandHome(
      configuredHome?.trim() || process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
    );
    const files = (await walkJsonl(join(home, "projects"))).slice(0, MAX_FILES);
    const nextFiles: NonNullable<ImportState["files"]> = {};
    const records: UsageRecord[] = [];
    let parsedFiles = 0;
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
      if (prior?.fingerprint === fingerprint) {
        parsed = prior.records;
      } else {
        parsed = await parseClaudeSession(file);
        parsedFiles += 1;
      }
      nextFiles[file] = { fingerprint, records: parsed };
      records.push(...parsed.map((record) => ({ ...record, sourceHostId })));
    }
    return {
      records,
      quotaSnapshots: [],
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

/**
 * Parses one transcript into per-message Usage Records.
 *
 * Deduplication by `message.id` is the load-bearing step, not a defensive
 * nicety. Claude Code writes one line per CONTENT BLOCK, so an assistant reply
 * containing text plus a tool call appears as two lines carrying the same
 * `message.id` and the same `usage` object — the usage describes the whole
 * response, not the block. Summing lines therefore double-counts almost every
 * turn that used a tool, which is most of them.
 */
export async function parseClaudeSession(file: string): Promise<ParsedRecord[]> {
  const lines = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let sessionId = basename(file, ".jsonl");
  let title = "";
  const byMessageId = new Map<string, ParsedRecord>();
  for await (const line of lines) {
    if (!line.trim() || line.length > 5_000_000) continue;
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.sessionId) sessionId = String(event.sessionId);
    if (event.type === "ai-title" && event.aiTitle) {
      title = String(event.aiTitle).slice(0, 400);
      continue;
    }
    if (event.type !== "assistant") continue;
    const message = event.message ?? {};
    const usage = message.usage;
    if (!usage || typeof usage !== "object") continue;
    // A synthetic message is Claude Code's local placeholder for an API error or
    // an interrupted turn. It was never a billed request, and its "model" is not
    // a model, so pricing it would invent spend.
    const model = String(message.model || "");
    if (!model || model === "<synthetic>") continue;
    const messageId = String(message.id || event.requestId || event.uuid || "");
    if (!messageId || byMessageId.has(messageId)) continue;

    const cacheRead = integer(usage.cache_read_input_tokens);
    const cacheCreation = integer(usage.cache_creation_input_tokens);
    // Anthropic reports these three disjointly; the canonical record wants the
    // inclusive total with the two cache figures as subsets of it.
    const inputTokens = integer(usage.input_tokens) + cacheRead + cacheCreation;
    const outputTokens = integer(usage.output_tokens);
    if (inputTokens <= 0 && outputTokens <= 0) continue;
    const reasoningLevel = event.effort ? String(event.effort) : undefined;
    byMessageId.set(messageId, {
      id: `claude:${sessionId}:${messageId}`,
      usageSourceId: "claude-code-local",
      harnessId: "claude-code",
      timestamp: new Date(event.timestamp || Date.now()).toISOString(),
      taskName: "",
      provider: "anthropic",
      model,
      ...(reasoningLevel ? { reasoningLevel } : {}),
      modeFlags: usageModeFlags(
        { service_tier: usage.service_tier, mode: usage.speed },
        reasoningLevel ?? "",
      ),
      inputTokens,
      cachedInputTokens: cacheRead,
      cacheCreationInputTokens: cacheCreation,
      outputTokens,
      // Deliberately absent, not zero: Anthropic does not break reasoning out of
      // the output count, and a literal 0 would read in the dashboard as "this
      // model did no reasoning" rather than "this source does not say".
      totalTokens: inputTokens + outputTokens,
      // Claude reports each message's own usage, so there is no cumulative total
      // for a "last call" figure to be distinguished from.
      lastTokenUsage: null,
      source: "claude-code-local",
      sessionId,
      turnId: messageId,
    });
  }
  const taskName = title || `Claude session ${sessionId.slice(0, 8)}`;
  return [...byMessageId.values()].map((record) => ({ ...record, taskName }));
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
function expandHome(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith(`~${sep}`) || value.startsWith("~/") || value.startsWith("~\\"))
    return join(homedir(), value.slice(2));
  return resolve(value);
}
function integer(value: unknown): number {
  return Math.max(0, Math.round(Number(value) || 0));
}

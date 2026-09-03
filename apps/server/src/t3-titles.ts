import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Which harness a T3 thread was driving. These are T3's own provider names,
 * matched verbatim against its `provider_session_runtime.provider_name`.
 */
export type T3Harness = "codex" | "claudeAgent";

const MAX_TITLE_LENGTH = 400;
/** T3's placeholder for a thread whose title has not been generated yet. */
const PLACEHOLDER_TITLE = "New thread";

/**
 * T3 keeps its state under `$T3CODE_HOME/userdata` (it exports that variable
 * to the harnesses it launches), defaulting to `~/.t3`.
 */
export function t3StateDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.T3CODE_HOME?.trim() || join(homedir(), ".t3");
  return join(home, "userdata", "state.sqlite");
}

/**
 * Reads the conversation titles T3 gave its threads, keyed by the harness
 * session each thread was driving. A Codex or Claude Code session started from
 * T3 has no title of its own worth showing — Codex's index says "Clarify task"
 * or nothing, and Claude's ai-title is a different generation from the one the
 * user actually sees — so the T3 title is the one they will recognize.
 *
 * The join is `provider_session_runtime` → `projection_threads`. The runtime
 * row's resume cursor names the harness session: `threadId` for Codex (which
 * calls its sessions threads) and `resume` for Claude Code (the argument it
 * would pass to `--resume`). Only the title and that cursor are read; T3's
 * database also holds every message of every thread, and this query must never
 * widen to touch `projection_thread_messages` or the event log.
 *
 * Never throws. A host without T3, a database from a T3 version with different
 * tables, or a file this process cannot open all read as "no titles", which is
 * exactly the state before this reader existed — a title source must not be
 * able to fail an import.
 */
export async function readT3ConversationTitles(
  harness: T3Harness,
  databasePath: string = t3StateDatabasePath(),
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  try {
    await fs.access(databasePath);
  } catch {
    return titles;
  }
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const rows = database
      .prepare(
        `SELECT runtime.resume_cursor_json AS cursor, thread.title AS title
         FROM provider_session_runtime AS runtime
         JOIN projection_threads AS thread ON thread.thread_id = runtime.thread_id
         WHERE runtime.provider_name = ?`,
      )
      .all(harness);
    for (const row of rows) {
      const sessionId = sessionIdFromCursor(harness, row.cursor);
      const title = cleanTitle(row.title);
      if (sessionId && title) titles.set(sessionId, title);
    }
  } catch {
    // Fall through: nothing observed.
  } finally {
    database?.close();
  }
  return titles;
}

function sessionIdFromCursor(harness: T3Harness, cursor: unknown): string {
  if (typeof cursor !== "string") return "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return "";
  }
  if (!parsed || typeof parsed !== "object") return "";
  const field = harness === "codex" ? "threadId" : "resume";
  const value = (parsed as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const title = value.trim().slice(0, MAX_TITLE_LENGTH);
  return title === PLACEHOLDER_TITLE ? "" : title;
}

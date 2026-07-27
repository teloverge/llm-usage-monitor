import { promises as fs } from "node:fs";
import { join } from "node:path";

/**
 * The config file accumulates a project history the monitor does not control,
 * so its size is not bounded by anything we can reason about. 32 MB is far
 * above any plausible real file and far below anything that would hurt to read.
 */
const MAX_CONFIG_BYTES = 32 * 1024 * 1024;

/**
 * Locates and parses Claude Code's config file.
 *
 * The quota evidence is NOT in the transcripts — see `claude-importer.ts` — it
 * is in this file, which sits BESIDE the `~/.claude` home under the default
 * layout and INSIDE it under `CLAUDE_CONFIG_DIR`. Both are probed, in that
 * order, and the first one that parses wins.
 *
 * Every failure path returns null rather than throwing. This file belongs to
 * another program, is undocumented, and is reshaped without notice; an import
 * that found a transcript must not fail because a config file it also happened
 * to look at was unreadable.
 */
export async function readClaudeConfig(
  home: string,
  maxBytes: number = MAX_CONFIG_BYTES,
): Promise<Record<string, unknown> | null> {
  for (const candidate of [join(home, ".claude.json"), `${home}.json`]) {
    let raw: string;
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile() || stat.size > maxBytes) continue;
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable is evidence we do not have, not a reason to stop looking.
    }
  }
  return null;
}

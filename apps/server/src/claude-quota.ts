import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { UsageQuotaSnapshot, UsageQuotaWindow } from "@llm-usage-monitor/contracts";
import { windowLabel } from "./quota-window-label.ts";

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

/** Contract cap on `windows`; exceeding it throws at the ledger. */
const MAX_WINDOWS = 50;

/**
 * Labels for the kinds Anthropic ships today. `weekly_scoped` shares the weekly
 * label because the scope name is appended to it, giving "Weekly window · Fable".
 */
const KIND_LABELS: Record<string, string> = {
  session: "Session window",
  weekly_all: "Weekly window",
  weekly_scoped: "Weekly window",
};

/**
 * Maps Claude Code's cached utilization block into a normalized snapshot.
 *
 * Driven by `utilization.limits`, not by the sibling `five_hour` / `seven_day`
 * fields, because the array is Anthropic's own normalized list and the fields
 * beside it are experiment slots — a real account carries half a dozen null
 * codenames (`tangelo`, `iguana_necktie`, `omelette_promotional`) that come and
 * go. Reading the array means a new per-model cap appears with no code change.
 *
 * Every field is treated as optional and every unreadable value is omitted
 * rather than defaulted, so a reshaped cache degrades to fewer meters instead
 * of wrong ones.
 */
export function claudeQuotaSnapshot(
  config: unknown,
  sourceHostId: string,
): UsageQuotaSnapshot | null {
  const root = asRecord(config);
  const cached = asRecord(root?.cachedUsageUtilization);
  const utilization = asRecord(cached?.utilization);
  if (!cached || !utilization) return null;
  const observedAt = instant(cached.fetchedAtMs);
  if (!observedAt) return null;
  const plan = planLabel(asRecord(root?.oauthAccount));
  return {
    usageSourceId: "claude-code-local",
    sourceHostId,
    ...(plan ? { plan } : {}),
    observedAt,
    windows: quotaWindows(utilization).slice(0, MAX_WINDOWS),
  };
}

function quotaWindows(utilization: Record<string, unknown>): UsageQuotaWindow[] {
  const limits = Array.isArray(utilization.limits) ? utilization.limits : [];
  const durations = statedDurations(utilization);
  const windows: UsageQuotaWindow[] = [];
  const taken = new Set<string>();
  for (const entry of limits) {
    const limit = asRecord(entry);
    if (!limit) continue;
    const kind = text(limit.kind);
    if (!kind) continue;
    const scope = scopeName(limit);
    const resetsAt = instant(limit.resets_at);
    const windowMinutes = resetsAt === undefined ? undefined : durations.get(resetsAt);
    const usedPercent = nonNegative(limit.percent);
    windows.push({
      // Unique because it is the React key, and `weekly_scoped` legitimately
      // repeats once per scoped model.
      id: unique(taken, scope ? `${kind}:${slug(scope)}` : kind),
      label: capped(label(kind, scope, windowMinutes)),
      ...(usedPercent === undefined ? {} : { usedPercent }),
      ...(windowMinutes === undefined ? {} : { windowMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    });
  }
  return windows;
}

/**
 * Window lengths as the cache states them, keyed by reset instant.
 *
 * `limits[]` carries no duration, and hardcoding "session means 300 minutes"
 * would put a number on screen that no source said. Instead: when a limit's
 * reset instant matches `five_hour`'s or `seven_day`'s exactly, the field NAME
 * is Anthropic stating that window's length, and the match is what licenses us
 * to use it. No match, no duration.
 */
function statedDurations(utilization: Record<string, unknown>): Map<string, number> {
  const durations = new Map<string, number>();
  for (const [field, minutes] of [
    ["five_hour", 300],
    ["seven_day", 10_080],
  ] as const) {
    const at = instant(asRecord(utilization[field])?.resets_at);
    if (at) durations.set(at, minutes);
  }
  return durations;
}

function label(kind: string, scope: string | undefined, windowMinutes: number | undefined): string {
  const base =
    windowMinutes === undefined ? (KIND_LABELS[kind] ?? humanize(kind)) : windowLabel(kind, windowMinutes);
  return scope ? `${base} · ${scope}` : base;
}

/** `monthly_all` -> `Monthly all`. Ugly beats absent: a new cap must appear. */
function humanize(kind: string): string {
  const spaced = kind.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function scopeName(limit: Record<string, unknown>): string | undefined {
  return text(asRecord(asRecord(limit.scope)?.model)?.display_name);
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function unique(taken: Set<string>, base: string): string {
  let id = capped(base);
  for (let suffix = 2; taken.has(id); suffix += 1) id = capped(`${base}-${suffix}`);
  taken.add(id);
  return id;
}

function planLabel(account: Record<string, unknown> | null): string | undefined {
  const tier = text(account?.organizationRateLimitTier);
  // The tier names the plan precisely ("claude_max_20x"); the type is coarser
  // ("claude_max") and only used when the tier is missing.
  return tier ? capped(tier.replace(/^default_/, "")) : text(account?.organizationType);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** ISO instant in UTC, or undefined. Offsets and epoch millis both normalize. */
function instant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const at = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

function nonNegative(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? capped(value.trim()) : undefined;
}

function capped(value: string): string {
  return value.slice(0, 200);
}

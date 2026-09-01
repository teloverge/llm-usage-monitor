import { usageRecordSchema, type UsageRecord } from "./index.ts";

const HARNESS_BY_SOURCE: Record<string, string> = {
  "codex-local": "codex",
  "claude-code-local": "claude-code",
  "grok-build-local": "grok-build",
  "opencode-local": "opencode",
};

/**
 * Maps a usage source id to its harness.
 *
 * An unregistered source resolves to "unknown" rather than to a name derived from
 * the source id. Deriving one (stripping "-local", say) would turn "windsurf-local"
 * into a tidy "windsurf" that is indistinguishable in the Overview's By-harness
 * panel from a real, registered harness — plausible and wrong. "unknown" is
 * visibly wrong, which is the failure mode we want: it says a source needs
 * registering rather than quietly inventing a grouping bucket.
 */
export function harnessForSource(usageSourceId: string): string {
  return HARNESS_BY_SOURCE[usageSourceId] ?? "unknown";
}

/**
 * Upgrades a stored Usage Record to the canonical shape, then validates it.
 * Records written before the identity migration carry `source` but no
 * `usageSourceId`/`harnessId`, and embed Codex-shaped `rateLimits`.
 *
 * Only a missing identity field gets a fallback. One that is present with a
 * non-string value stays as-is so schema validation rejects the record,
 * rather than being coerced into a "[object Object]" id that would validate.
 */
export function decodeUsageRecord(value: unknown): UsageRecord {
  const record = { ...(value as Record<string, unknown>) };
  record.usageSourceId ??= record.source ?? "unknown";
  const usageSourceId = record.usageSourceId;
  record.harnessId ??=
    typeof usageSourceId === "string" ? harnessForSource(usageSourceId) : "unknown";
  record.source ??= usageSourceId;
  delete record.rateLimits;
  const reasoning = typeof record.reasoningLevel === "string" ? record.reasoningLevel.trim() : "";
  if (!reasoning || reasoning.toLocaleLowerCase() === "unknown") delete record.reasoningLevel;
  return usageRecordSchema.parse(record);
}

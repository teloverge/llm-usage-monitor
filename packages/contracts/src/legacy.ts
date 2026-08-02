import { usageRecordSchema, type UsageRecord } from "./index.ts";

const HARNESS_BY_SOURCE: Record<string, string> = {
  "codex-local": "codex",
  "claude-code-local": "claude-code",
  "grok-build-local": "grok-build",
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
 */
export function decodeUsageRecord(value: unknown): UsageRecord {
  const record = { ...(value as Record<string, unknown>) };
  const usageSourceId = String(record.usageSourceId ?? record.source ?? "unknown");
  record.usageSourceId = usageSourceId;
  record.harnessId = String(record.harnessId ?? harnessForSource(usageSourceId));
  record.source = String(record.source ?? usageSourceId);
  delete record.rateLimits;
  const reasoning = String(record.reasoningLevel ?? "").trim();
  if (!reasoning || reasoning.toLocaleLowerCase() === "unknown") delete record.reasoningLevel;
  return usageRecordSchema.parse(record);
}

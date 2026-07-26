import { harnessForSource } from "@llm-usage-monitor/contracts";

const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

/**
 * Display label for a harness id. An id we do not recognise — including the
 * "unknown" sentinel a legacy or unregistered usage source decodes to — renders as
 * "Unknown harness" rather than a bare token, so it reads as a state rather than as
 * the name of something the user installed.
 */
export function harnessLabel(harnessId: string): string {
  return HARNESS_LABELS[harnessId] ?? (harnessId === "unknown" ? "Unknown harness" : harnessId);
}

/** True when the id is not a harness we know how to name. Callers style these apart. */
export function isUnknownHarness(harnessId: string): boolean {
  return !(harnessId in HARNESS_LABELS);
}

/**
 * Display label for a USAGE SOURCE id, for panels keyed by source rather than by
 * harness — the quota meters, where each row is one account on one host.
 *
 * Derived from `harnessLabel` rather than from a second lookup table, so the two
 * cannot drift into disagreeing about what "Codex" is called.
 *
 * Unregistered sources fall back to the raw source id, NOT to "Unknown harness".
 * `harnessForSource` maps every unregistered source to the same "unknown"
 * sentinel, so labelling by harness would render two different accounts'
 * quota meters identically while showing different percentages — the reader
 * could not tell which was which. The raw id is ugly on purpose: it stays
 * distinguishable and still reads as something needing registration.
 */
export function usageSourceLabel(usageSourceId: string): string {
  const harnessId = harnessForSource(usageSourceId);
  return isUnknownHarness(harnessId) ? usageSourceId : harnessLabel(harnessId);
}

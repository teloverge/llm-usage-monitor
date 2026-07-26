import { harnessForSource } from "@llm-usage-monitor/contracts";
import { SERIES } from "../theme/palette.ts";

const HARNESS_LABELS: Record<string, string> = {
  codex: "Codex",
  "claude-code": "Claude Code",
};

/**
 * Series colour per harness, assigned by entity rather than by rank so a
 * harness keeps the same swatch wherever it appears. Anything unregistered
 * shares the third slot: the dot is an aid to scanning, not an identifier, and
 * the label beside it is what actually distinguishes the row.
 */
const HARNESS_COLORS: Record<string, string> = {
  codex: SERIES.teal,
  "claude-code": SERIES.blue,
};

export function harnessColor(harnessId: string): string {
  return HARNESS_COLORS[harnessId] ?? SERIES.orange;
}

/**
 * Display label for a harness id. An id we do not recognise — including the
 * "unknown" sentinel a legacy or unregistered usage source decodes to — renders
 * as the caller's `unknownLabel` rather than a bare token, so it reads as a
 * state rather than as the name of something the user installed.
 *
 * The wording is injected rather than held here because it is translated and
 * `model/` never imports `t`. This is the same idiom `RankList` uses for its
 * `emptyLabel` prop. The names IN the table are product names and are never
 * translated in any locale.
 */
export function harnessLabel(harnessId: string, unknownLabel: string): string {
  return HARNESS_LABELS[harnessId] ?? (harnessId === "unknown" ? unknownLabel : harnessId);
}

/** True when the id is not a harness we know how to name. Callers style these apart. */
export function isUnknownHarness(harnessId: string): boolean {
  return !(harnessId in HARNESS_LABELS);
}

/**
 * Display label for a USAGE SOURCE id, for panels keyed by source rather than by
 * harness — the quota meters, where each row is one account on one host.
 *
 * Reads the same `HARNESS_LABELS` table as `harnessLabel`, so the two cannot
 * drift into disagreeing about what "Codex" is called. It resolves only to names
 * that table holds, never to the unknown state, so it needs no translated
 * wording and takes no such parameter.
 *
 * Unregistered sources fall back to the raw source id, NOT to the unknown label.
 * `harnessForSource` maps every unregistered source to the same "unknown"
 * sentinel, so labelling by harness would render two different accounts' quota
 * meters identically while showing different percentages — the reader could not
 * tell which was which. The raw id is ugly on purpose: it stays distinguishable
 * and still reads as something needing registration.
 */
export function usageSourceLabel(usageSourceId: string): string {
  return HARNESS_LABELS[harnessForSource(usageSourceId)] ?? usageSourceId;
}

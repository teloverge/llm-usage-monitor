import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHART_INK,
  CHART_SURFACE,
  PAGE_SURFACE,
  SERIES,
  STATUS,
  UI_ACCENT,
} from "../src/theme/palette.ts";

const source = readFileSync(
  fileURLToPath(new URL("../src/theme/tokens.css", import.meta.url)),
  "utf8",
);

/**
 * Only tokens that have a TypeScript twin. The other 16 (sizes, radii, gap, rail,
 * and UI-only colours with no chart-side counterpart) are deliberately excluded —
 * there is nothing to compare them against, and layout drift fails loudly on screen
 * rather than quietly shifting a colour.
 *
 * Twinning a new token means adding a row here. That is the point: the table is the
 * registry of what must stay in sync.
 */
const TWINNED: Array<[string, string]> = [
  ["--page", PAGE_SURFACE],
  ["--panel", CHART_SURFACE],
  ["--accent", UI_ACCENT],
  ["--series-1", SERIES.teal],
  ["--series-2", SERIES.blue],
  ["--series-3", SERIES.orange],
  ["--status-good", STATUS.good],
  ["--status-warning", STATUS.warning],
  ["--status-critical", STATUS.critical],
  ["--grid", CHART_INK.grid],
  ["--axis", CHART_INK.axis],
  ["--muted", CHART_INK.muted],
  ["--track", CHART_INK.track],
];

function declaredValue(token: string): string {
  // Anchored to line start so `--panel` cannot match inside `--pad-panel`.
  const match = source.match(new RegExp(`^\\s*${token}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "m"));
  assert.ok(match, `${token} is not declared in tokens.css`);
  return match[1]!.toLowerCase();
}

describe("Token and palette agreement", () => {
  for (const [token, expected] of TWINNED) {
    it(`${token} matches its palette.ts twin`, () => {
      assert.equal(declaredValue(token), expected.toLowerCase());
    });
  }
});

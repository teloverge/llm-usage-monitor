import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CHART_INK,
  CHART_SURFACE,
  LIGHT_PALETTE,
  LIGHT_UI_ACCENT,
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

const LIGHT_TWINNED: Array<[string, string]> = [
  ["--page", LIGHT_PALETTE.page],
  ["--panel", LIGHT_PALETTE.surface],
  ["--accent", LIGHT_UI_ACCENT],
  ["--series-1", LIGHT_PALETTE.series.teal],
  ["--series-2", LIGHT_PALETTE.series.blue],
  ["--series-3", LIGHT_PALETTE.series.orange],
  ["--status-good", LIGHT_PALETTE.status.good],
  ["--status-warning", LIGHT_PALETTE.status.warning],
  ["--status-critical", LIGHT_PALETTE.status.critical],
  ["--grid", LIGHT_PALETTE.ink.grid],
  ["--axis", LIGHT_PALETTE.ink.axis],
  ["--muted", LIGHT_PALETTE.ink.muted],
  ["--track", LIGHT_PALETTE.ink.track],
];

/** The dark tokens are declared first; the light ones live in the media block after them. */
const LIGHT_MARKER = "@media (prefers-color-scheme: light)";
const lightSource = source.slice(source.indexOf(LIGHT_MARKER));

function declaredValue(token: string, from = source): string {
  // Anchored to line start so `--panel` cannot match inside `--pad-panel`.
  const match = from.match(new RegExp(`^\\s*${token}:\\s*(#[0-9a-fA-F]{3,8})\\s*;`, "m"));
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

describe("Light token and palette agreement", () => {
  it("declares a light scheme block", () => {
    assert.ok(source.includes(LIGHT_MARKER));
  });

  for (const [token, expected] of LIGHT_TWINNED) {
    it(`light ${token} matches its LIGHT_PALETTE twin`, () => {
      assert.equal(declaredValue(token, lightSource), expected.toLowerCase());
    });
  }
});

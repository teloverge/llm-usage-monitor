import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, oklabLightness } from "../src/theme/color-math.ts";
import {
  CHART_SURFACE,
  LIGHT_PALETTE,
  LIGHT_UI_ACCENT,
  SERIES,
  STATUS,
  UI_ACCENT,
} from "../src/theme/palette.ts";

describe("Chart palette gates", () => {
  it("keeps every series color inside the dark-surface lightness band", () => {
    for (const hex of Object.values(SERIES)) {
      const lightness = oklabLightness(hex);
      assert.ok(
        lightness >= 0.48 && lightness <= 0.67,
        `${hex} lightness ${lightness.toFixed(3)} is outside 0.48-0.67`,
      );
    }
  });

  it("keeps every series color at or above 3:1 against the chart surface", () => {
    for (const hex of Object.values(SERIES)) {
      const ratio = contrastRatio(hex, CHART_SURFACE);
      assert.ok(ratio >= 3, `${hex} contrast ${ratio.toFixed(2)} is below 3:1`);
    }
  });

  it("keeps every status color at or above 3:1 against the chart surface", () => {
    for (const hex of Object.values(STATUS)) {
      const ratio = contrastRatio(hex, CHART_SURFACE);
      assert.ok(ratio >= 3, `${hex} contrast ${ratio.toFixed(2)} is below 3:1`);
    }
  });

  it("excludes the UI accent from the series set because it fails the band", () => {
    assert.ok(oklabLightness(UI_ACCENT) > 0.67);
    assert.ok(!(Object.values(SERIES) as string[]).includes(UI_ACCENT));
  });

  // These exact values were validated by an external palette validator for CVD
  // (colour-blind) separation and normal-vision ΔE — checks this repo does NOT
  // re-derive (see task notes: porting a subtly wrong CVD simulation matrix would
  // be worse than no check at all). This test does not validate CVD or ΔE itself;
  // it only pins the values so that changing any of them is a deliberate, visible
  // diff rather than a silent drift that still passes the band/contrast gates
  // above. Changing any value here requires re-running the external validator.
  it("pins externally validated colours so a change must be deliberate", () => {
    assert.deepEqual(SERIES, { teal: "#0fae83", blue: "#3987e5", orange: "#d95926" });
    assert.deepEqual(STATUS, { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" });
    assert.equal(UI_ACCENT, "#16c79a");
    // Re-pinned when the surfaces were de-tinted from green to neutral grey. The
    // externally validated values above did NOT change and did not need
    // re-validating: CVD separation and ΔE are properties of the series colours
    // against each other, not of the surface. The surface only enters the contrast
    // gate above, which every colour still clears with more margin than before.
    assert.equal(CHART_SURFACE, "#17191b");
  });
});

describe("Light chart palette gates", () => {
  it("keeps every series color inside the light-surface lightness band", () => {
    for (const hex of Object.values(LIGHT_PALETTE.series)) {
      const lightness = oklabLightness(hex);
      assert.ok(
        lightness >= 0.43 && lightness <= 0.77,
        `${hex} lightness ${lightness.toFixed(3)} is outside 0.43-0.77`,
      );
    }
  });

  it("keeps every series and status color at or above 3:1 against the light surface", () => {
    for (const hex of [
      ...Object.values(LIGHT_PALETTE.series),
      ...Object.values(LIGHT_PALETTE.status),
    ]) {
      const ratio = contrastRatio(hex, LIGHT_PALETTE.surface);
      assert.ok(ratio >= 3, `${hex} contrast ${ratio.toFixed(2)} is below 3:1`);
    }
  });

  it("keeps the light accent readable as text on the page and under white text", () => {
    assert.ok(contrastRatio(LIGHT_UI_ACCENT, LIGHT_PALETTE.page) >= 4.5);
    assert.ok(contrastRatio(LIGHT_UI_ACCENT, "#ffffff") >= 4.5);
  });

  // Pinned for the same reason as the dark set: these passed the external
  // validator's CVD and ΔE gates, which this suite does not re-derive.
  it("pins externally validated light colours so a change must be deliberate", () => {
    assert.deepEqual(LIGHT_PALETTE.series, {
      teal: "#0b8f6b",
      blue: "#2f73d1",
      orange: "#c4501f",
    });
    assert.equal(LIGHT_PALETTE.surface, "#ffffff");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrastRatio, oklabLightness } from "../src/theme/color-math.ts";
import { CHART_SURFACE, SERIES, STATUS, UI_ACCENT } from "../src/theme/palette.ts";

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

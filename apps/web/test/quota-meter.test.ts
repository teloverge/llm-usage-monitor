import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageQuotaWindow } from "@llm-usage-monitor/contracts";
import { quotaMeterView } from "../src/model/quota-meter.ts";

const window = (usedPercent?: number): UsageQuotaWindow => ({
  id: "primary",
  label: "5-hour window",
  ...(usedPercent === undefined ? {} : { usedPercent }),
});

describe("Quota meter view", () => {
  it("reports an unreported window as having nothing to show or draw", () => {
    const view = quotaMeterView(window());
    assert.equal(view.status, "unreported");
    assert.equal(view.shown, null);
    assert.equal(view.width, 0);
  });

  // Zero is a measurement: the source said "none used". It must not collapse
  // into the same rendering as "did not say".
  it("distinguishes a reported zero from an unreported window", () => {
    const view = quotaMeterView(window(0));
    assert.equal(view.status, "good");
    assert.equal(view.shown, 0);
    assert.equal(view.width, 0);
  });

  it("rounds the displayed percentage to a whole number", () => {
    assert.equal(quotaMeterView(window(41.5)).shown, 42);
    assert.equal(quotaMeterView(window(78.25)).shown, 78);
  });

  // The defect this module exists to prevent. Classifying the raw value while
  // displaying the rounded one shows "90%" in warning colour, contradicting the
  // spec's own 90 = critical threshold on the same line.
  it("classifies the value it displays, not the raw one", () => {
    const view = quotaMeterView(window(89.6));
    assert.equal(view.shown, 90, "displays 90%");
    assert.equal(view.status, "critical", "so it must be styled critical, not warning");
  });

  it("keeps a value that rounds down below the threshold as a warning", () => {
    const view = quotaMeterView(window(89.4));
    assert.equal(view.shown, 89);
    assert.equal(view.status, "warning");
  });

  it("holds the documented thresholds", () => {
    assert.equal(quotaMeterView(window(74)).status, "good");
    assert.equal(quotaMeterView(window(75)).status, "warning");
    assert.equal(quotaMeterView(window(89)).status, "warning");
    assert.equal(quotaMeterView(window(90)).status, "critical");
  });

  it("clamps the fill without hiding real overage in the figure", () => {
    const view = quotaMeterView(window(137));
    assert.equal(view.width, 100, "the bar cannot exceed its track");
    assert.equal(view.shown, 137, "but the number still reports the truth");
    assert.equal(view.status, "critical");
  });
});

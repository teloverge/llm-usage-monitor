import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { windowLabel } from "../src/quota-window-label.ts";

describe("windowLabel", () => {
  it("derives the label from the reported length, not the slot name", () => {
    assert.equal(windowLabel("primary", 300), "5-hour window");
    assert.equal(windowLabel("secondary", 10_080), "Weekly window");
    // A slot named "primary" whose length is three hours must not claim five.
    assert.equal(windowLabel("primary", 180), "3-hour window");
  });

  it("names multi-week and multi-day windows", () => {
    assert.equal(windowLabel("x", 20_160), "2-week window");
    assert.equal(windowLabel("x", 1_440), "Daily window");
    assert.equal(windowLabel("x", 2_880), "2-day window");
  });

  it("falls back to minutes when the length divides into nothing larger", () => {
    assert.equal(windowLabel("x", 90), "90-minute window");
  });

  it("falls back to the slot name when no length is reported", () => {
    assert.equal(windowLabel("primary", 0), "5-hour window");
    assert.equal(windowLabel("secondary", 0), "Weekly window");
    assert.equal(windowLabel("session", 0), "session");
  });
});

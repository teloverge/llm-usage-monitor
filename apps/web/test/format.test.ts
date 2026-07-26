import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatCoverage,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatTokens,
  quotaStatus,
} from "../src/model/format.ts";

describe("Formatters", () => {
  it("formats money to cents for display totals", () => {
    assert.equal(formatMoney(142.3), "$142.30");
    assert.equal(formatMoney(0), "$0.00");
  });

  it("formats token counts compactly from a thousand upward", () => {
    assert.equal(formatTokens(645_000), "645K");
    assert.equal(formatTokens(1_240_000), "1.2M");
    assert.equal(formatTokens(812), "812");
    // Pins the exact transition. Without these two, `< 1_000` and `<= 1_000` are
    // indistinguishable to the suite and a refactor can flip the boundary silently.
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(1_000), "1K");
  });

  it("formats a ratio as a percent with one decimal", () => {
    assert.equal(formatPercent(0.682), "68.2%");
  });

  it("reports priced coverage only when some records are unpriced", () => {
    assert.equal(formatCoverage({ records: 4900, priced: 4900 }), "4,900 records priced");
    assert.equal(formatCoverage({ records: 4900, priced: 4812 }), "4,812 of 4,900 records priced");
  });

  it("describes an empty period in prose when there are no records", () => {
    assert.equal(formatCoverage({ records: 0, priced: 0 }), "No records in this period");
  });
});

describe("Absolute instants", () => {
  // The time zone is passed explicitly here and nowhere else: real callers want
  // the reader's own zone, but a suite that depended on it would pass or fail
  // according to the machine running it.
  it("renders an ISO instant under the pinned locale", () => {
    assert.equal(
      formatDateTime("2026-07-23T12:06:40.000Z", "UTC"),
      "Jul 23, 2026, 12:06 PM",
      "en-US month-first wording with a 12-hour clock, whatever the OS locale is",
    );
  });

  it("converts into the requested zone rather than reporting UTC", () => {
    assert.equal(
      formatDateTime("2026-07-23T12:06:40.000Z", "America/Chicago"),
      "Jul 23, 2026, 7:06 AM",
    );
  });

  it("returns null for an unparseable instant instead of the words Invalid Date", () => {
    // A caller splices this into "resets {value}"; the literal string
    // "Invalid Date" reads as a real reset time to anyone skimming.
    assert.equal(formatDateTime("not-a-date"), null);
    assert.equal(formatDateTime(""), null);
  });
});

describe("Quota thresholds", () => {
  it("is good below 75 percent", () => {
    assert.equal(quotaStatus(0), "good");
    assert.equal(quotaStatus(74.9), "good");
  });

  it("is warning from 75 up to but not including 90", () => {
    assert.equal(quotaStatus(75), "warning");
    assert.equal(quotaStatus(89.9), "warning");
  });

  it("is critical at 90 and above", () => {
    assert.equal(quotaStatus(90), "critical");
    assert.equal(quotaStatus(100), "critical");
  });

  it("is unreported when the source did not supply a percentage", () => {
    assert.equal(quotaStatus(undefined), "unreported");
  });
});

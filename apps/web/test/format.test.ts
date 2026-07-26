import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBucketLabel,
  formatCoverage,
  formatCount,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  formatTokens,
  quotaStatus,
  setFormatLocale,
} from "../src/model/format.ts";

/**
 * Every locale-sensitive assertion runs through this helper. The locale is set
 * explicitly and always restored, so no test depends on the machine's default
 * and no test leaks a locale into the next one.
 */
function inLocale(locale: string, body: () => void): void {
  try {
    setFormatLocale(locale);
    body();
  } finally {
    setFormatLocale("en");
  }
}

/**
 * CLDR separates a currency code, and a compact-notation unit like "mil" or
 * "M", from its number with U+00A0 NO-BREAK SPACE, not a regular space, so a
 * line never wraps between the figure and its unit.
 *
 * U+00A0 is invisible in an editor, so a literal in a string constant is easy
 * to "tidy up" into an ASCII space by a well-meaning edit, which would turn
 * these into baffling failures where actual and expected print identically.
 * Interpolating this named constant keeps the escape visible in source,
 * mirroring the code-point convention quota-meter.ts uses for U+FE0E.
 */
const NBSP = "\u00A0";

describe("Formatters", () => {
  it("formats money to cents with an explicit currency code", () => {
    inLocale("en", () => {
      assert.equal(formatMoney(142.3), `USD${NBSP}142.30`);
      assert.equal(formatMoney(0), `USD${NBSP}0.00`);
    });
    // Spanish puts the code after the amount and uses a comma decimal.
    inLocale("es", () => {
      assert.equal(formatMoney(142.3), `142,30${NBSP}USD`);
      assert.equal(formatMoney(0), `0,00${NBSP}USD`);
    });
  });

  it("formats token counts compactly from a thousand upward", () => {
    inLocale("en", () => {
      assert.equal(formatTokens(645_000), "645K");
      assert.equal(formatTokens(1_240_000), "1.2M");
      assert.equal(formatTokens(812), "812");
      // Pins the exact transition. Without these two, `< 1_000` and `<= 1_000` are
      // indistinguishable to the suite and a refactor can flip the boundary silently.
      assert.equal(formatTokens(999), "999");
      assert.equal(formatTokens(1_000), "1K");
    });
    inLocale("es", () => {
      assert.equal(formatTokens(645_000), `645${NBSP}mil`);
      assert.equal(formatTokens(1_240_000), `1,2${NBSP}M`);
      assert.equal(formatTokens(999), "999");
      assert.equal(formatTokens(1_000), `1${NBSP}mil`);
    });
  });

  it("groups exact counts as the locale does, not as English does", () => {
    inLocale("en", () => {
      assert.equal(formatCount(4900), "4,900");
      assert.equal(formatCount(10_000), "10,000");
    });
    // Spanish CLDR does not group four-digit integers and does group five.
    // This asymmetry is correct and must not be overridden with useGrouping.
    inLocale("es", () => {
      assert.equal(formatCount(4900), "4900");
      assert.equal(formatCount(10_000), "10.000");
    });
  });

  it("rejects an unsupported locale rather than formatting in it", () => {
    inLocale("en", () => {
      setFormatLocale("fr-CA");
      assert.equal(
        formatMoney(142.3),
        `USD${NBSP}142.30`,
        "falls back to en, never to the OS locale",
      );
    });
  });
});

describe("Axis formatting", () => {
  it("keeps axis money short enough for the gutter", () => {
    // formatMoney("$8,947.32") is nine characters and clips at 48px/11px.
    assert.equal(formatMoneyCompact(8947), "$8.9K");
    assert.equal(formatMoneyCompact(1_240_000), "$1.2M");
    assert.equal(formatMoneyCompact(142.3), "$142.3");
    assert.equal(formatMoneyCompact(0), "$0");
  });

  // These two are what catch index drift: verified that slice(5)->slice(4) and
  // slice(5,13)->slice(5,14) each fail one of them. The length branch itself
  // cannot be pinned — on a 10-character bucket slice(5,13) and slice(5) return
  // the same string, so `> 10` and `>= 10` are genuinely equivalent here.
  it("labels a daily bucket without its year", () => {
    assert.equal(formatBucketLabel("2026-07-20"), "07-20");
  });

  it("labels an hourly bucket with the hour", () => {
    // The `last24` timeframe is the only one producing this shape.
    assert.equal(formatBucketLabel("2026-07-20T09:00:00.000Z"), "07-20 09");
  });
});

describe("Absolute instants", () => {
  // The time zone is passed explicitly here and nowhere else: real callers want
  // the reader's own zone, but a suite that depended on it would pass or fail
  // according to the machine running it.
  it("renders an ISO instant in the active locale", () => {
    inLocale("en", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "UTC"),
        "Jul 23, 2026, 12:06 PM",
        "month-first wording with a 12-hour clock",
      );
    });
    inLocale("es", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "UTC"),
        "23 jul 2026, 12:06",
        "day-first wording with a 24-hour clock",
      );
    });
  });

  it("converts into the requested zone rather than reporting UTC", () => {
    inLocale("en", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "America/Chicago"),
        "Jul 23, 2026, 7:06 AM",
      );
    });
    inLocale("es", () => {
      assert.equal(
        formatDateTime("2026-07-23T12:06:40.000Z", "America/Chicago"),
        "23 jul 2026, 7:06",
      );
    });
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

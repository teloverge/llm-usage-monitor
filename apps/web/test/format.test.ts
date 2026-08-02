import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatBucketLabel,
  formatCount,
  formatDateTime,
  formatMoney,
  formatNumberCompact,
  formatPercent,
  formatTokens,
  formatWholePercent,
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

/**
 * French separates digit groups with U+202F NARROW NO-BREAK SPACE \u2014 a second
 * invisible character with the same tidy-up hazard as NBSP above.
 */
const NNBSP = "\u202F";

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

  it("formats a ratio as a percent in the active locale", () => {
    inLocale("en", () => {
      assert.equal(formatPercent(0.682), "68.2%");
    });
    // Spanish uses a comma decimal and a NO-BREAK SPACE before the sign.
    inLocale("es", () => {
      assert.equal(formatPercent(0.682), `68,2${NBSP}%`);
    });
  });

  /**
   * Quota meters and token-mix shares arrive already whole and are read at a
   * glance, so they keep no decimal — "82%", not "82.0%". Separate from
   * `formatPercent` rather than a flag on it, because the two also differ in
   * what they take: a ratio there, a percentage here. One function taking
   * either would be a transposition waiting to happen.
   */
  it("formats an already-whole percentage without a decimal", () => {
    inLocale("en", () => {
      assert.equal(formatWholePercent(82), "82%");
      assert.equal(formatWholePercent(0), "0%");
      assert.equal(formatWholePercent(100), "100%");
    });
    inLocale("es", () => {
      assert.equal(formatWholePercent(82), `82${NBSP}%`);
    });
  });

  /**
   * One distinctive pin per added locale, in the spirit of the Spanish pins
   * above: enough to prove each language formats by its own CLDR conventions
   * rather than inheriting English, without pinning every formatter × locale.
   */
  it("formats each added locale by its own conventions", () => {
    // German groups four-digit integers (Spanish does not) and abbreviates
    // millions as "Mio.".
    inLocale("de", () => {
      assert.equal(formatMoney(142.3), `142,30${NBSP}USD`);
      assert.equal(formatCount(4900), "4.900");
      assert.equal(formatTokens(1_240_000), `1,2${NBSP}Mio.`);
      assert.equal(formatPercent(0.682), `68,2${NBSP}%`);
    });
    inLocale("fr", () => {
      assert.equal(formatCount(100_000), `100${NNBSP}000`);
      assert.equal(formatTokens(645_000), `645${NBSP}k`);
      assert.equal(formatPercent(0.682), `68,2${NBSP}%`);
    });
    // Japanese and Chinese compact against 万 (ten thousand), not the Latin
    // locales' thousand, and place the currency code before the amount.
    inLocale("ja", () => {
      assert.equal(formatMoney(142.3), `USD${NBSP}142.30`);
      assert.equal(formatTokens(1_240_000), "124万");
      assert.equal(formatBucketLabel("2026-07-20"), "7月20日");
    });
    inLocale("zh", () => {
      assert.equal(formatTokens(1_240_000), "124万");
      assert.equal(formatDateTime("2026-07-23T12:06:40.000Z", "UTC"), "2026年7月23日 12:06");
    });
    // Hindi groups in the Indian system and compacts against लाख (a hundred
    // thousand), so a million reads as 12.4 lakh, not 1.2M.
    inLocale("hi", () => {
      assert.equal(formatCount(100_000), "1,00,000");
      assert.equal(formatTokens(1_240_000), `12.4${NBSP}लाख`);
    });
    // Russian groups with NBSP — the ordinary one, where French uses the
    // narrow variant — and compacts against тыс. and млн.
    inLocale("ru", () => {
      assert.equal(formatMoney(142.3), `142,30${NBSP}USD`);
      assert.equal(formatCount(10_000), `10${NBSP}000`);
      assert.equal(formatTokens(645_000), `645${NBSP}тыс.`);
      assert.equal(formatTokens(1_240_000), `1,2${NBSP}млн`);
    });
  });

  it("rejects an unsupported locale rather than formatting in it", () => {
    inLocale("en", () => {
      setFormatLocale("pt-BR");
      assert.equal(
        formatMoney(142.3),
        `USD${NBSP}142.30`,
        "falls back to en, never to the OS locale",
      );
    });
  });
});

describe("Axis formatting", () => {
  it("compacts an axis number and drops the currency", () => {
    inLocale("en", () => {
      assert.equal(formatNumberCompact(8947), "8.9K");
      assert.equal(formatNumberCompact(1_240_000), "1.2M");
      assert.equal(formatNumberCompact(142.3), "142.3");
      assert.equal(formatNumberCompact(0), "0");
    });
    inLocale("es", () => {
      assert.equal(formatNumberCompact(8947), `8,9${NBSP}mil`);
      assert.equal(formatNumberCompact(1_240_000), `1,2${NBSP}M`);
      assert.equal(formatNumberCompact(142.3), "142,3");
      assert.equal(formatNumberCompact(0), "0");
    });
  });

  /**
   * Regression: the axis formerly rounded to zero fraction digits to save gutter
   * width. Recharts spaces ticks evenly, so a domain of 0..3,008 produces 1,504
   * and 2,256 — both of which round to "2K", putting one label on two different
   * gridlines. The fraction digit is what keeps the ticks distinguishable, and
   * this pins the exact pair that collided in real data.
   */
  it("keeps evenly spaced ticks distinguishable from each other", () => {
    inLocale("en", () => {
      assert.notEqual(formatNumberCompact(1_504), formatNumberCompact(2_256));
    });
    inLocale("es", () => {
      assert.notEqual(formatNumberCompact(1_504), formatNumberCompact(2_256));
    });
  });

  /**
   * The two bucket shapes need DIFFERENT time zones, and conflating them is an
   * off-by-one-day bug that still renders a plausible date.
   *
   * A date-only bucket is a calendar day the server already decided; it parses as
   * UTC midnight, so formatting it in a negative-offset zone would render the
   * PREVIOUS day. It is pinned here under America/Chicago precisely to catch that.
   */
  it("labels a daily bucket as a calendar day, without its year", () => {
    inLocale("en", () => {
      assert.equal(formatBucketLabel("2026-07-20"), "Jul 20");
      assert.equal(formatBucketLabel("2026-07-20", "America/Chicago"), "Jul 20");
    });
    inLocale("es", () => {
      assert.equal(formatBucketLabel("2026-07-20"), "20 jul");
      assert.equal(formatBucketLabel("2026-07-20", "America/Chicago"), "20 jul");
    });
  });

  it("labels an hourly bucket with the hour, in the reader's zone", () => {
    // The `last24` timeframe is the only one producing this shape. Unlike a
    // daily bucket this IS an instant, so it converts into the reader's zone.
    inLocale("en", () => {
      assert.equal(formatBucketLabel("2026-07-20T09:00:00.000Z", "UTC"), "Jul 20, 9 AM");
      assert.equal(formatBucketLabel("2026-07-20T21:00:00.000Z", "UTC"), "Jul 20, 9 PM");
    });
    // Spanish uses a 24-hour clock, so the hour carries no AM/PM marker.
    inLocale("es", () => {
      assert.equal(formatBucketLabel("2026-07-20T09:00:00.000Z", "UTC"), "20 jul, 9");
      assert.equal(formatBucketLabel("2026-07-20T21:00:00.000Z", "UTC"), "20 jul, 21");
    });
  });

  it("passes an unparseable bucket through rather than rendering Invalid Date", () => {
    inLocale("en", () => {
      assert.equal(formatBucketLabel("not-a-bucket"), "not-a-bucket");
    });
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

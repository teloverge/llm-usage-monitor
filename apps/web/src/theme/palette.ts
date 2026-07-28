/**
 * Validated against the chart surface below.
 *
 * apps/web/test/palette.test.ts enforces only TWO of the external validator's
 * five gates — the lightness band and contrast — plus a golden pin on these exact
 * values. It does NOT re-derive CVD separation, the normal-vision ΔE floor, or
 * the chroma floor. Changing any value here therefore requires re-running the
 * external palette validator; the pin exists to make that change deliberate
 * rather than silent.
 */
export const CHART_SURFACE = "#17191b";
export const PAGE_SURFACE = "#101113";

/** UI only — buttons, focus, brand, hero figure. Never a chart fill: L 0.739 fails the band. */
export const UI_ACCENT = "#16c79a";

/**
 * Categorical slots in fixed order. Assign by entity, never by rank.
 * teal (#0fae83) sits ~0.003 under the 0.67 lightness ceiling — do not darken it
 * further without re-running apps/web/test/palette.test.ts.
 */
export const SERIES = {
  teal: "#0fae83",
  blue: "#3987e5",
  orange: "#d95926",
} as const;

/** Fixed status palette. Never reused as a series color; always paired with a glyph and label. */
export const STATUS = {
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
} as const;

export const CHART_INK = {
  grid: "#262a2e",
  axis: "#3e4348",
  muted: "#95a59c",
  track: "#282c31",
} as const;

/**
 * Token-mix segment colours, keyed for lookup without assertions. Colours only —
 * the segment names are copy and live in the translation files, because a theme
 * module that also holds English prose cannot be reused in another language.
 */
export const TOKEN_MIX = {
  fresh: SERIES.blue,
  cached: SERIES.teal,
  output: SERIES.orange,
} as const;

/** Stacking order for the token-mix bar. Explicit so it never depends on key order. */
export const TOKEN_MIX_ORDER = ["fresh", "cached", "output"] as const;

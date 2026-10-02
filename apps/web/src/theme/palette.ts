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
  output: SERIES.orange,
} as const;

/**
 * Stacking order for the token-mix bar. Explicit so it never depends on key
 * order. Cached input is not a segment — see `tokenMix` in model/token-mix.ts.
 */
export const TOKEN_MIX_ORDER = ["fresh", "output"] as const;

/** Every colour a chart needs, for one colour scheme. */
export interface ChartPalette {
  surface: string;
  page: string;
  series: { teal: string; blue: string; orange: string };
  status: { good: string; warning: string; critical: string };
  ink: { grid: string; axis: string; muted: string; track: string };
}

export const DARK_PALETTE: ChartPalette = {
  surface: CHART_SURFACE,
  page: PAGE_SURFACE,
  series: SERIES,
  status: STATUS,
  ink: CHART_INK,
};

/**
 * The light-scheme twin of the values above, worn when the reader's system
 * prefers light. Same hues, stepped darker so they hold contrast on white.
 *
 * The series were run through the external palette validator against the light
 * chart surface (`--mode light --surface "#ffffff"`): all five gates pass, worst
 * adjacent CVD ΔE 18.9 (protan) and normal-vision ΔE 19.9, every slot ≥ 3:1.
 * apps/web/test/palette.test.ts re-checks the band and contrast and pins these
 * values, exactly as it does for the dark set — changing one means re-running
 * the validator.
 */
export const LIGHT_PALETTE: ChartPalette = {
  surface: "#ffffff",
  page: "#f4f5f6",
  series: { teal: "#0b8f6b", blue: "#2f73d1", orange: "#c4501f" },
  status: { good: "#138a13", warning: "#a86e00", critical: "#c62f2f" },
  ink: { grid: "#e6e8ea", axis: "#c3c8cc", muted: "#5f6b66", track: "#e6e8ea" },
};

/** UI only, light scheme: the hero figure and primary buttons. Darker than the dark accent so white text and the white page both hold contrast against it. */
export const LIGHT_UI_ACCENT = "#0a7d5d";

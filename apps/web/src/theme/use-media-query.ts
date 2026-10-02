import { useSyncExternalStore } from "react";
import { DARK_PALETTE, LIGHT_PALETTE, type ChartPalette } from "./palette.ts";

/** Whether a media query matches, kept current as the reader's settings change. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The chart colours for the active scheme. Charts draw in SVG attributes that
 * recharts sets from JavaScript, so they cannot follow the CSS custom
 * properties the rest of the page uses; this keeps them in step with the same
 * `prefers-color-scheme` switch tokens.css answers to.
 */
export function useChartPalette(): ChartPalette {
  return useMediaQuery("(prefers-color-scheme: light)") ? LIGHT_PALETTE : DARK_PALETTE;
}

/** True when the reader asked the system for less motion. Chart animations honour it. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

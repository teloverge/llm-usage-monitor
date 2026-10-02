/**
 * Inline SVG icons for the few controls that carry one. Text glyphs (⚙, ⌕, ⊞)
 * render from whichever system font has them, so their size, weight, and even
 * whether they appear as emoji varied by platform. These inherit `currentColor`
 * and are always decorative: the control they sit in carries the accessible name.
 */
const COMMON = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

export function GearIcon() {
  return (
    <svg {...COMMON}>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7 3.4 3.4" />
      <circle cx="8" cy="8" r="4.6" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg {...COMMON} width={12} height={12}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.4 10.4 3.6 3.6" />
    </svg>
  );
}

/** Shown on the control that switches the Breakdown TO a table. */
export function TableIcon() {
  return (
    <svg {...COMMON} width={12} height={12}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M2 6.5h12M2 10h12M6.5 6.5v7" />
    </svg>
  );
}

/** Shown on the control that switches the Breakdown TO a tree. */
export function TreeIcon() {
  return (
    <svg {...COMMON} width={12} height={12}>
      <rect x="1.5" y="1.5" width="5" height="3" rx="1" />
      <path d="M4 4.5v7a1 1 0 0 0 1 1h3M4 8h4" />
      <rect x="8.5" y="6.5" width="6" height="3" rx="1" />
      <rect x="8.5" y="11" width="6" height="3" rx="1" />
    </svg>
  );
}

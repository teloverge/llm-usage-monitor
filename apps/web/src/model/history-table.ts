export type ColumnKind = "text" | "number" | "date" | "duration" | "cost";

export interface HistoryColumn<Row> {
  id: string;
  label: string;
  kind: ColumnKind;
  value: (row: Row) => string | number | null;
}

export interface ColumnFilter {
  text?: string;
  min?: string;
  max?: string;
}

export interface ColumnSort {
  id: string;
  direction: "ascending" | "descending";
}

export function hasColumnFilter(filter: ColumnFilter = {}): boolean {
  return Boolean(filter.text?.trim() || filter.min || filter.max);
}

export function durationMinutes(row: {
  firstActiveAt: string;
  lastActiveAt: string;
}): number | null {
  const duration = (Date.parse(row.lastActiveAt) - Date.parse(row.firstActiveAt)) / 60_000;
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function bound(value: string | undefined, kind: ColumnKind, upper: boolean): number | null {
  if (!value) return null;
  if (kind !== "date") {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  // Date inputs use the reader's local calendar, just like the displayed dates.
  const date = new Date(`${value}T00:00:00`);
  if (upper) date.setDate(date.getDate() + 1);
  return Number.isFinite(date.getTime()) ? date.getTime() - (upper ? 1 : 0) : null;
}

export function historyRows<Row>(
  rows: readonly Row[],
  columns: readonly HistoryColumn<Row>[],
  filters: Readonly<Record<string, ColumnFilter>>,
  sort: ColumnSort | null,
  locale: string,
): Row[] {
  const active = columns
    .filter((column) => hasColumnFilter(filters[column.id]))
    .map((column) => ({
      column,
      text: filters[column.id]?.text?.trim().toLocaleLowerCase(locale) ?? "",
      min: bound(filters[column.id]?.min, column.kind, false),
      max: bound(filters[column.id]?.max, column.kind, true),
    }));
  const result = rows.filter((row) =>
    active.every(({ column, text, min, max }) => {
      const value = column.value(row);
      if (typeof value === "string") return value.toLocaleLowerCase(locale).includes(text);
      if (value === null || !Number.isFinite(value)) return false;
      return (min === null || value >= min) && (max === null || value <= max);
    }),
  );
  const column = columns.find((candidate) => candidate.id === sort?.id);
  if (!column || !sort) return result;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  return result.sort((left, right) => {
    const a = column.value(left);
    const b = column.value(right);
    const missingA = a === null || (typeof a === "number" && !Number.isFinite(a));
    const missingB = b === null || (typeof b === "number" && !Number.isFinite(b));
    // Missing dates and unpriced costs stay last in either direction.
    if (missingA || missingB) return Number(missingA) - Number(missingB);
    const order =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : collator.compare(String(a), String(b));
    return sort.direction === "ascending" ? order : -order;
  });
}

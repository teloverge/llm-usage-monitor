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
  timeFrom?: string;
  timeTo?: string;
}

export interface ColumnSort {
  id: string;
  direction: "ascending" | "descending";
}

export function hasColumnFilter(filter: ColumnFilter = {}): boolean {
  return Boolean(
    filter.text?.trim() || filter.min || filter.max || filter.timeFrom || filter.timeTo,
  );
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
      timeFrom: column.kind === "date" ? timeMinutes(filters[column.id]?.timeFrom) : null,
      timeTo: column.kind === "date" ? timeMinutes(filters[column.id]?.timeTo) : null,
    }));
  const result = rows.filter((row) =>
    active.every(({ column, text, min, max, timeFrom, timeTo }) => {
      const value = column.value(row);
      if (typeof value === "string") return value.toLocaleLowerCase(locale).includes(text);
      if (value === null || !Number.isFinite(value)) return false;
      if ((min !== null && value < min) || (max !== null && value > max)) return false;
      if (timeFrom === null && timeTo === null) return true;
      const date = new Date(value);
      // Match the displayed local minute, including all seconds in the end minute.
      const minutes = date.getHours() * 60 + date.getMinutes();
      if (timeFrom !== null && timeTo !== null && timeFrom > timeTo) {
        return minutes >= timeFrom || minutes <= timeTo;
      }
      return (timeFrom === null || minutes >= timeFrom) && (timeTo === null || minutes <= timeTo);
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

function timeMinutes(value: string | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}

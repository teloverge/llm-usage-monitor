import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  hasColumnFilter,
  historyRows,
  type ColumnFilter,
  type ColumnSort,
  type HistoryColumn,
} from "../model/history-table.ts";

export function useHistoryColumns<Row>(rows: readonly Row[], columns: HistoryColumn<Row>[]) {
  const { t, i18n } = useTranslation();
  const filterId = useId();
  const [sort, setSort] = useState<ColumnSort | null>(null);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = columns.find((column) => column.id === activeId);
  const filtered = Object.values(filters).some(hasColumnFilter);
  const visible = historyRows(rows, columns, filters, sort, i18n.language);

  const heading = (column: HistoryColumn<Row>) => {
    const direction = sort?.id === column.id ? sort.direction : "none";
    const next =
      direction === "none" ? "ascending" : direction === "ascending" ? "descending" : "none";
    return (
      <div className="history-column-heading">
        <button
          type="button"
          className={`history-sort ${direction !== "none" ? "active" : ""}`}
          title={t(`history.columns.${next}`, { column: column.label })}
          aria-label={t(`history.columns.${next}`, { column: column.label })}
          onClick={() => setSort(next === "none" ? null : { id: column.id, direction: next })}
        >
          {column.label}
          <span aria-hidden="true">
            {direction === "ascending" ? "↑" : direction === "descending" ? "↓" : "↕"}
          </span>
        </button>
        <button
          type="button"
          className={`history-filter-toggle ${hasColumnFilter(filters[column.id]) ? "active" : ""}`}
          title={t("history.columns.filter", { column: column.label })}
          aria-label={t("history.columns.filter", { column: column.label })}
          aria-expanded={activeId === column.id}
          aria-controls={activeId === column.id ? filterId : undefined}
          onClick={() => setActiveId(activeId === column.id ? null : column.id)}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="M2 3h12L9.5 8v5l-3-1V8z" />
          </svg>
        </button>
      </div>
    );
  };

  const filter = active ? (filters[active.id] ?? {}) : {};
  const update = (key: keyof ColumnFilter, value: string) => {
    if (active) setFilters({ ...filters, [active.id]: { ...filter, [key]: value } });
  };
  const controls = (
    <>
      {(filtered || sort) && (
        <div className="history-table-status">
          <span role="status">
            {t("history.columns.showing", { count: visible.length, total: rows.length })}
          </span>
          <button
            type="button"
            onClick={() => {
              setFilters({});
              setSort(null);
            }}
          >
            {t("history.columns.reset")}
          </button>
        </div>
      )}
      {active && (
        <div
          className="history-column-filter"
          id={filterId}
          role="group"
          aria-label={t("history.columns.filter", { column: active.label })}
        >
          <strong>{active.label}</strong>
          {active.kind === "text" ? (
            <label>
              {t("history.columns.contains")}
              <input
                type="search"
                value={filter.text ?? ""}
                onChange={(event) => update("text", event.target.value)}
              />
            </label>
          ) : (
            <>
              {active.kind === "duration" && <span>{t("history.columns.minutes")}</span>}
              {active.kind === "cost" && <span>USD</span>}
              <label>
                {t(active.kind === "date" ? "history.columns.from" : "history.columns.min")}
                <input
                  type={active.kind === "date" ? "date" : "number"}
                  min={active.kind === "date" ? undefined : 0}
                  step="any"
                  value={filter.min ?? ""}
                  onChange={(event) => update("min", event.target.value)}
                />
              </label>
              <label>
                {t(active.kind === "date" ? "history.columns.to" : "history.columns.max")}
                <input
                  type={active.kind === "date" ? "date" : "number"}
                  min={active.kind === "date" ? undefined : 0}
                  step="any"
                  value={filter.max ?? ""}
                  onChange={(event) => update("max", event.target.value)}
                />
              </label>
              {active.kind === "date" && (
                <>
                  <label>
                    {t("history.columns.timeFrom")}
                    <input
                      type="time"
                      step="60"
                      value={filter.timeFrom ?? ""}
                      onChange={(event) => update("timeFrom", event.target.value)}
                      aria-describedby={`${filterId}-time-hint`}
                    />
                  </label>
                  <label>
                    {t("history.columns.timeTo")}
                    <input
                      type="time"
                      step="60"
                      value={filter.timeTo ?? ""}
                      onChange={(event) => update("timeTo", event.target.value)}
                      aria-describedby={`${filterId}-time-hint`}
                    />
                  </label>
                  <span className="history-time-hint" id={`${filterId}-time-hint`}>
                    {t("history.columns.timeHint")}
                  </span>
                </>
              )}
            </>
          )}
          <button type="button" onClick={() => setFilters({ ...filters, [active.id]: {} })}>
            {t("history.columns.clear")}
          </button>
          <button type="button" onClick={() => setActiveId(null)}>
            {t("history.columns.close")}
          </button>
        </div>
      )}
    </>
  );
  return { rows: visible, heading, controls, sort, filtered };
}

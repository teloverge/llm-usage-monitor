import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  durationMinutes,
  hasColumnFilter,
  historyRows,
  type HistoryColumn,
} from "../src/model/history-table.ts";

type Row = { name: string; tokens: number; cost: number | null; date: number };
const columns: HistoryColumn<Row>[] = [
  { id: "name", label: "Conversation", kind: "text", value: (row) => row.name },
  { id: "tokens", label: "Tokens", kind: "number", value: (row) => row.tokens },
  { id: "cost", label: "Cost", kind: "cost", value: (row) => row.cost },
  { id: "date", label: "Started", kind: "date", value: (row) => row.date },
];
const rows: Row[] = [
  {
    name: "Task 10",
    tokens: 10000,
    cost: null,
    date: new Date(2026, 8, 4, 23, 59, 59, 999).getTime(),
  },
  { name: "Task 2", tokens: 900, cost: 0, date: new Date(2026, 8, 4).getTime() },
  { name: "Other", tokens: 2000, cost: 2.5, date: new Date(2026, 8, 5).getTime() },
];

describe("History column sorting and filtering", () => {
  it("sorts raw numbers, preserves the input, and restores its default order", () => {
    const result = historyRows(rows, columns, {}, { id: "tokens", direction: "ascending" }, "en");
    assert.deepEqual(
      result.map((row) => row.tokens),
      [900, 2000, 10000],
    );
    assert.equal(rows[0]?.tokens, 10000);
    assert.deepEqual(historyRows(rows, columns, {}, null, "en"), rows);
  });

  it("uses natural text order and keeps unpriced values last in both directions", () => {
    assert.deepEqual(
      historyRows(rows, columns, {}, { id: "name", direction: "ascending" }, "en").map(
        (row) => row.name,
      ),
      ["Other", "Task 2", "Task 10"],
    );
    for (const direction of ["ascending", "descending"] as const) {
      const sorted = historyRows(rows, columns, {}, { id: "cost", direction }, "en");
      assert.equal(sorted.at(-1)?.cost, null);
      assert.equal(sorted[0]?.cost, direction === "ascending" ? 0 : 2.5);
    }
  });

  it("combines case-insensitive text and inclusive numeric ranges before sorting", () => {
    const result = historyRows(
      rows,
      columns,
      { name: { text: " TASK " }, tokens: { min: "900", max: "900" } },
      { id: "tokens", direction: "descending" },
      "en",
    );
    assert.deepEqual(result, [rows[1]]);
    assert.deepEqual(historyRows(rows, columns, { cost: { min: "0", max: "0" } }, null, "en"), [
      rows[1],
    ]);
    assert.deepEqual(
      historyRows(rows, columns, { tokens: { min: "100", max: "10" } }, null, "en"),
      [],
    );
  });

  it("includes the entire local end date and excludes the next day", () => {
    assert.deepEqual(
      historyRows(rows, columns, { date: { min: "2026-09-04", max: "2026-09-04" } }, null, "en"),
      rows.slice(0, 2),
    );
  });

  it("keeps equal values stable and treats cleared filters as inactive", () => {
    const tied = rows.map((row) => ({ ...row, tokens: 5 }));
    assert.deepEqual(
      historyRows(
        tied,
        columns,
        { name: { text: " " }, tokens: { min: "", max: "" } },
        { id: "tokens", direction: "descending" },
        "en",
      ),
      tied,
    );
  });

  it("filters local time on every day and includes the whole end minute", () => {
    const times = [
      new Date(2026, 8, 4, 8, 59, 59, 999),
      new Date(2026, 8, 4, 9),
      new Date(2026, 8, 5, 17, 30, 59, 999),
      new Date(2026, 8, 5, 17, 31),
    ].map((date) => ({ name: "Task", tokens: 0, cost: 0, date: date.getTime() }));
    assert.deepEqual(
      historyRows(times, columns, { date: { timeFrom: "09:00", timeTo: "17:30" } }, null, "en"),
      times.slice(1, 3),
    );
    assert.deepEqual(
      historyRows(
        times,
        columns,
        { date: { min: "2026-09-05", max: "2026-09-05", timeFrom: "09:00", timeTo: "17:30" } },
        null,
        "en",
      ),
      [times[2]],
    );
    assert.deepEqual(
      historyRows(times, columns, { date: { timeFrom: "09:00" } }, null, "en"),
      times.slice(1),
    );
    assert.deepEqual(
      historyRows(times, columns, { date: { timeTo: "17:30" } }, null, "en"),
      times.slice(0, 3),
    );
    assert.deepEqual(
      historyRows(times, columns, { date: { timeFrom: "17:30", timeTo: "17:30" } }, null, "en"),
      [times[2]],
    );
  });

  it("supports overnight time ranges and midnight bounds", () => {
    const times = [0, 2, 3, 12, 21, 22, 23].map((hour) => ({
      name: "Task",
      tokens: 0,
      cost: 0,
      date: new Date(2026, 8, 4, hour).getTime(),
    }));
    assert.deepEqual(
      historyRows(times, columns, { date: { timeFrom: "22:00", timeTo: "02:00" } }, null, "en"),
      [times[0], times[1], times[5], times[6]],
    );
    assert.deepEqual(historyRows(times, columns, { date: { timeTo: "00:00" } }, null, "en"), [
      times[0],
    ]);
  });

  it("combines Started and Last active time filters independently", () => {
    const columns: HistoryColumn<{ started: number; lastActive: number }>[] = [
      { id: "started", label: "Started", kind: "date", value: (row) => row.started },
      { id: "lastActive", label: "Last active", kind: "date", value: (row) => row.lastActive },
    ];
    const rows = [
      [9, 17],
      [9, 19],
      [11, 17],
    ].map(([start, end]) => ({
      started: new Date(2026, 8, 4, start).getTime(),
      lastActive: new Date(2026, 8, 4, end).getTime(),
    }));
    assert.deepEqual(
      historyRows(
        rows,
        columns,
        { started: { timeTo: "10:00" }, lastActive: { timeFrom: "18:00" } },
        null,
        "en",
      ),
      [rows[1]],
    );
  });

  it("tracks time-only filters, clears them, and excludes invalid dates when filtering", () => {
    assert.equal(hasColumnFilter({ timeFrom: "00:00" }), true);
    assert.equal(hasColumnFilter({ timeTo: "00:00" }), true);
    assert.equal(hasColumnFilter({ timeFrom: "", timeTo: "" }), false);
    const withInvalidDate = [...rows, { name: "Invalid", tokens: 0, cost: null, date: NaN }];
    assert.deepEqual(
      historyRows(withInvalidDate, columns, { date: { timeFrom: "00:00" } }, null, "en"),
      rows,
    );
    assert.deepEqual(
      historyRows(withInvalidDate, columns, { date: { timeFrom: "", timeTo: "" } }, null, "en"),
      withInvalidDate,
    );
  });

  it("compares durations in minutes without rounding and rejects invalid spans", () => {
    assert.equal(
      durationMinutes({
        firstActiveAt: "2026-09-04T00:00:00Z",
        lastActiveAt: "2026-09-04T00:01:30Z",
      }),
      1.5,
    );
    assert.equal(durationMinutes({ firstActiveAt: "invalid", lastActiveAt: "" }), null);
    assert.equal(
      durationMinutes({ firstActiveAt: "2026-09-05", lastActiveAt: "2026-09-04" }),
      null,
    );
  });
});

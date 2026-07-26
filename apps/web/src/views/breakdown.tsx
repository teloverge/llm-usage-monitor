import { useState } from "react";
import type { OverviewView, RankedUsage } from "@llm-usage-monitor/contracts";
import { Rollup } from "../components/rollup.tsx";
import { formatCount, formatMoney, formatTokens } from "../model/format.ts";
import { harnessLabel } from "../model/harness.ts";
import { rankedRowKey } from "../model/rank-scale.ts";

/**
 * Owned here rather than in `app.tsx` so the vocabulary lives with the view that
 * defines it; `app.tsx` imports the type to hold the selection as state.
 */
export type BreakdownDimension =
  | "byHarness"
  | "byModel"
  | "byTask"
  | "bySourceHost"
  | "byHostGroup";

const DIMENSIONS: Array<{ value: BreakdownDimension; label: string }> = [
  { value: "byHarness", label: "Harness" },
  { value: "byModel", label: "Model → Reasoning" },
  { value: "byTask", label: "Task → Session" },
  { value: "bySourceHost", label: "Host" },
  { value: "byHostGroup", label: "Host Group" },
];

export function Breakdown({
  data,
  dimension,
  onDimensionChange,
}: {
  data: OverviewView;
  dimension: BreakdownDimension;
  onDimensionChange: (value: BreakdownDimension) => void;
}) {
  const [asTable, setAsTable] = useState(false);
  // Harness rows carry raw ids, exactly as in the Overview's By-harness panel.
  // Relabelled here for the same reason: `unknown` must not read as the name of
  // something the user installed.
  const rows =
    dimension === "byHarness"
      ? data.byHarness.map((row) => ({ ...row, key: harnessLabel(row.key) }))
      : data[dimension];
  return (
    <section className="breakdown">
      <div className="group-by">
        <span className="panel-label">Group by</span>
        {DIMENSIONS.map((item) => (
          <button
            type="button"
            key={item.value}
            className={`chip ${dimension === item.value ? "on" : ""}`}
            aria-pressed={dimension === item.value}
            onClick={() => onDimensionChange(item.value)}
          >
            {item.label}
          </button>
        ))}
        {/*
          Labelled with the view it switches TO, not the one being shown. The
          static "Table view" label read as a state, so once pressed it claimed to
          be the tree while showing the table — and the table's rows do not
          collapse, which made the tree itself look broken.
        */}
        <button
          type="button"
          className="chip table-toggle"
          aria-pressed={asTable}
          onClick={() => setAsTable(!asTable)}
        >
          {asTable ? "⊟ Tree view" : "⊞ Table view"}
        </button>
      </div>
      <div className="panel breakdown-body">
        {rows.length === 0 ? (
          <p className="empty-state">No usage matches the current filters.</p>
        ) : asTable ? (
          <BreakdownTable rows={rows} />
        ) : (
          // Keyed by dimension so switching the grouping starts a fresh tree.
          // Without it the open-row state carries over keys from the previous
          // dimension, which match nothing, and every group lands collapsed.
          <Rollup key={dimension} rows={rows} />
        )}
      </div>
    </section>
  );
}

function BreakdownTable({ rows }: { rows: RankedUsage[] }) {
  const flat = rows.flatMap((row) => [
    { depth: 0, row },
    ...(row.children ?? []).flatMap((child) => [
      { depth: 1, row: child },
      ...(child.children ?? []).map((leaf) => ({ depth: 2, row: leaf })),
    ]),
  ]);
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Group</th>
          <th className="n">Records</th>
          <th className="n">Tokens</th>
          <th className="n">Cost</th>
        </tr>
      </thead>
      <tbody>
        {flat.map(({ depth, row }) => (
          // Depth alone does not disambiguate: two providers' identically named
          // models sit at the same depth with the same `key`.
          <tr key={`${depth} ${rankedRowKey(row)}`}>
            <td style={{ paddingLeft: `${10 + depth * 20}px` }}>{row.key}</td>
            <td className="n">{formatCount(row.records)}</td>
            <td className="n">{formatTokens(row.totalTokens)}</td>
            <td className="n">{formatMoney(row.estimatedCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OverviewView, RankedUsage } from "@llm-usage-monitor/contracts";
import { Rollup } from "../components/rollup.tsx";
import { credentialLabel } from "../model/credential.ts";
import { formatCount, formatMoney, formatTokens } from "../model/format.ts";
import { harnessLabel } from "../model/harness.ts";
import { rankedRowKey } from "../model/rank-scale.ts";

/**
 * Owned here rather than in `app.tsx` so the vocabulary lives with the view that
 * defines it; `app.tsx` imports the type to hold the selection as state.
 */
export type BreakdownDimension =
  | "byHarness"
  | "byCredential"
  | "byModel"
  | "byTask"
  | "bySourceHost"
  | "byHostGroup";

/** Ids only; labels are looked up per render so they follow the language. */
const DIMENSIONS: readonly BreakdownDimension[] = [
  "byHarness",
  "byCredential",
  "byModel",
  "byTask",
  "bySourceHost",
  "byHostGroup",
];

export function Breakdown({
  data,
  hostLabel,
  dimension,
  onDimensionChange,
}: {
  data: OverviewView;
  hostLabel: (sourceHostId: string) => string;
  dimension: BreakdownDimension;
  onDimensionChange: (value: BreakdownDimension) => void;
}) {
  const { t } = useTranslation();
  const [asTable, setAsTable] = useState(false);
  // Harness and host rows carry raw ids, exactly as in the Overview's panels.
  // Relabelled here for the same reason: `unknown` must not read as the name of
  // something the user installed, and an unnamed host needs translated
  // positional wording the analysis layer cannot supply.
  const rows =
    dimension === "byHarness"
      ? data.byHarness.map((row) => ({
          ...row,
          key: harnessLabel(row.key, t("common.unknownHarness")),
        }))
      : dimension === "bySourceHost"
        ? data.bySourceHost.map((row) => ({ ...row, key: hostLabel(row.key) }))
        : dimension === "byCredential"
          ? data.byCredential.map((row) => ({ ...row, key: credentialLabel(row.key, t) }))
          : data[dimension];
  return (
    <section className="breakdown">
      <div className="group-by">
        <span className="panel-label">{t("breakdown.groupBy")}</span>
        {DIMENSIONS.map((item) => (
          <button
            type="button"
            key={item}
            className={`chip ${dimension === item ? "on" : ""}`}
            aria-pressed={dimension === item}
            onClick={() => onDimensionChange(item)}
          >
            {t(`breakdown.${item}`)}
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
          {asTable ? t("breakdown.treeView") : t("breakdown.tableView")}
        </button>
      </div>
      <div className="panel breakdown-body">
        {rows.length === 0 ? (
          <p className="empty-state">{t("breakdown.empty")}</p>
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
  const { t } = useTranslation();
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
          <th>{t("table.group")}</th>
          <th className="n">{t("table.records")}</th>
          <th className="n">{t("table.tokens")}</th>
          <th className="n">{t("table.cost")}</th>
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

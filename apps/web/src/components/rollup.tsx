import { useState } from "react";
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatMoney, formatTokens } from "../model/format.ts";
import { rankBarWidth, rankedRowKey } from "../model/rank-scale.ts";
import { rollupScale } from "../model/rollup-scale.ts";

export function Rollup({
  rows,
  depth = 0,
  defaultOpenFirst = true,
  scale,
}: {
  rows: RankedUsage[];
  depth?: number;
  defaultOpenFirst?: boolean;
  /** The cost of a full bar. Set by the top level and passed down unchanged; see `rollupScale`. */
  scale?: number;
}) {
  /**
   * Which rows are open is React state, not just DOM state. Passing `open` to
   * `<details>` makes React the authority on the attribute, so with no state
   * behind it a row the user collapsed could be reopened by the next render —
   * the rows read as refusing to collapse. Keyed by row rather than by index so
   * an expansion survives the re-ranking that follows a data refresh.
   */
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => {
    const first = defaultOpenFirst ? rows[0] : undefined;
    return new Set(first ? [rankedRowKey(first)] : []);
  });
  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const full = scale ?? rollupScale(rows.map((row) => row.estimatedCost));
  return (
    <>
      {rows.map((row) => {
        const key = rankedRowKey(row);
        const bar = (
          <span className="rank-track" aria-hidden="true">
            <i style={{ width: `${rankBarWidth(row.estimatedCost, full)}%` }} />
          </span>
        );
        const metrics = (
          <>
            <span className="rollup-tokens">{formatTokens(row.totalTokens)}</span>
            <span className="rank-value">{formatMoney(row.estimatedCost)}</span>
          </>
        );
        if (!row.children?.length) {
          return (
            <div
              className={`rollup-row depth-${depth}${row.estimatedCost === 0 ? " zero" : ""}`}
              key={key}
            >
              <span className="rank-name" title={row.key}>
                {row.key}
              </span>
              {bar}
              {metrics}
            </div>
          );
        }
        return (
          <details
            className={`rollup depth-${depth}`}
            key={key}
            open={openKeys.has(key)}
            onToggle={(event) => setOpen(key, event.currentTarget.open)}
          >
            <summary>
              <span className="rank-name" title={row.key}>
                {row.key}
              </span>
              {bar}
              {metrics}
            </summary>
            <Rollup rows={row.children} depth={depth + 1} defaultOpenFirst={false} scale={full} />
          </details>
        );
      })}
    </>
  );
}

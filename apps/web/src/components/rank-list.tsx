import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatCount, formatMoney } from "../model/format.ts";
import { rankBarWidth, rankView } from "../model/rank-scale.ts";

/** A ranked row whose `title`, when set, is its full name and `key` a shortened one. */
export type RankRow = Omit<RankedUsage, "children"> & { title?: string; children?: RankRow[] };

export function RankList({
  rows,
  limit = 4,
  onMore,
  emptyLabel,
  expandChildren = false,
}: {
  rows: RankRow[];
  limit?: number;
  onMore?: () => void;
  /** Defaults to the generic empty wording; callers override for a narrower one. */
  emptyLabel?: string;
  /**
   * Lets a row with several children open to show them, labelled as accounts.
   * Opt-in: model and task rows carry children too (reasoning levels,
   * sessions), which the Breakdown is the place for.
   */
  expandChildren?: boolean;
}) {
  const { t } = useTranslation();
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setOpenKeys((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // Keyed off the data, not off what survived the cap: a list that has rows but
  // shows none of them is truncated, not empty, and saying "No usage in this
  // period" over real usage is the worst thing this component could do.
  if (!rows.length) return <p className="empty-state">{emptyLabel ?? t("rank.empty")}</p>;

  const { shown, remaining, maximum } = rankView(rows, limit);
  const accounts = (count: number) =>
    t("common.accountCount", { count, accounts: formatCount(count) });
  const bar = (cost: number) => (
    <span className="rank-track" aria-hidden="true">
      <i style={{ width: `${rankBarWidth(cost, maximum)}%` }} />
    </span>
  );
  return (
    <>
      <ol className="rank-list">
        {/*
          A zero-cost row is dimmed rather than dropped: it still says the
          harness or model ran in this period, but it should not compete with
          the rows that actually drove the cost.
        */}
        {/*
          A row with more than one child — a harness used through two
          accounts — can be opened to show them. One child says nothing the
          row does not, so it gets no toggle. Children share the parent list's
          bar scale, so an account's bar reads against its harness's.
        */}
        {shown.map((row) => {
          const children = row.children ?? [];
          const expandable = expandChildren && children.length > 1;
          const open = expandable && openKeys.has(row.key);
          return (
            <Fragment key={row.key}>
              <li className={row.estimatedCost === 0 ? "zero" : undefined}>
                {expandable ? (
                  <button
                    type="button"
                    className="rank-name rank-toggle"
                    title={`${row.key} · ${accounts(children.length)}`}
                    aria-expanded={open}
                    onClick={() => toggle(row.key)}
                  >
                    <span aria-hidden="true">{open ? "▾" : "▸"}</span> {row.key}
                    {/*
                      The panel's name column is narrow, so the count shows as
                      "(2)" and the words go to assistive tech and the tooltip.
                    */}
                    <span className="rank-count" aria-hidden="true">
                      {" "}
                      ({formatCount(children.length)})
                    </span>
                    <span className="sr-only"> · {accounts(children.length)}</span>
                  </button>
                ) : (
                  <span className="rank-name" title={row.key}>
                    {row.key}
                  </span>
                )}
                {bar(row.estimatedCost)}
                <span className="rank-value">{formatMoney(row.estimatedCost)}</span>
              </li>
              {open &&
                children.map((child) => (
                  <li
                    key={`${row.key}/${child.key}`}
                    className={`rank-child${child.estimatedCost === 0 ? " zero" : ""}`}
                  >
                    <span className="rank-name" title={child.title ?? child.key}>
                      {child.key}
                    </span>
                    {bar(child.estimatedCost)}
                    <span className="rank-value">{formatMoney(child.estimatedCost)}</span>
                  </li>
                ))}
            </Fragment>
          );
        })}
      </ol>
      {/*
        Truncation is disclosed whether or not there is somewhere to go. Not every
        call site passes `onMore` — the Overview's Hosts panel caps at 5 with no
        drill-down — and rendering nothing there would hide from the reader that
        the list is partial, which is exactly the kind of quiet omission this
        dashboard is supposed to avoid.
      */}
      {remaining > 0 &&
        (onMore ? (
          <button type="button" className="link" onClick={onMore}>
            {t("rank.moreLink", { remaining: formatCount(remaining) })}
          </button>
        ) : (
          <p className="link link-static">
            {t("rank.more", { remaining: formatCount(remaining) })}
          </p>
        ))}
    </>
  );
}

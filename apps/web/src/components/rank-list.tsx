import { useTranslation } from "react-i18next";
import type { RankedUsage } from "@llm-usage-monitor/contracts";
import { formatCount, formatMoney } from "../model/format.ts";
import { rankBarWidth, rankView } from "../model/rank-scale.ts";

export function RankList({
  rows,
  limit = 4,
  onMore,
  emptyLabel,
}: {
  rows: RankedUsage[];
  limit?: number;
  onMore?: () => void;
  /** Defaults to the generic empty wording; callers override for a narrower one. */
  emptyLabel?: string;
}) {
  const { t } = useTranslation();
  // Keyed off the data, not off what survived the cap: a list that has rows but
  // shows none of them is truncated, not empty, and saying "No usage in this
  // period" over real usage is the worst thing this component could do.
  if (!rows.length) return <p className="empty-state">{emptyLabel ?? t("rank.empty")}</p>;

  const { shown, remaining, maximum } = rankView(rows, limit);
  return (
    <>
      <ol className="rank-list">
        {shown.map((row) => (
          <li key={row.key}>
            <span className="rank-name" title={row.key}>
              {row.key}
            </span>
            <span className="rank-track" aria-hidden="true">
              <i style={{ width: `${rankBarWidth(row.estimatedCost, maximum)}%` }} />
            </span>
            <span className="rank-value">{formatMoney(row.estimatedCost)}</span>
          </li>
        ))}
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

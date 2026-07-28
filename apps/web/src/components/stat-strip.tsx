import { useTranslation } from "react-i18next";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { formatCount, formatPercent, formatTokens } from "../model/format.ts";
import { cacheStat } from "../model/stat-strip.ts";

export function StatStrip({ totals }: { totals: UsageTotals }) {
  const { t } = useTranslation();
  const cache = cacheStat(totals);
  const stats = [
    {
      key: "tokens",
      label: t("overview.tokens"),
      value: formatTokens(totals.totalTokens),
      note: "",
    },
    {
      key: "cached",
      label: t("overview.cachedInput"),
      value: cache.ratio === null ? t("common.notReported") : formatPercent(cache.ratio),
      // Coverage is stated in tokens because the ratio is token-weighted — see
      // `cacheStat`. Shown only when coverage is partial: with nothing to
      // qualify, the line is noise.
      note:
        cache.partialOf === null
          ? ""
          : t("overview.cacheCoverage", { tokens: formatTokens(cache.partialOf) }),
    },
    { key: "tasks", label: t("overview.tasks"), value: formatCount(totals.tasks), note: "" },
    { key: "models", label: t("overview.models"), value: formatCount(totals.models), note: "" },
  ];
  return (
    <section className="panel strip">
      {stats.map((stat) => (
        <div key={stat.key}>
          <p className="panel-label">{stat.label}</p>
          <p className="stat">{stat.value}</p>
          {stat.note && <p className="panel-label">{stat.note}</p>}
        </div>
      ))}
    </section>
  );
}

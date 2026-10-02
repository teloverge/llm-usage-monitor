import { useTranslation } from "react-i18next";
import type { UsageCostBreakdown, UsageTotals } from "@llm-usage-monitor/contracts";
import { formatCount, formatMoney, formatPercent, formatTokens } from "../model/format.ts";
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

/**
 * The estimate split by the rate each share was billed at, as a row of plain
 * values — the same shape as the token strip above it, and deliberately not a
 * chart.
 *
 * The four shares add up to the estimate, which is already the hero figure (or
 * the row's own cost in History), so the total is not repeated here.
 * `cacheSavings` is what the cache reads would have cost at the base input
 * rate, less what they did cost. It is NOT a share of the estimate — it is
 * routinely larger than it — so it sits apart, after a divider, and says so.
 */
export function CostStrip({
  breakdown,
  className = "panel strip cost",
}: {
  breakdown: UsageCostBreakdown;
  className?: string;
}) {
  const { t } = useTranslation();
  const shares = [
    { key: "input", label: t("overview.costInput"), value: breakdown.input },
    { key: "cacheRead", label: t("overview.costCacheRead"), value: breakdown.cacheRead },
    { key: "cacheWrite", label: t("overview.costCacheWrite"), value: breakdown.cacheWrite },
    { key: "output", label: t("overview.costOutput"), value: breakdown.output },
  ];
  return (
    <section className={className}>
      {shares.map((stat) => (
        <div key={stat.key}>
          <p className="panel-label">{stat.label}</p>
          <p className="stat">{formatMoney(stat.value)}</p>
        </div>
      ))}
      <div className="cost-savings">
        <p className="panel-label">
          {t("overview.costCacheSavings")}
          <span className="cost-savings-note"> · {t("overview.costSavingsNote")}</span>
        </p>
        <p className="stat">{formatMoney(breakdown.cacheSavings)}</p>
      </div>
    </section>
  );
}

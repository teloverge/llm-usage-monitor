import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { formatCount, formatPercent, formatTokens } from "../model/format.ts";
import { cacheStat } from "../model/stat-strip.ts";

export function StatStrip({ totals }: { totals: UsageTotals }) {
  const cache = cacheStat(totals);
  const stats = [
    { label: "Tokens", value: formatTokens(totals.totalTokens), note: "" },
    {
      label: "Cached input",
      value: cache.ratio === null ? "Not reported" : formatPercent(cache.ratio),
      // Coverage is stated in tokens because the ratio is token-weighted — see
      // `cacheStat`. Shown only when coverage is partial: with nothing to
      // qualify, the line is noise.
      note: cache.partialOf === null ? "" : `of ${formatTokens(cache.partialOf)} reporting tokens`,
    },
    { label: "Tasks", value: formatCount(totals.tasks), note: "" },
    { label: "Models", value: formatCount(totals.models), note: "" },
  ];
  return (
    <section className="panel strip">
      {stats.map((stat) => (
        <div key={stat.label}>
          <p className="panel-label">{stat.label}</p>
          <p className="stat">{stat.value}</p>
          {stat.note && <p className="panel-label">{stat.note}</p>}
        </div>
      ))}
    </section>
  );
}

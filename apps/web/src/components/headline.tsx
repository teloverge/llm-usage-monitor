import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { OverviewView } from "@llm-usage-monitor/contracts";
import { CHART_INK, CHART_SURFACE, PAGE_SURFACE, SERIES } from "../theme/palette.ts";
import {
  formatBucketLabel,
  formatCount,
  formatMoney,
  formatNumberCompact,
  formatTokens,
  formatTokensAxis,
} from "../model/format.ts";
import { coverageMessage } from "../model/coverage.ts";

type Measure = "cost" | "tokens";

const MEASURES = ["cost", "tokens"] as const;

/**
 * The inline period labels are a SEPARATE key set from the Period dropdown's,
 * not a case transformation of it. English wants "Last 7 days" in a chip and
 * "last 7 days" mid-sentence; Spanish title-cases neither, and other languages
 * differ again. Sentence-position casing is a per-locale decision, so both forms
 * are authored per locale rather than derived.
 */
const INLINE_PERIODS = ["today", "last24", "7", "30", "90", "all"] as const;

type InlinePeriod = (typeof INLINE_PERIODS)[number];

/**
 * Narrows the server-supplied timeframe to a key that exists, rather than
 * casting. `filters.timeframe` is a plain string, so an unrecognised value
 * would otherwise interpolate into a missing key and render the key itself.
 * The `custom` fallback is the same one the old TIMEFRAME_LABEL lookup used.
 */
function inlinePeriodKey(timeframe: string): `period.inline.${InlinePeriod | "custom"}` {
  const match = INLINE_PERIODS.find((period) => period === timeframe);
  return match ? `period.inline.${match}` : "period.inline.custom";
}

export function Headline({ data }: { data: OverviewView }) {
  const { t } = useTranslation();
  const [measure, setMeasure] = useState<Measure>("cost");
  const period = t(inlinePeriodKey(data.filters.timeframe));
  const key = measure === "cost" ? "estimatedCost" : "totalTokens";
  // The axis and the tooltip format the same number differently on purpose: the
  // axis gutter is 48px and clips anything longer than about seven characters,
  // while the tooltip has room for the exact figure including its currency.
  // Both axis formatters drop to zero fraction digits for exactly that reason
  // — see `formatNumberCompact` and `formatTokensAxis` in model/format.ts.
  const axisFormat = measure === "cost" ? formatNumberCompact : formatTokensAxis;
  const exactFormat = measure === "cost" ? formatMoney : formatTokens;
  const coverage = coverageMessage({
    records: data.totals.records,
    priced: data.totals.pricedRecords,
  });
  return (
    <section className="panel headline">
      <div className="headline-head">
        <div>
          <p className="panel-label">{t("headline.title", { period })}</p>
          <p className="hero">{formatMoney(data.totals.estimatedCost)}</p>
          <p className="panel-label">
            {t("headline.disclaimer", {
              // Both numbers are formatted here, not by i18next: one formatting
              // path, and "4,900" beside the hero's "USD 8,947.32" rather than a
              // bare "4900".
              coverage: t(coverage.key, {
                records: formatCount(coverage.params.records),
                priced: formatCount(coverage.params.priced),
              }),
            })}
          </p>
        </div>
        <div className="segmented" role="group" aria-label={t("headline.measureGroup")}>
          {MEASURES.map((item) => (
            <button
              type="button"
              key={item}
              className={measure === item ? "on" : ""}
              aria-pressed={measure === item}
              onClick={() => setMeasure(item)}
            >
              {t(`headline.${item}`)}
            </button>
          ))}
        </div>
      </div>
      {/*
        An AreaChart with no points still draws its axes and grid, which reads as
        a chart that failed to load rather than a period with nothing in it.
      */}
      {data.timeline.length === 0 ? (
        <p className="empty-state">{t("headline.empty")}</p>
      ) : (
        <ResponsiveContainer width="100%" height={168}>
          <AreaChart data={data.timeline} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis
              dataKey="bucket"
              // Wrapped, not passed by reference: recharts calls tickFormatter
              // with (value, index), and the index would land in the timeZone
              // parameter.
              tickFormatter={(value) => formatBucketLabel(String(value))}
              stroke={CHART_INK.axis}
              tick={{ fill: CHART_INK.muted, fontSize: 11 }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => axisFormat(Number(value))}
              stroke={CHART_INK.axis}
              tick={{ fill: CHART_INK.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={48}
            />
            <Tooltip
              formatter={(value) => exactFormat(Number(value))}
              labelFormatter={(label) => formatBucketLabel(String(label))}
              contentStyle={{
                background: PAGE_SURFACE,
                border: `1px solid ${CHART_INK.grid}`,
                borderRadius: 7,
                fontSize: 11,
              }}
            />
            <Area
              type="monotone"
              dataKey={key}
              stroke={SERIES.teal}
              strokeWidth={2}
              fill={SERIES.teal}
              fillOpacity={0.13}
              name={measure === "cost" ? t("headline.seriesCost") : t("headline.tokens")}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: CHART_SURFACE }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

import { useState } from "react";
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
  formatCoverage,
  formatMoney,
  formatNumberCompact,
  formatTokens,
} from "../model/format.ts";

type Measure = "cost" | "tokens";

const TIMEFRAME_LABEL: Record<string, string> = {
  today: "today",
  last24: "last 24 hours",
  "7": "last 7 days",
  "30": "last 30 days",
  "90": "last 90 days",
  all: "all retained history",
  custom: "the selected range",
};

const MEASURES: Array<{ value: Measure; label: string }> = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
];

export function Headline({ data }: { data: OverviewView }) {
  const [measure, setMeasure] = useState<Measure>("cost");
  const period = TIMEFRAME_LABEL[data.filters.timeframe] ?? "the selected range";
  const key = measure === "cost" ? "estimatedCost" : "totalTokens";
  // The axis and the tooltip format the same number differently on purpose: the
  // axis gutter is 48px and clips anything longer than about seven characters,
  // while the tooltip has room for the exact figure including cents.
  const axisFormat = measure === "cost" ? formatNumberCompact : formatTokens;
  const exactFormat = measure === "cost" ? formatMoney : formatTokens;
  return (
    <section className="panel headline">
      <div className="headline-head">
        <div>
          <p className="panel-label">API-equivalent cost of work · {period}</p>
          <p className="hero">{formatMoney(data.totals.estimatedCost)}</p>
          <p className="panel-label">
            {formatCoverage({
              records: data.totals.records,
              priced: data.totals.pricedRecords,
            })}{" "}
            · estimated at your configured API rates, not a bill
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Trend measure">
          {MEASURES.map((item) => (
            <button
              type="button"
              key={item.value}
              className={measure === item.value ? "on" : ""}
              aria-pressed={measure === item.value}
              onClick={() => setMeasure(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {/*
        An AreaChart with no points still draws its axes and grid, which reads as
        a chart that failed to load rather than a period with nothing in it.
      */}
      {data.timeline.length === 0 ? (
        <p className="empty-state">No activity in this period</p>
      ) : (
        <ResponsiveContainer width="100%" height={168}>
          <AreaChart data={data.timeline} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={CHART_INK.grid} vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={formatBucketLabel}
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
              name={measure === "cost" ? "Estimated cost" : "Tokens"}
              activeDot={{ r: 4.5, strokeWidth: 2, stroke: CHART_SURFACE }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}

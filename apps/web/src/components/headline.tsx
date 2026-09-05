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
import type { HostTimelinePoint, OverviewView } from "@llm-usage-monitor/contracts";
import { CHART_INK, CHART_SURFACE, PAGE_SURFACE, SERIES } from "../theme/palette.ts";
import {
  formatBucketLabel,
  formatCount,
  formatMoney,
  formatNumberCompact,
  formatTokens,
  formatWholePercent,
} from "../model/format.ts";
import { coverageMessage } from "../model/coverage.ts";

type Measure = "cost" | "tokens";

const MEASURES = ["cost", "tokens"] as const;

/**
 * The palette carries exactly three validated categorical slots, so the three
 * costliest hosts get them and everything past that folds into one "Other
 * hosts" band. The fold wears the muted ink rather than a fourth data hue:
 * it is a deliberate de-emphasis, and inventing a hue would silently change
 * the validated set (see theme/palette.ts).
 */
const HOST_SLOTS = [SERIES.teal, SERIES.blue, SERIES.orange] as const;

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

/**
 * Pivots the per-host timeline into one row per bucket with a column per
 * series. Columns are the synthetic keys from `seriesFor`, not raw host ids:
 * a hostname with a dot in it would otherwise be read by recharts as a nested
 * data path. Every row starts with every series at 0 — a host silent in a
 * bucket has no source row, and a missing dataKey would break the stack.
 */
function stackRows(
  points: HostTimelinePoint[],
  measure: "estimatedCost" | "totalTokens",
  seriesFor: (sourceHostId: string) => string,
  seriesKeys: string[],
): Array<Record<string, number | string>> {
  const rows = new Map<string, Record<string, number | string>>();
  for (const point of points) {
    let row = rows.get(point.bucket);
    if (!row) {
      row = { bucket: point.bucket };
      for (const seriesKey of seriesKeys) row[seriesKey] = 0;
      rows.set(point.bucket, row);
    }
    const seriesKey = seriesFor(point.sourceHostId);
    row[seriesKey] = (row[seriesKey] as number) + point[measure];
  }
  return [...rows.values()];
}

export function Headline({
  data,
  hostLabel,
}: {
  data: OverviewView;
  hostLabel: (sourceHostId: string) => string;
}) {
  const { t } = useTranslation();
  const [measure, setMeasure] = useState<Measure>("cost");
  const period = t(inlinePeriodKey(data.filters.timeframe));
  const key = measure === "cost" ? "estimatedCost" : "totalTokens";
  // The axis and the tooltip format the same number differently on purpose: the
  // axis compacts to fit the gutter, while the tooltip has room for the exact
  // figure including its currency. Both keep one fraction digit — see
  // `formatNumberCompact` in model/format.ts for why the axis cannot drop it.
  const axisFormat = measure === "cost" ? formatNumberCompact : formatTokens;
  const exactFormat = measure === "cost" ? formatMoney : formatTokens;
  const coverage = coverageMessage({
    records: data.totals.records,
    priced: data.totals.pricedRecords,
  });
  // Splitting by host only makes sense with no host selected and more than one
  // host to split: under a host filter the total IS that host, and a one-host
  // fleet stacked on itself would just restate the total with a legend.
  // The Array.isArray guard is version skew, not type doubt: the web bundle is
  // served from disk by a long-running server, so a rebuilt UI can face a
  // not-yet-restarted server whose overview response predates this field.
  // Falling back to the single total series beats crashing the whole view.
  const stacked =
    data.filters.sourceHostId === undefined &&
    data.bySourceHost.length > 1 &&
    Array.isArray(data.timelineBySourceHost);
  // Ranked by cost, so the slots go to the hosts that dominate the picture and
  // the stack builds biggest-first from the baseline. The trade-off: changing
  // the period can re-rank hosts and move one across a slot boundary, so the
  // legend — not colour memory — is the identity channel.
  const named = stacked ? data.bySourceHost.slice(0, HOST_SLOTS.length) : [];
  const folded = stacked ? data.bySourceHost.slice(HOST_SLOTS.length) : [];
  const series = [
    ...named.map((row, index) => ({
      key: `host-${index}`,
      color: HOST_SLOTS[index] as string,
      label: hostLabel(row.key),
      total: row[key],
    })),
    ...(folded.length > 0
      ? [
          {
            key: "other",
            color: CHART_INK.muted,
            label: t("headline.otherHosts"),
            total: folded.reduce((sum, row) => sum + row[key], 0),
          },
        ]
      : []),
  ];
  const slotByHost = new Map(named.map((row, index) => [row.key, `host-${index}`]));
  // Both branches produce the same plain-row shape so the chart's data prop
  // keeps one type; handing it the TimelinePoint[] directly would make the
  // union unassignable to recharts' inferred generic.
  const rows: Array<Record<string, number | string>> = stacked
    ? stackRows(
        data.timelineBySourceHost,
        key,
        (sourceHostId) => slotByHost.get(sourceHostId) ?? "other",
        series.map((item) => item.key),
      )
    : data.timeline.map(({ bucket, estimatedCost, totalTokens }) => ({
        bucket,
        estimatedCost,
        totalTokens,
      }));
  const grandTotal = data.totals[key];
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
        <>
          <ResponsiveContainer width="100%" height={168}>
            <AreaChart data={rows} margin={{ top: 10, right: 4, bottom: 0, left: 4 }}>
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
                // Sized from the widest tick this axis can actually produce, not
                // by eye: measured in the browser at 11px, Spanish "892,4 mil M"
                // — a token axis in the hundreds of billions — renders 57px, and
                // English is always narrower. 48px clipped it, and clipping a
                // compact number turns a precise figure into a misread one.
                width={64}
              />
              <Tooltip
                formatter={(value) => exactFormat(Number(value))}
                labelFormatter={(label) =>
                  typeof label === "string" ? formatBucketLabel(label) : null
                }
                contentStyle={{
                  background: PAGE_SURFACE,
                  border: `1px solid ${CHART_INK.grid}`,
                  borderRadius: 7,
                  fontSize: 11,
                }}
              />
              {stacked ? (
                series.map((item) => (
                  <Area
                    key={item.key}
                    type="monotone"
                    stackId="hosts"
                    dataKey={item.key}
                    stroke={item.color}
                    strokeWidth={2}
                    fill={item.color}
                    // Denser than the single-series 0.13 wash: stacked bands sit
                    // side by side and must read as fills, not tints, while the
                    // 2px stroke stays the separator between neighbours.
                    fillOpacity={0.3}
                    name={item.label}
                    activeDot={{ r: 4.5, strokeWidth: 2, stroke: CHART_SURFACE }}
                  />
                ))
              ) : (
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
              )}
            </AreaChart>
          </ResponsiveContainer>
          {stacked && (
            <ul className="legend">
              {series.map((item) => (
                <li key={item.key}>
                  <i className="dot" style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <span className="legend-count">{exactFormat(item.total)}</span>
                  <span className="legend-share">
                    {formatWholePercent(grandTotal > 0 ? (item.total / grandTotal) * 100 : 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

import { useTranslation } from "react-i18next";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { formatTokens, formatWholePercent } from "../model/format.ts";
import { tokenMix, type TokenMixKey } from "../model/token-mix.ts";

/**
 * `unreported` deliberately borrows the track colour rather than taking a fourth
 * series slot. It is an absence, not a category: giving it a data hue would put
 * it in the same visual language as measured values, and the palette's three
 * series colours are validated as a categorical set that a fourth would change.
 */
const SEGMENT_COLOR: Record<TokenMixKey, string> = {
  // The same slots as TOKEN_MIX in theme/palette.ts, as custom properties so
  // they follow the colour scheme.
  fresh: "var(--series-2)",
  output: "var(--series-3)",
  unreported: "var(--track)",
};

export function TokenMix({ totals }: { totals: UsageTotals }) {
  const { t } = useTranslation();
  const { segments, cached } = tokenMix(totals);
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (!total && !cached) return <p className="empty-state">{t("tokenMix.empty")}</p>;

  // Zero-token segments are dropped from the bar but kept in the legend. A
  // zero-width flex child still draws its gap, leaving a stray 2px seam; the
  // legend row, by contrast, is informative — "Output 0" says output was
  // measured and found none.
  const drawn = segments.filter((segment) => segment.tokens > 0);
  // The absence row is the exception: it is noise when there is nothing to
  // disclose, and only meaningful when a source actually stayed silent.
  const listed = segments.filter((segment) => segment.key !== "unreported" || segment.tokens > 0);

  return (
    <>
      {total > 0 && (
        <div className="stack" role="img" aria-label={t("tokenMix.composition")}>
          {drawn.map((segment) => (
            <span
              key={segment.key}
              style={{
                width: `${(segment.tokens / total) * 100}%`,
                background: SEGMENT_COLOR[segment.key],
              }}
            />
          ))}
        </div>
      )}
      <ul className="legend">
        {listed.map((segment) => (
          <li key={segment.key}>
            <i className="dot" style={{ background: SEGMENT_COLOR[segment.key] }} />
            <span>{t(`tokenMix.${segment.key}`)}</span>
            <span className="legend-count">{formatTokens(segment.tokens)}</span>
            <span className="legend-share">
              {segment.belowOnePercent
                ? `<${formatWholePercent(1)}`
                : formatWholePercent(segment.percent)}
            </span>
          </li>
        ))}
      </ul>
      {cached > 0 && (
        <p className="panel-label token-mix-note">
          {t("tokenMix.excludesCached", { tokens: formatTokens(cached) })}
        </p>
      )}
    </>
  );
}

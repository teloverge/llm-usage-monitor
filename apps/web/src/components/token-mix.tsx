import { useTranslation } from "react-i18next";
import type { UsageTotals } from "@llm-usage-monitor/contracts";
import { CHART_INK, TOKEN_MIX } from "../theme/palette.ts";
import { formatTokens, formatWholePercent } from "../model/format.ts";
import { tokenMixSegments, type TokenMixKey } from "../model/token-mix.ts";

/**
 * `unreported` deliberately borrows the track colour rather than taking a fourth
 * series slot. It is an absence, not a category: giving it a data hue would put
 * it in the same visual language as measured values, and the palette's three
 * series colours are validated as a categorical set that a fourth would change.
 */
const SEGMENT_COLOR: Record<TokenMixKey, string> = {
  ...TOKEN_MIX,
  unreported: CHART_INK.track,
};

export function TokenMix({ totals }: { totals: UsageTotals }) {
  const { t } = useTranslation();
  const segments = tokenMixSegments(totals);
  const total = segments.reduce((sum, segment) => sum + segment.tokens, 0);
  if (!total) return <p className="empty-state">{t("tokenMix.empty")}</p>;

  // Zero-token segments are dropped from the bar but kept in the legend. A
  // zero-width flex child still draws its gap, leaving a stray 2px seam; the
  // legend row, by contrast, is informative — "Cached 0" says caching was
  // measured and found none.
  const drawn = segments.filter((segment) => segment.tokens > 0);
  // The absence row is the exception: it is noise when there is nothing to
  // disclose, and only meaningful when a source actually stayed silent.
  const listed = segments.filter((segment) => segment.key !== "unreported" || segment.tokens > 0);

  return (
    <>
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
      <ul className="legend">
        {listed.map((segment) => (
          <li key={segment.key}>
            <i className="dot" style={{ background: SEGMENT_COLOR[segment.key] }} />
            <span>{t(`tokenMix.${segment.key}`)}</span>
            <span className="legend-count">{formatTokens(segment.tokens)}</span>
            <span className="legend-share">{formatWholePercent(segment.percent)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

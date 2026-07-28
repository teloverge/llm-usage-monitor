import { useTranslation } from "react-i18next";
import type { UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { formatDateTime, formatWholePercent, type QuotaStatus } from "../model/format.ts";
import { QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";

const FILL: Record<QuotaStatus, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
  unreported: "transparent",
};

export function QuotaMeters({
  snapshots,
  harnessLabel,
}: {
  snapshots: UsageQuotaSnapshot[];
  harnessLabel: (usageSourceId: string) => string;
}) {
  const { t } = useTranslation();
  if (!snapshots.length) return <p className="empty-state">{t("common.notReported")}</p>;
  return (
    <div className="quota-groups">
      {snapshots.map((snapshot) => (
        <div className="quota-group" key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}>
          <p className="quota-source">
            {harnessLabel(snapshot.usageSourceId)}
            {snapshot.plan ? ` · ${snapshot.plan}` : ""}
          </p>
          {snapshot.windows.map((window) => {
            const { status, shown, width } = quotaMeterView(window);
            const resets = window.resetsAt ? formatDateTime(window.resetsAt) : null;
            return (
              <div className="quota-window" key={window.id}>
                <p className="quota-head">
                  <b>{window.label}</b>
                  <span className={`quota-value ${status}`}>
                    {shown === null
                      ? t("common.notReported")
                      : `${QUOTA_GLYPH[status]} ${formatWholePercent(shown)}`.trim()}
                  </span>
                </p>
                {/*
                  No track at all when nothing was reported. An empty meter is
                  indistinguishable from a meter reading zero, and this dashboard
                  treats "did not say" and "said none" as different facts.
                */}
                {shown !== null && (
                  <div
                    className="meter"
                    role="meter"
                    aria-valuenow={shown}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuetext={t("quota.used", { percent: formatWholePercent(shown) })}
                    aria-label={window.label}
                  >
                    <i style={{ width: `${width}%`, background: FILL[status] }} />
                  </div>
                )}
                {resets && <p className="quota-reset">{t("quota.resets", { at: resets })}</p>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

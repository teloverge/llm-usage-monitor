import type { UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { formatDateTime, type QuotaStatus } from "../model/format.ts";
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
  if (!snapshots.length) return <p className="empty-state">Not reported</p>;
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
                    {shown === null ? "Not reported" : `${QUOTA_GLYPH[status]} ${shown}%`.trim()}
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
                    aria-valuetext={`${shown}% used`}
                    aria-label={window.label}
                  >
                    <i style={{ width: `${width}%`, background: FILL[status] }} />
                  </div>
                )}
                {resets && <p className="quota-reset">resets {resets}</p>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

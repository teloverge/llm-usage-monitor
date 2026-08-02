import { useTranslation } from "react-i18next";
import type { CredentialObservation, UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { countsAgainstPlan, credentialModeKey, latestCredential } from "../model/credential.ts";
import { formatDateTime, formatWholePercent, type QuotaStatus } from "../model/format.ts";
import { QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";
import { quotaWindowLabel } from "../model/quota-window.ts";

const FILL: Record<QuotaStatus, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
  unreported: "transparent",
};

export function QuotaMeters({
  snapshots,
  harnessLabel,
  credentials,
}: {
  snapshots: UsageQuotaSnapshot[];
  harnessLabel: (usageSourceId: string) => string;
  credentials: CredentialObservation[];
}) {
  const { t } = useTranslation();
  if (!snapshots.length) return <p className="empty-state">{t("common.notReported")}</p>;
  return (
    <div className="quota-groups">
      {snapshots.map((snapshot) => {
        const observedAt = formatDateTime(snapshot.observedAt);
        const credential = latestCredential(
          credentials,
          snapshot.usageSourceId,
          snapshot.sourceHostId,
        );
        return (
          <div className="quota-group" key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}>
            <p className="quota-source">
              <span>
                {harnessLabel(snapshot.usageSourceId)}
                {snapshot.plan ? ` · ${snapshot.plan}` : ""}
              </span>
              {/*
                These figures are caches refreshed only while their harness is
                running, so the age of the reading is part of the claim. A bare
                percentage with no date asserts more than the source supports.
              */}
              {observedAt && (
                <span className="quota-observed">{t("quota.asOf", { at: observedAt })}</span>
              )}
            </p>
            {credential && (
              <p className="quota-credential">
                <span className={countsAgainstPlan(credential.mode) ? "" : "off-plan"}>
                  {t(`credential.mode.${credentialModeKey(credential.mode)}`)}
                </span>
                {/*
                  Codex states its mode; Claude's is deduced from an environment
                  this process may not fully see. Marking the difference is the
                  same instinct as reporting unreported rather than zero.
                */}
                {credential.inferred && <em>{t("credential.inferred")}</em>}
              </p>
            )}
            {credential &&
              !countsAgainstPlan(credential.mode) && (
                // The reason this feature exists: without it a percentage sits
                // beside spend that never touched the window it describes.
                <p className="quota-note">{t("credential.notCounted")}</p>
              )}
            {snapshot.windows.map((window) => {
              const { status, shown, width } = quotaMeterView(window);
              const resets = window.resetsAt ? formatDateTime(window.resetsAt) : null;
              const label = quotaWindowLabel(window, t);
              return (
                <div className="quota-window" key={window.id}>
                  <p className="quota-head">
                    <b>{label}</b>
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
                      aria-label={label}
                    >
                      <i style={{ width: `${width}%`, background: FILL[status] }} />
                    </div>
                  )}
                  {resets && <p className="quota-reset">{t("quota.resets", { at: resets })}</p>}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

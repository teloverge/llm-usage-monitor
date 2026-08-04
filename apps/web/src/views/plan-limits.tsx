import { useTranslation } from "react-i18next";
import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { countsAgainstPlan, credentialLabel } from "../model/credential.ts";
import { formatDateTime, formatWholePercent, type QuotaStatus } from "../model/format.ts";
import { usageSourceLabel } from "../model/harness.ts";
import { cardInferred, planCards } from "../model/plan-limits.ts";
import { QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";
import { quotaWindowLabel } from "../model/quota-window.ts";
import { Panel } from "../components/panel.tsx";

const FILL: Record<QuotaStatus, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
  unreported: "transparent",
};

export function PlanLimits({
  snapshots,
  credentials,
  hostLabel,
}: {
  snapshots: QuotaSnapshotView[];
  credentials: CredentialObservation[];
  hostLabel: (sourceHostId: string) => string;
}) {
  const { t } = useTranslation();
  const cards = planCards(snapshots);
  if (!cards.length) return <p className="empty-state">{t("planLimits.empty")}</p>;
  return (
    <div className="plan-cards">
      {cards.map((card) => (
        <Panel
          key={card.credentialId ?? `source:${card.snapshots[0]!.usageSourceId}`}
          label={
            card.credentialId ? credentialLabel(card.credentialId, t) : t("credential.unattributed")
          }
          className={card.active ? "plan-card-active" : ""}
        >
          <p className="quota-credential">
            {card.plan && <span>{card.plan}</span>}
            {card.active && <b className="plan-active">{t("planLimits.active")}</b>}
            {/*
              Codex states its mode; Claude's is deduced from an environment
              this process may not fully see. Marking the difference is the
              same instinct as reporting unreported rather than zero.
            */}
            {cardInferred(card, credentials) && <em>{t("credential.inferred")}</em>}
          </p>
          {card.mode && !countsAgainstPlan(card.mode) && (
            // The reason this feature exists: without it a percentage sits
            // beside spend that never touched the window it describes.
            <p className="quota-note">{t("credential.notCounted")}</p>
          )}
          <div className="quota-groups">
            {card.snapshots.map((snapshot) => {
              const observedAt = formatDateTime(snapshot.observedAt);
              return (
                <div
                  className="quota-group"
                  key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}
                >
                  <p className="quota-source">
                    <span>
                      {usageSourceLabel(snapshot.usageSourceId)} · {hostLabel(snapshot.sourceHostId)}
                    </span>
                    {/*
                      These figures are caches refreshed only while their harness
                      is running, so the age of the reading is part of the claim.
                      A bare percentage with no date asserts more than the source
                      supports.
                    */}
                    {observedAt && (
                      <span className="quota-observed">{t("quota.asOf", { at: observedAt })}</span>
                    )}
                  </p>
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
                          No track at all when nothing was reported. An empty meter
                          is indistinguishable from a meter reading zero, and this
                          dashboard treats "did not say" and "said none" as
                          different facts.
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
                        {resets && (
                          <p className="quota-reset">{t("quota.resets", { at: resets })}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}

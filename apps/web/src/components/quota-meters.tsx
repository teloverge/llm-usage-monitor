import { useTranslation } from "react-i18next";
import type { CredentialObservation, UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import {
  countsAgainstPlan,
  credentialModeKey,
  fingerprintTag,
  planLabel,
} from "../model/credential.ts";
import {
  formatCount,
  formatDateTime,
  formatList,
  formatWholePercent,
  type QuotaStatus,
} from "../model/format.ts";
import { quotaAccounts, quotaProviders, type QuotaAccount } from "../model/quota-account.ts";
import { isStaleReading, QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";
import { quotaWindowLabel } from "../model/quota-window.ts";

/** The STATUS slots, as custom properties so they follow the colour scheme. */
const FILL: Record<QuotaStatus, string> = {
  good: "var(--status-good)",
  warning: "var(--status-warning)",
  critical: "var(--status-critical)",
  unreported: "transparent",
};

export function QuotaMeters({
  snapshots,
  harnessLabel,
  hostLabel,
  credentials,
}: {
  snapshots: UsageQuotaSnapshot[];
  harnessLabel: (usageSourceId: string) => string;
  hostLabel: (sourceHostId: string) => string;
  credentials: CredentialObservation[];
}) {
  const { t } = useTranslation();
  if (!snapshots.length) return <p className="empty-state">{t("common.notReported")}</p>;
  const now = new Date();
  /**
   * One account's card. Its title names the plan and the account's fingerprint
   * tag, so two subscriptions on one provider read apart; the provider name
   * leads only when no group heading already says it.
   */
  const card = ({ snapshot, credential, sourceHostIds }: QuotaAccount, grouped: boolean) => {
    const title = [
      grouped ? "" : harnessLabel(snapshot.usageSourceId),
      snapshot.plan ? planLabel(snapshot.plan) : "",
      fingerprintTag(credential?.fingerprint ?? ""),
    ]
      .filter(Boolean)
      .join(" · ");
    const observedAt = formatDateTime(snapshot.observedAt);
    const stale = isStaleReading(snapshot.observedAt, now);
    const source = (
      <p className="quota-source">
        <span>{title}</span>
        {/*
              These figures are caches refreshed only while their harness is
              running, so the age of the reading is part of the claim. A bare
              percentage with no date asserts more than the source supports,
              and one more than a day old says so outright.
            */}
        {observedAt && (
          <span
            className={`quota-observed${stale ? " stale" : ""}`}
            title={stale ? t("quota.stale") : undefined}
          >
            {stale ? `${QUOTA_GLYPH.warning} ` : ""}
            {t("quota.asOf", { at: observedAt })}
            {stale && <span className="sr-only"> · {t("quota.stale")}</span>}
          </span>
        )}
      </p>
    );
    const key = `${snapshot.usageSourceId}/${snapshot.sourceHostId}`;
    // An account with no live window has nothing to meter. It keeps one
    // line — the account exists and was seen — rather than the full card
    // of hosts and credential detail around an empty space.
    if (!snapshot.windows.length) {
      return (
        <div className="quota-group quota-group-empty" key={key}>
          {source}
          <p className="quota-note">{t("quota.noWindows")}</p>
        </div>
      );
    }
    return (
      <div className="quota-group" key={key}>
        {source}
        {/*
              Named only when the meter stands for more than one host. A single
              host is the ordinary case and naming it would say nothing the
              Hosts panel does not.
            */}
        {sourceHostIds.length > 1 && (
          <p className="quota-hosts">
            {t("quota.hosts", { hosts: formatList(sourceHostIds.map(hostLabel)) })}
          </p>
        )}
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
                  // The account title leads: two accounts each have a
                  // "Weekly window", and the label alone would not say whose.
                  aria-label={`${title} · ${label}`}
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
  };
  return (
    <div className="quota-groups">
      {quotaProviders(quotaAccounts(snapshots, credentials)).map(({ usageSourceId, accounts }) => {
        if (accounts.length === 1) return card(accounts[0]!, false);
        // Several accounts on one provider sit under one collapsible heading,
        // open by default: the meters are the point of the panel, and the
        // heading's job is to say they belong together.
        return (
          <details className="quota-provider" key={usageSourceId} open>
            <summary>
              {harnessLabel(usageSourceId)}
              <span className="quota-provider-count">
                {" · "}
                {t("common.accountCount", {
                  count: accounts.length,
                  accounts: formatCount(accounts.length),
                })}
              </span>
            </summary>
            <div className="quota-provider-accounts">
              {accounts.map((account) => card(account, true))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

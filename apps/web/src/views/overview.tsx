import { useTranslation } from "react-i18next";
import type { OverviewView } from "@llm-usage-monitor/contracts";
import { credentialLabeler } from "../model/credential.ts";
import { harnessLabel, usageSourceLabel } from "../model/harness.ts";
import { Headline } from "../components/headline.tsx";
import { Panel, Zone } from "../components/panel.tsx";
import { QuotaMeters } from "../components/quota-meters.tsx";
import { RankList } from "../components/rank-list.tsx";
import { CostStrip, StatStrip } from "../components/stat-strip.tsx";
import { TokenMix } from "../components/token-mix.tsx";

export function Overview({
  data,
  hostLabel,
  onDrillDown,
}: {
  data: OverviewView;
  hostLabel: (sourceHostId: string) => string;
  onDrillDown: (dimension: "byHarness" | "byModel" | "byTask") => void;
}) {
  const { t } = useTranslation();
  // Relabelled here rather than inside RankList: the list ranks rows by cost and
  // knows nothing about harnesses, and a `byHarness` row's key IS its harness id.
  // Its children are credential ids, named the way the filter chip names them.
  const credentialName = credentialLabeler(
    data.credentials,
    t,
    usageSourceLabel,
    data.quotaSnapshots,
  );
  // Under its harness an account drops the harness's own name — "Pro · …7053"
  // beneath "Codex" — keeping the full name for its tooltip.
  const harnessRows = data.byHarness.map((row) => {
    const name = harnessLabel(row.key, t("common.unknownHarness"));
    return {
      ...row,
      key: name,
      children: row.children?.map((child) => {
        const full = credentialName(child.key);
        const prefix = `${name} · `;
        return {
          ...child,
          key: full.startsWith(prefix) ? full.slice(prefix.length) : full,
          title: full,
        };
      }),
    };
  });
  // Same treatment, same reason: a `bySourceHost` row's key IS its host id, and
  // naming an unnamed host needs translated positional wording the analysis
  // layer cannot supply.
  const hostRows = data.bySourceHost.map((row) => ({ ...row, key: hostLabel(row.key) }));
  return (
    <div className="cockpit">
      <div className="cockpit-main">
        <Headline data={data} hostLabel={hostLabel} />
        <StatStrip totals={data.totals} />
        <CostStrip breakdown={data.totals.costBreakdown} />
        <Zone>{t("overview.drivers")}</Zone>
        <div className="drivers">
          <Panel label={t("overview.byHarness")}>
            <RankList rows={harnessRows} onMore={() => onDrillDown("byHarness")} expandChildren />
          </Panel>
          <Panel label={t("overview.byModel")}>
            <RankList rows={data.byModel} onMore={() => onDrillDown("byModel")} />
          </Panel>
          <Panel label={t("overview.byTask")}>
            <RankList rows={data.byTask} onMore={() => onDrillDown("byTask")} />
          </Panel>
        </div>
      </div>
      <div className="cockpit-rail">
        <Zone>{t("overview.context")}</Zone>
        {/* No total in the title: the stat strip's "Tokens" already states it. */}
        <Panel label={t("overview.tokenMix")}>
          <TokenMix totals={data.totals} />
        </Panel>
        <Panel label={t("overview.planLimits")}>
          {/*
            Keyed by usageSourceId, not harnessId — one row per account, however
            many hosts are signed in to it. `usageSourceLabel` derives its names
            from the same table `harnessLabel` uses, so the two panels cannot
            disagree about what "Codex" is called.
          */}
          <QuotaMeters
            snapshots={data.quotaSnapshots}
            harnessLabel={usageSourceLabel}
            hostLabel={hostLabel}
            credentials={data.credentials}
          />
        </Panel>
        <Panel label={t("overview.hosts")}>
          <RankList rows={hostRows} limit={5} />
        </Panel>
      </div>
    </div>
  );
}

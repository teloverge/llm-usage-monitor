import { useTranslation } from "react-i18next";
import type { OverviewView } from "@llm-usage-monitor/contracts";
import { formatTokens } from "../model/format.ts";
import { harnessLabel, usageSourceLabel } from "../model/harness.ts";
import { Headline } from "../components/headline.tsx";
import { Panel, Zone } from "../components/panel.tsx";
import { QuotaMeters } from "../components/quota-meters.tsx";
import { RankList } from "../components/rank-list.tsx";
import { StatStrip } from "../components/stat-strip.tsx";
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
  const harnessRows = data.byHarness.map((row) => ({
    ...row,
    key: harnessLabel(row.key, t("common.unknownHarness")),
  }));
  // Same treatment, same reason: a `bySourceHost` row's key IS its host id, and
  // naming an unnamed host needs translated positional wording the analysis
  // layer cannot supply.
  const hostRows = data.bySourceHost.map((row) => ({ ...row, key: hostLabel(row.key) }));
  return (
    <div className="cockpit">
      <div className="cockpit-main">
        <Headline data={data} />
        <StatStrip totals={data.totals} />
        <Zone>{t("overview.drivers")}</Zone>
        <div className="drivers">
          <Panel label={t("overview.byHarness")}>
            <RankList rows={harnessRows} onMore={() => onDrillDown("byHarness")} />
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
        <Panel label={t("overview.tokenMix")} meta={formatTokens(data.totals.totalTokens)}>
          <TokenMix totals={data.totals} />
        </Panel>
        <Panel label={t("overview.planLimits")}>
          {/*
            Keyed by usageSourceId, not harnessId — one row per account per host.
            `usageSourceLabel` derives its names from the same table `harnessLabel`
            uses, so the two panels cannot disagree about what "Codex" is called.
          */}
          <QuotaMeters
            snapshots={data.quotaSnapshots}
            harnessLabel={usageSourceLabel}
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

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
  onDrillDown,
}: {
  data: OverviewView;
  onDrillDown: (dimension: "byHarness" | "byModel" | "byTask") => void;
}) {
  // Relabelled here rather than inside RankList: the list ranks rows by cost and
  // knows nothing about harnesses, and a `byHarness` row's key IS its harness id.
  const harnessRows = data.byHarness.map((row) => ({
    ...row,
    key: harnessLabel(row.key, "Unknown harness"),
  }));
  return (
    <div className="cockpit">
      <div className="cockpit-main">
        <Headline data={data} />
        <StatStrip totals={data.totals} />
        <Zone>What drove it</Zone>
        <div className="drivers">
          <Panel label="By harness">
            <RankList rows={harnessRows} onMore={() => onDrillDown("byHarness")} />
          </Panel>
          <Panel label="By model">
            <RankList rows={data.byModel} onMore={() => onDrillDown("byModel")} />
          </Panel>
          <Panel label="By task">
            <RankList rows={data.byTask} onMore={() => onDrillDown("byTask")} />
          </Panel>
        </div>
      </div>
      <div className="cockpit-rail">
        <Zone>Context</Zone>
        <Panel label="Token mix" meta={formatTokens(data.totals.totalTokens)}>
          <TokenMix totals={data.totals} />
        </Panel>
        <Panel label="Plan limits">
          {/*
            Keyed by usageSourceId, not harnessId — one row per account per host.
            `usageSourceLabel` derives its names from the same table `harnessLabel`
            uses, so the two panels cannot disagree about what "Codex" is called.
          */}
          <QuotaMeters snapshots={data.quotaSnapshots} harnessLabel={usageSourceLabel} />
        </Panel>
        <Panel label="Hosts">
          <RankList rows={data.bySourceHost} limit={5} />
        </Panel>
      </div>
    </div>
  );
}

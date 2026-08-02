import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  SourceHost,
  UsageFilters,
  UsageHistoryRecord,
} from "@llm-usage-monitor/contracts";
import { useTranslation } from "react-i18next";
import { SearchChip, SelectChip } from "./components/chip.tsx";
import { credentialOptions } from "./model/credential.ts";
import { sourceHostLabel, sourceHostLabels } from "./model/source-host.ts";
import { executeAction, getCatalog, getHistory, getOverview } from "./api.ts";
import { History } from "./views/history.tsx";
import { Settings } from "./views/settings/index.tsx";
import { Breakdown, type BreakdownDimension } from "./views/breakdown.tsx";
import { Overview } from "./views/overview.tsx";
import logoUrl from "../../../assets/Teloverge-lum-logo.svg?url";

export type View = "overview" | "breakdown" | "history";

/** The subset the Overview's rank panels can drill into. */
export type DrillDownDimension = Extract<BreakdownDimension, "byHarness" | "byModel" | "byTask">;

/** Ids only. The labels are looked up per render so they follow the language. */
const VIEWS: readonly View[] = ["overview", "breakdown", "history"];

const TIMEFRAMES = ["today", "last24", "7", "30", "90", "all"] as const;

export function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("overview");
  /** Which dimension the Breakdown opens on, so a drill-down lands where it was aimed. */
  const [breakdownDimension, setBreakdownDimension] = useState<BreakdownDimension>("byModel");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filters, setFilters] = useState<UsageFilters>({ timeframe: "30" });
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [history, setHistory] = useState<UsageHistoryRecord[]>([]);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [sourceHosts, setSourceHosts] = useState<SourceHost[]>([]);
  const [hostGroups, setHostGroups] = useState<HostGroup[]>([]);
  const [memberships, setMemberships] = useState<HostGroupMembership[]>([]);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /**
   * Guards against a stale response overwriting a newer one. The search chip fires
   * on every keystroke, so typing a five-character query launches five overlapping
   * refetches with no ordering guarantee — and switching Period from "all" (a full
   * history scan) to "today" (cheap) is exactly the shape where the slow response
   * lands last. Whichever finishes last would otherwise win, silently showing
   * results for a query the user has already moved past.
   *
   * A useEffect cleanup flag is not sufficient on its own: refresh() is also called
   * directly by the Refresh-sources button and after a price save, and those call
   * sites must participate in the same sequence.
   */
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setStale(true);
    try {
      setError("");
      const [nextOverview, nextHistory, catalog] = await Promise.all([
        getOverview(filters),
        getHistory(),
        getCatalog(),
      ]);
      if (id !== requestId.current) return;
      setOverview(nextOverview);
      setHistory(nextHistory);
      setPrices(catalog.prices);
      setSourceHosts(catalog.sourceHosts);
      setHostGroups(catalog.hostGroups);
      setMemberships(catalog.memberships);
    } catch (reason) {
      if (id === requestId.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    } finally {
      if (id === requestId.current) setStale(false);
    }
  }, [filters]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refreshSources = async () => {
    setBusy(true);
    try {
      // Sequential, and neither is allowed to cancel the other: a machine with
      // only one harness installed still has the other's import succeed trivially
      // with zero records, so a hard failure here is a real fault worth surfacing
      // rather than an expected "not installed" case.
      await executeAction({ version: 1, type: "import-codex" });
      await executeAction({ version: 1, type: "import-claude" });
      await executeAction({ version: 1, type: "import-grok" });
      await refresh();
    } catch (reason) {
      // Without this the import failure is an unhandled rejection: refresh() never
      // runs, no error state is ever set, and the button quietly returns to normal
      // as though the import had succeeded.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Built once here rather than per view, so a host reads as the same
   * "Source Host 3" in the Hosts panel, the Breakdown, and the History table.
   * Rebuilding it per panel would renumber against whatever subset that panel
   * ranked.
   */
  const hostLabel = useMemo(
    () => sourceHostLabels(sourceHosts, (index) => t("common.sourceHostFallback", { index })),
    [sourceHosts, t],
  );

  const drillDown = (dimension: DrillDownDimension) => {
    setBreakdownDimension(dimension);
    setSettingsOpen(false);
    setView("breakdown");
  };

  const change = (key: keyof UsageFilters, value: string) =>
    setFilters({ ...filters, [key]: value || undefined });

  return (
    <>
      <link rel="icon" href={logoUrl} />
      <div className="app-shell">
        <header className="topbar">
          <img className="brand-mark" src={logoUrl} alt="" />
          <strong className="brand-name">{t("app.brand")}</strong>
          <nav aria-label={t("app.sections")}>
            {VIEWS.map((item) => {
              // Settings renders over the top of whichever view is selected, so while
              // it is open no nav item is current. Without this the nav would keep
              // highlighting Overview — visually and to assistive tech — while
              // Settings is on screen.
              const current = !settingsOpen && view === item;
              return (
                <button
                  key={item}
                  type="button"
                  className={current ? "active" : ""}
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    setSettingsOpen(false);
                    setView(item);
                  }}
                >
                  {t(`nav.${item}`)}
                </button>
              );
            })}
          </nav>
          <div className="chips">
            <SelectChip
              label={t("filters.period")}
              value={filters.timeframe}
              options={TIMEFRAMES.map((value) => ({ value, label: t(`period.select.${value}`) }))}
              onChange={(value) => change("timeframe", value)}
            />
            <SelectChip
              label={t("filters.host")}
              value={filters.sourceHostId ?? ""}
              options={[
                { value: "", label: t("filters.allHosts") },
                ...sourceHosts.map((host, index) => ({
                  value: host.id,
                  // Must go through sourceHostLabel, not host.hostname directly —
                  // some machines report a MAC address as their hostname.
                  label: sourceHostLabel(
                    host,
                    t("common.sourceHostFallback", { index: index + 1 }),
                  ),
                })),
              ]}
              onChange={(value) => change("sourceHostId", value)}
            />
            <SelectChip
              label={t("filters.credential")}
              value={filters.credentialId ?? ""}
              options={credentialOptions(overview?.credentials ?? [], t)}
              onChange={(value) => change("credentialId", value)}
            />
            <SearchChip
              value={filters.query ?? ""}
              placeholder={t("filters.searchTasks")}
              onChange={(value) => change("query", value)}
            />
            <button type="button" className="primary" disabled={busy} onClick={refreshSources}>
              {busy ? t("filters.refreshing") : t("filters.refresh")}
            </button>
            <button
              type="button"
              className="gear"
              aria-label={t("filters.settings")}
              aria-expanded={settingsOpen ? "true" : "false"}
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              ⚙
            </button>
          </div>
        </header>
        <main className={stale ? "stale" : ""}>
          {/*
            The page's only <h1>. Task 8 deletes the hero that currently holds one,
            and the brand in the topbar is deliberately NOT a heading — it is chrome,
            identical across every view. Without this, the heading outline would start
            at <h2> with no root: a headings-list scan (NVDA Insert+F7, JAWS Insert+F6)
            would have nothing to land on, and every Panel/Zone call site in Tasks
            19–28 would inherit the gap.

            It names the CURRENT VIEW rather than the product, because switching views
            re-renders without a navigation, so there is no page-load announcement.
            This heading changing is what tells an assistive-tech user the view changed.
          */}
          <h1 className="sr-only">{t("app.viewHeading", { view: t(`nav.${view}`) })}</h1>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <ViewSlot
            view={view}
            settingsOpen={settingsOpen}
            overview={overview}
            history={history}
            prices={prices}
            hostGroups={hostGroups}
            memberships={memberships}
            sourceHosts={sourceHosts}
            hostLabel={hostLabel}
            onSaved={refresh}
            onDrillDown={drillDown}
            breakdownDimension={breakdownDimension}
            onBreakdownDimensionChange={setBreakdownDimension}
          />
        </main>
        <footer>{t("app.footer")}</footer>
      </div>
    </>
  );
}

function ViewSlot({
  view,
  settingsOpen,
  overview,
  history,
  prices,
  hostGroups,
  memberships,
  sourceHosts,
  hostLabel,
  onSaved,
  onDrillDown,
  breakdownDimension,
  onBreakdownDimensionChange,
}: {
  view: View;
  settingsOpen: boolean;
  overview: OverviewView | null;
  history: UsageHistoryRecord[];
  prices: ModelPrice[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  hostLabel: (sourceHostId: string) => string;
  onSaved: () => Promise<void>;
  onDrillDown: (dimension: DrillDownDimension) => void;
  breakdownDimension: BreakdownDimension;
  onBreakdownDimensionChange: (value: BreakdownDimension) => void;
}) {
  if (settingsOpen)
    return (
      <Settings
        prices={prices}
        hostGroups={hostGroups}
        memberships={memberships}
        sourceHosts={sourceHosts}
        onSaved={onSaved}
      />
    );
  if (view === "overview")
    return overview ? (
      <Overview data={overview} hostLabel={hostLabel} onDrillDown={onDrillDown} />
    ) : null;
  if (view === "breakdown")
    return overview ? (
      <Breakdown
        data={overview}
        hostLabel={hostLabel}
        dimension={breakdownDimension}
        onDimensionChange={onBreakdownDimensionChange}
      />
    ) : null;
  return <History records={history} hostLabel={hostLabel} />;
}

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  ModelPrice,
  OverviewView,
  RankedUsage,
  SourceHost,
  UsageFilters,
  UsageHistoryRecord,
  UsageModeFlags,
} from "@llm-usage-monitor/contracts";
import { executeAction, getCatalog, getHistory, getOverview } from "./api.ts";
import { groupHistoryByTask, groupModelsByProvider, type HistorySession } from "./usage-groups.ts";
import logoUrl from "../../../assets/Teloverge-lum-logo.svg?url";

type View = "overview" | "history" | "advanced" | "pricing";
const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});
const number = new Intl.NumberFormat();
const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const colors = ["#16c79a", "#4d8dff", "#f4b942", "#ed6a8b"];

export function App() {
  const [view, setView] = useState<View>("overview");
  const [filters, setFilters] = useState<UsageFilters>({ timeframe: "30" });
  const [overview, setOverview] = useState<OverviewView | null>(null);
  const [history, setHistory] = useState<UsageHistoryRecord[]>([]);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [sourceHosts, setSourceHosts] = useState<SourceHost[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setError("");
      const [nextOverview, nextHistory, catalog] = await Promise.all([
        getOverview(filters),
        getHistory(),
        getCatalog(),
      ]);
      setOverview(nextOverview);
      setHistory(nextHistory);
      setPrices(catalog.prices);
      setSourceHosts(catalog.sourceHosts);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [filters]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const refreshCodex = async () => {
    setBusy(true);
    try {
      await executeAction({ version: 1, type: "import-codex" });
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const sourceHostCount = sourceHosts.length || 1;

  return (
    <>
      <link rel="icon" href={logoUrl} />
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <img className="brand-mark" src={logoUrl} alt="Teloverge LLM Usage Monitor" />
            <div>
              <strong>LLM Usage Monitor</strong>
              <small>Powered by Teloverge</small>
            </div>
          </div>
          <nav aria-label="Dashboard sections">
            {(["overview", "history", "advanced", "pricing"] as View[]).map((item) => (
              <button
                key={item}
                className={view === item ? "active" : ""}
                onClick={() => setView(item)}
              >
                {item === "advanced" ? "Advanced" : title(item)}
              </button>
            ))}
          </nav>
          <button className="primary" disabled={busy} onClick={refreshCodex}>
            {busy ? "Refreshing…" : "Refresh Codex"}
          </button>
        </header>
        <main>
          <section className={`hero ${view === "pricing" ? "pricing-hero" : ""}`}>
            <div>
              <span className="eyebrow">LOCAL USAGE INTELLIGENCE</span>
              <h1>{view === "overview" ? "Your API-equivalent spend, in focus." : title(view)}</h1>
              <p>
                {view === "pricing"
                  ? "Edit the local rate catalog used for API-equivalent estimates."
                  : `Canonical analysis across ${sourceHostCount} Source Host${sourceHostCount === 1 ? "" : "s"}.`}
              </p>
            </div>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
          </section>
          {view !== "pricing" && (
            <FilterBar filters={filters} sourceHosts={sourceHosts} onChange={setFilters} />
          )}
          {view === "overview" && overview && <Overview data={overview} />}
          {view === "history" && <History records={history} />}
          {view === "advanced" && overview && <Advanced data={overview} />}
          {view === "pricing" && <Pricing prices={prices} onSaved={refresh} />}
        </main>
        <footer>
          All usage analysis stays local · API-equivalent estimates are not billing claims.
        </footer>
      </div>
    </>
  );
}

function FilterBar({
  filters,
  sourceHosts,
  onChange,
}: {
  filters: UsageFilters;
  sourceHosts: SourceHost[];
  onChange: (value: UsageFilters) => void;
}) {
  const change = (key: keyof UsageFilters, value: string) =>
    onChange({ ...filters, [key]: value || undefined });
  return (
    <section className="filters" aria-label="Usage filters">
      <label>
        Timeframe
        <select
          value={filters.timeframe}
          onChange={(event) => change("timeframe", event.target.value)}
        >
          <option value="today">Today</option>
          <option value="last24">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All retained</option>
        </select>
      </label>
      <label>
        Source Host
        <select
          value={filters.sourceHostId ?? ""}
          onChange={(event) => change("sourceHostId", event.target.value)}
        >
          <option value="">Entire Fleet</option>
          {sourceHosts.map((host, index) => (
            <option key={host.id} value={host.id}>
              {safeSourceHostLabel(host, index)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Task search
        <input
          type="search"
          value={filters.query ?? ""}
          placeholder="Filter task names"
          onChange={(event) => change("query", event.target.value)}
        />
      </label>
    </section>
  );
}

function Overview({ data }: { data: OverviewView }) {
  const tokenComposition = [
    { name: "Uncached input", value: data.totals.inputTokens - data.totals.cachedInputTokens },
    { name: "Cached input", value: data.totals.cachedInputTokens },
    { name: "Output", value: data.totals.outputTokens },
  ];
  return (
    <>
      <section className="metrics">
        <Metric
          featured
          label="API-equivalent estimate"
          value={money.format(data.totals.estimatedCost)}
          note={`${data.totals.pricedRecords} priced records`}
        />
        <Metric
          label="Total tokens"
          value={number.format(data.totals.totalTokens)}
          note={`${data.totals.records} records`}
        />
        <Metric
          label="Cache efficiency"
          value={`${(data.totals.cacheEfficiency * 100).toFixed(1)}%`}
          note="of input tokens"
        />
        <Metric
          label="Active work"
          value={number.format(data.totals.tasks)}
          note={`${data.totals.models} models`}
        />
      </section>
      <p className="notice">
        <strong>API-equivalent estimate.</strong> This shows what the selected usage would cost at
        configured standard API token rates; it may not be an amount billed under a subscription.
      </p>
      <section className="chart-grid">
        <ChartCard
          title="API-equivalent estimate over time"
          summary={`${money.format(data.totals.estimatedCost)} across ${data.timeline.length} periods`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={data.timeline} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickFormatter={shortDate} />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <Tooltip formatter={(value) => money.format(Number(value))} />
              <Area
                type="monotone"
                dataKey="estimatedCost"
                stroke={colors[0]}
                fill="#16c79a33"
                name="Estimate"
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
        <ChartCard
          title="Tokens over time"
          summary={`${number.format(data.totals.totalTokens)} total tokens`}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data.timeline} accessibilityLayer>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" tickFormatter={shortDate} />
              <YAxis tickFormatter={(value) => compact.format(Number(value))} />
              <Tooltip formatter={(value) => number.format(Number(value))} />
              <Bar dataKey="inputTokens" stackId="tokens" fill={colors[1]} name="Input" />
              <Bar dataKey="outputTokens" stackId="tokens" fill={colors[2]} name="Output" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        <RankChart title="Cost by model" rows={data.byModel.slice(0, 8)} />
        <RankChart title="Top tasks" rows={data.byTask.slice(0, 8)} />
        <ChartCard title="Token composition" summary="Input, cache, and output">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart accessibilityLayer>
              <Pie
                data={tokenComposition}
                dataKey="value"
                nameKey="name"
                innerRadius={52}
                outerRadius={82}
              >
                {tokenComposition.map((item, index) => (
                  <Cell key={item.name} fill={colors[index]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => number.format(Number(value))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
        <LimitsCard data={data} />
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  note,
  featured,
}: {
  label: string;
  value: string;
  note: string;
  featured?: boolean;
}) {
  return (
    <article className={`metric ${featured ? "featured" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function ChartCard({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <article className="card">
      <header>
        <h2>{title}</h2>
        <p>{summary}</p>
      </header>
      {children}
    </article>
  );
}
function RankChart({ title, rows }: { title: string; rows: RankedUsage[] }) {
  const maximum = Math.max(0, ...rows.map((row) => row.estimatedCost));
  return (
    <ChartCard title={title} summary="Ranked automatically by estimated cost">
      <div className="ranks">
        {rows.length ? (
          rows.map((row) => (
            <div className="rank" key={`${row.provider ?? ""}/${row.key}`}>
              <span className="rank-label" title={row.key}>
                {row.provider && <small>{row.provider}</small>}
                <span>{row.key}</span>
                <ModeBadges flags={row.modeFlags} />
              </span>
              <i>
                <b style={{ width: `${maximum ? (row.estimatedCost / maximum) * 100 : 0}%` }} />
              </i>
              <strong>{money.format(row.estimatedCost)}</strong>
            </div>
          ))
        ) : (
          <p>No priced usage.</p>
        )}
      </div>
    </ChartCard>
  );
}
function LimitsCard({ data }: { data: OverviewView }) {
  const limits = data.latestRateLimits;
  return (
    <ChartCard title="Plan limits" summary={limits?.planType || "No limit snapshot"}>
      <div className="limit-list">
        {(
          [
            ["Primary", limits?.primary],
            ["Weekly", limits?.secondary],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value ? `${value.usedPercent.toFixed(1)}%` : "—"}</strong>
            <progress max="100" value={value?.usedPercent ?? 0} />
            <small>
              {value?.resetsAt
                ? `Resets ${new Date(value.resetsAt * 1000).toLocaleString()}`
                : "No reset available"}
            </small>
          </div>
        ))}
      </div>
    </ChartCard>
  );
}
function History({ records }: { records: UsageHistoryRecord[] }) {
  const groups = useMemo(() => groupHistoryByTask(records), [records]);
  const sessionCount = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  return (
    <section>
      <div className="section-summary">
        <strong>
          {groups.length} task{groups.length === 1 ? "" : "s"}
        </strong>
        <span>
          {sessionCount} session{sessionCount === 1 ? "" : "s"} · {records.length} usage records
        </span>
      </div>
      <div className="history-groups">
        {groups.length ? (
          groups.map((group, index) => (
            <details className="history-group" key={group.key} open={index === 0}>
              <summary>
                <span className="summary-copy">
                  <strong>{group.label}</strong>
                  <small>
                    {group.sessions.length} session{group.sessions.length === 1 ? "" : "s"} ·{" "}
                    {formatRecordCount(group.records.length)} · {number.format(group.totalTokens)}{" "}
                    tokens
                  </small>
                </span>
                <span className="summary-total">
                  <small>Last active {new Date(group.lastActiveAt).toLocaleString()}</small>
                  <strong>{formatOptionalEstimate(group.estimatedCost)}</strong>
                </span>
              </summary>
              <HistorySessionTable sessions={group.sessions} />
            </details>
          ))
        ) : (
          <p className="empty-state">No usage history matches the current data.</p>
        )}
      </div>
    </section>
  );
}
function HistorySessionTable({ sessions }: { sessions: HistorySession[] }) {
  return (
    <div className="table-card">
      <table>
        <thead>
          <tr>
            <th>Last active</th>
            <th>Source Host</th>
            <th>Model</th>
            <th>Reasoning</th>
            <th>Modes</th>
            <th>Records</th>
            <th>Tokens</th>
            <th>API-equivalent estimate</th>
            <th>Plan</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr key={session.key}>
              <td>{new Date(session.lastActiveAt).toLocaleString()}</td>
              <td>{session.sourceHosts.join(", ")}</td>
              <td>{session.models.join(", ")}</td>
              <td>{session.reasoningLevels.map(title).join(", ")}</td>
              <td>
                <ModeBadges flags={session.modeFlags} empty />
              </td>
              <td>{number.format(session.records)}</td>
              <td>{number.format(session.totalTokens)}</td>
              <td>{formatOptionalEstimate(session.estimatedCost)}</td>
              <td>{session.plans.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Advanced({ data }: { data: OverviewView }) {
  const [dimension, setDimension] = useState<"byModel" | "byTask" | "bySourceHost" | "byHostGroup">(
    "byModel",
  );
  const rows = data[dimension];
  return (
    <section>
      <div className="advanced-control">
        <label>
          Group analysis by
          <select
            value={dimension}
            onChange={(event) => setDimension(event.target.value as typeof dimension)}
          >
            <option value="byModel">Model and reasoning level</option>
            <option value="byTask">Task</option>
            <option value="bySourceHost">Source Host</option>
            <option value="byHostGroup">Host Group</option>
          </select>
        </label>
      </div>
      {dimension === "byModel" ? (
        <ModelRollups rows={data.byModel} />
      ) : (
        <RankChart title="Advanced usage analysis" rows={rows} />
      )}
    </section>
  );
}
function ModelRollups({ rows }: { rows: RankedUsage[] }) {
  const providers = useMemo(() => groupModelsByProvider(rows), [rows]);
  return (
    <article className="card model-analysis">
      <header>
        <h2>Models and reasoning levels</h2>
        <p>Providers contain model totals; expand a model to inspect its reasoning levels.</p>
      </header>
      <div className="provider-rollups">
        {providers.length ? (
          providers.map((provider, providerIndex) => (
            <details className="provider-rollup" key={provider.key} open={providerIndex === 0}>
              <summary>
                <span className="provider-name">
                  <strong>{provider.label}</strong>
                  <small>
                    {provider.rows.length} model{provider.rows.length === 1 ? "" : "s"} ·{" "}
                    {formatRecordCount(provider.records)}
                  </small>
                </span>
                <span className="summary-total">
                  <small>{number.format(provider.totalTokens)} tokens</small>
                  <strong>{money.format(provider.estimatedCost)}</strong>
                </span>
              </summary>
              <div className="model-rollups">
                {provider.rows.map((row, modelIndex) => (
                  <details
                    className="model-rollup"
                    key={`${provider.key}/${row.model ?? row.key}`}
                    open={providerIndex === 0 && modelIndex === 0}
                  >
                    <summary>
                      <span className="model-name">
                        <strong>{row.model ?? row.key}</strong>
                        <ModeBadges flags={row.modeFlags} />
                      </span>
                      <span className="rollup-metrics">
                        <small>
                          {row.children?.length ?? 0} reasoning level
                          {row.children?.length === 1 ? "" : "s"} · {formatRecordCount(row.records)}{" "}
                          · {number.format(row.totalTokens)} tokens
                        </small>
                        <strong>{money.format(row.estimatedCost)}</strong>
                      </span>
                    </summary>
                    <div className="reasoning-rows">
                      {row.children?.map((child) => (
                        <div className="reasoning-row" key={child.key}>
                          <span>
                            <strong>{title(child.reasoningLevel ?? child.key)}</strong>
                            <ModeBadges flags={child.modeFlags} />
                          </span>
                          <small>{formatRecordCount(child.records)}</small>
                          <small>{number.format(child.totalTokens)} tokens</small>
                          <strong>{money.format(child.estimatedCost)}</strong>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))
        ) : (
          <p className="empty-state">No usage for the selected filters.</p>
        )}
      </div>
    </article>
  );
}
function ModeBadges({ flags, empty = false }: { flags: UsageModeFlags; empty?: boolean }) {
  if (!flags.ultra && !flags.fast) return empty ? <span className="mode-empty">—</span> : null;
  return (
    <span
      className="mode-badges"
      aria-label={`Modes: ${[flags.ultra && "Ultra", flags.fast && "Fast"].filter(Boolean).join(", ")}`}
    >
      {flags.ultra && <span className="mode-badge ultra">Ultra</span>}
      {flags.fast && <span className="mode-badge fast">Fast</span>}
    </span>
  );
}
function formatOptionalEstimate(value: number | null) {
  return value === null ? "Unpriced" : money.format(value);
}
function formatRecordCount(value: number) {
  return `${value} record${value === 1 ? "" : "s"}`;
}
function safeSourceHostLabel(host: SourceHost, index: number) {
  const name = host.hostname?.trim();
  return name && !/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(name) && !/^[0-9a-f]{12}$/i.test(name)
    ? name
    : `Source Host ${index + 1}`;
}
function Pricing({ prices, onSaved }: { prices: ModelPrice[]; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(prices);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(prices), [prices]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prices);
  const save = async () => {
    setSaving(true);
    try {
      await executeAction({ version: 1, type: "replace-prices", prices: draft });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="pricing-panel" aria-labelledby="pricing-table-title">
      <div className="pricing-toolbar">
        <div>
          <h2 id="pricing-table-title">Model rates</h2>
          <p>USD per one million tokens · {draft.length} configured models</p>
        </div>
        <button className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? "Save changes" : "Prices saved"}
        </button>
      </div>
      {draft.length ? (
        <div className="table-card pricing-table">
          <table>
            <caption className="sr-only">
              Configured model prices in USD per one million tokens
            </caption>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Input</th>
                <th>Cached</th>
                <th>Output</th>
                <th>Effective</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((price, index) => (
                <tr key={`${price.provider}/${price.model}`}>
                  <td className="provider-cell">{price.provider}</td>
                  <td className="pricing-model">{price.model}</td>
                  {(["input", "cachedInput", "output"] as const).map((key) => (
                    <td key={key}>
                      <input
                        aria-label={`${price.model} ${key}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.001"
                        value={price[key]}
                        onChange={(event) =>
                          setDraft((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, [key]: Number(event.target.value) }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>{price.effectiveDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">Loading the local price catalog…</p>
      )}
    </section>
  );
}
function title(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function shortDate(value: string) {
  return value.length > 10 ? value.slice(5, 13) : value.slice(5);
}

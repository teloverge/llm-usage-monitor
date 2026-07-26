import { useEffect, useMemo, useState } from "react";
import type {
  ModelPrice,
  OverviewView,
  RankedUsage,
  UsageHistoryRecord,
  UsageModeFlags,
} from "@llm-usage-monitor/contracts";
import { executeAction } from "./api.ts";
import { groupHistoryByTask, groupModelsByProvider, type HistorySession } from "./usage-groups.ts";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});
const number = new Intl.NumberFormat();

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
export function History({ records }: { records: UsageHistoryRecord[] }) {
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
export function Advanced({ data }: { data: OverviewView }) {
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
export function Pricing({
  prices,
  onSaved,
}: {
  prices: ModelPrice[];
  onSaved: () => Promise<void>;
}) {
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

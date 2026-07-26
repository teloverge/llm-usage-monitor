import { useEffect, useMemo, useState } from "react";
import type { ModelPrice, UsageHistoryRecord, UsageModeFlags } from "@llm-usage-monitor/contracts";
import { executeAction } from "./api.ts";
import { groupHistoryByTask, type HistorySession } from "./usage-groups.ts";

const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 4,
});
const number = new Intl.NumberFormat();

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

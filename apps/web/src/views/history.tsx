import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  UsageHistoryGroup,
  UsageHistorySession,
  UsageHistoryView,
} from "@llm-usage-monitor/contracts";
import { useHistoryColumns } from "../components/history-columns.tsx";
import { durationMinutes, type HistoryColumn } from "../model/history-table.ts";
import { Zone } from "../components/panel.tsx";
import { CostStrip } from "../components/stat-strip.tsx";
import {
  formatCount,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTokens,
} from "../model/format.ts";
import { harnessColor, harnessLabel } from "../model/harness.ts";

/**
 * Renders the server's grouped conversations. The grouping itself lives in
 * usage-analysis; this view only turns ids into words — the host label, the
 * "untitled task" and "not reported" wording — because those are translated and
 * the server does not know the reader's language.
 *
 * A conversation's row carries its whole-conversation figures: every session
 * and every agent it spawned, first and last activity, and the span between.
 * What the agents alone spent is a secondary reading and lives inside the
 * expansion, above the sessions, so the row itself stays one line.
 */
export function History({
  data,
  hostLabel,
}: {
  data: UsageHistoryView;
  hostLabel: (sourceHostId: string) => string;
}) {
  const { t } = useTranslation();
  const columns: HistoryColumn<UsageHistoryGroup>[] = [
    {
      id: "conversation",
      label: t("history.conversation"),
      kind: "text",
      value: (group) => group.taskName || t("common.untitledTask"),
    },
    {
      id: "sessions",
      label: t("history.sessions"),
      kind: "number",
      value: (group) => group.sessions.length,
    },
    {
      id: "started",
      label: t("history.started"),
      kind: "date",
      value: (group) => Date.parse(group.firstActiveAt),
    },
    {
      id: "lastActive",
      label: t("history.lastActive"),
      kind: "date",
      value: (group) => Date.parse(group.lastActiveAt),
    },
    { id: "duration", label: t("history.duration"), kind: "duration", value: durationMinutes },
    { id: "tokens", label: t("table.tokens"), kind: "number", value: (group) => group.totalTokens },
    { id: "cost", label: t("table.cost"), kind: "cost", value: (group) => group.estimatedCost },
  ];
  const table = useHistoryColumns(data.groups, columns);
  const groups = table.rows;
  // Same reason as the Breakdown rollup: `open` on a `<details>` makes React the
  // authority on the attribute, so without state behind it a collapsed group can
  // be reopened by the next render.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  if (!seeded && data.groups[0]) {
    setSeeded(true);
    setOpenKeys(new Set([data.groups[0].key]));
  }
  const setOpen = (key: string, open: boolean) =>
    setOpenKeys((current) => {
      if (current.has(key) === open) return current;
      const next = new Set(current);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const sessions = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  if (!data.groups.length) return <p className="empty-state">{t("history.empty")}</p>;
  return (
    <section className="history">
      <Zone>
        {t("history.summary", {
          tasks: formatCount(groups.length),
          sessions: formatCount(sessions),
          records: formatCount(groups.reduce((sum, group) => sum + group.records, 0)),
        })}
      </Zone>
      {table.controls}
      <div className="history-scroll">
        <div className="panel breakdown-body history-table">
          <div className="history-head">
            <span />
            {columns.map((column) => (
              <div key={column.id}>{table.heading(column)}</div>
            ))}
          </div>
          {!groups.length && <p className="empty-state">{t("history.columns.empty")}</p>}
          {groups.map((group) => (
            <details
              className="rollup"
              key={group.key}
              open={openKeys.has(group.key)}
              onToggle={(event) => setOpen(group.key, event.currentTarget.open)}
            >
              <summary>
                <span className="rank-name" title={group.taskName || t("common.untitledTask")}>
                  {group.taskName || t("common.untitledTask")}
                </span>
                <span className="history-meta">
                  {group.agents.sessions
                    ? t("history.sessionAndAgentCount", {
                        sessions: formatCount(group.sessions.length),
                        agents: formatCount(group.agents.sessions),
                      })
                    : t("history.sessionCount", { sessions: formatCount(group.sessions.length) })}
                </span>
                <span className="history-when">{formatDateTime(group.firstActiveAt)}</span>
                <span className="history-when">{formatDateTime(group.lastActiveAt)}</span>
                <span className="history-span">
                  {formatDuration(group.firstActiveAt, group.lastActiveAt)}
                </span>
                <span className="rollup-tokens">{formatTokens(group.totalTokens)}</span>
                <span className="rank-value">
                  {cost(group.estimatedCost, t("common.unpriced"))}
                </span>
              </summary>
              {group.costBreakdown && group.estimatedCost !== null && (
                <CostStrip
                  total={group.estimatedCost}
                  breakdown={group.costBreakdown}
                  className="strip cost history-costs"
                />
              )}
              <AgentsSummary group={group} />
              <SessionTable sessions={group.sessions} hostLabel={hostLabel} />
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function AgentsSummary({ group }: { group: UsageHistoryGroup }) {
  const { t } = useTranslation();
  if (!group.agents.sessions) return null;
  return (
    <p className="history-agents">
      {t("history.agentsSummary", {
        agents: formatCount(group.agents.sessions),
        tokens: formatTokens(group.agents.totalTokens),
        cost: cost(group.agents.estimatedCost, t("common.unpriced")),
      })}
    </p>
  );
}

function cost(value: number | null, unpriced: string): string {
  return value === null ? unpriced : formatMoney(value);
}

function SessionTable({
  sessions,
  hostLabel,
}: {
  sessions: UsageHistorySession[];
  hostLabel: (sourceHostId: string) => string;
}) {
  const { t } = useTranslation();
  const columns: HistoryColumn<UsageHistorySession>[] = [
    {
      id: "harness",
      label: t("history.harness"),
      kind: "text",
      value: (session) =>
        session.harnesses
          .map((harness) => harnessLabel(harness, t("common.unknownHarness")))
          .join(", "),
    },
    {
      id: "started",
      label: t("history.started"),
      kind: "date",
      value: (session) => Date.parse(session.firstActiveAt),
    },
    {
      id: "lastActive",
      label: t("history.lastActive"),
      kind: "date",
      value: (session) => Date.parse(session.lastActiveAt),
    },
    { id: "duration", label: t("history.duration"), kind: "duration", value: durationMinutes },
    {
      id: "model",
      label: t("history.model"),
      kind: "text",
      value: (session) => session.models.join(", "),
    },
    {
      id: "reasoning",
      label: t("history.reasoning"),
      kind: "text",
      value: (session) =>
        session.reasoningLevels.map((level) => level ?? t("common.notReported")).join(", "),
    },
    {
      id: "host",
      label: t("history.host"),
      kind: "text",
      value: (session) => session.sourceHostIds.map(hostLabel).join(", "),
    },
    {
      id: "records",
      label: t("table.records"),
      kind: "number",
      value: (session) => session.records,
    },
    {
      id: "tokens",
      label: t("table.tokens"),
      kind: "number",
      value: (session) => session.totalTokens,
    },
    { id: "cost", label: t("table.cost"), kind: "cost", value: (session) => session.estimatedCost },
  ];
  const table = useHistoryColumns(sessions, columns);
  return (
    <>
      {table.controls}
      <div className="history-session-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={table.sort?.id === column.id ? table.sort.direction : "none"}
                >
                  {table.heading(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!table.rows.length && (
              <tr>
                <td colSpan={columns.length} className="empty-state">
                  {t("history.columns.empty")}
                </td>
              </tr>
            )}
            {table.rows.map((session) => (
              <tr key={session.key}>
                <td
                  style={
                    !table.sort && !table.filtered && session.depth
                      ? { paddingLeft: `${session.depth * 1.25 + 0.75}rem` }
                      : undefined
                  }
                >
                  {session.parentSessionId !== null && (
                    <span className="history-agent">
                      ↳ {t("history.agent")}
                      {session.agentNickname ? ` · ${session.agentNickname}` : ""}
                    </span>
                  )}
                  {session.harnesses.map((harness) => (
                    <span className="harness" key={harness}>
                      {/*
                    The dot is decorative: `harnessLabel` beside it is what names
                    the harness, and it renders the "unknown" sentinel as a state
                    rather than as a raw token.
                  */}
                      <i
                        className="dot"
                        aria-hidden="true"
                        style={{ background: harnessColor(harness) }}
                      />
                      {harnessLabel(harness, t("common.unknownHarness"))}
                    </span>
                  ))}
                </td>
                <td>{formatDateTime(session.firstActiveAt)}</td>
                <td>{formatDateTime(session.lastActiveAt)}</td>
                <td>{formatDuration(session.firstActiveAt, session.lastActiveAt)}</td>
                <td>{session.models.join(", ")}</td>
                {/*
              `common.notReported` is the SAME string the stat strip and quota
              meters use for a metric a source did not supply — not a second key
              for the same concept, and never "unknown", which would read as a
              reasoning level literally named that.
            */}
                <td>
                  {session.reasoningLevels
                    .map((level) => level ?? t("common.notReported"))
                    .join(", ")}
                </td>
                <td>{session.sourceHostIds.map(hostLabel).join(", ")}</td>
                <td className="n">{formatCount(session.records)}</td>
                <td className="n">{formatTokens(session.totalTokens)}</td>
                <td className="n">{cost(session.estimatedCost, t("common.unpriced"))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

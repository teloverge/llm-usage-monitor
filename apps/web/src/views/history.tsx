import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  UsageHistoryGroup,
  UsageHistorySession,
  UsageHistoryView,
} from "@llm-usage-monitor/contracts";
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
  const groups = data.groups;
  // Same reason as the Breakdown rollup: `open` on a `<details>` makes React the
  // authority on the attribute, so without state behind it a collapsed group can
  // be reopened by the next render.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  if (!seeded && groups[0]) {
    setSeeded(true);
    setOpenKeys(new Set([groups[0].key]));
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
  if (!groups.length) return <p className="empty-state">{t("history.empty")}</p>;
  return (
    <section className="history">
      <Zone>
        {t("history.summary", {
          tasks: formatCount(groups.length),
          sessions: formatCount(sessions),
          records: formatCount(data.records),
        })}
      </Zone>
      <div className="panel breakdown-body">
        <div className="history-head" aria-hidden="true">
          <span />
          <span className="rank-name">{t("history.conversation")}</span>
          <span className="history-meta">{t("history.sessions")}</span>
          <span className="history-when">{t("history.started")}</span>
          <span className="history-when">{t("history.lastActive")}</span>
          <span className="history-span">{t("history.duration")}</span>
          <span className="rollup-tokens">{t("table.tokens")}</span>
          <span className="rank-value">{t("table.cost")}</span>
        </div>
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
              <span className="rank-value">{cost(group.estimatedCost, t("common.unpriced"))}</span>
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
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{t("history.harness")}</th>
          <th>{t("history.started")}</th>
          <th>{t("history.lastActive")}</th>
          <th>{t("history.duration")}</th>
          <th>{t("history.model")}</th>
          <th>{t("history.reasoning")}</th>
          <th>{t("history.host")}</th>
          <th className="n">{t("table.records")}</th>
          <th className="n">{t("table.tokens")}</th>
          <th className="n">{t("table.cost")}</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.key}>
            <td
              style={
                session.depth ? { paddingLeft: `${session.depth * 1.25 + 0.75}rem` } : undefined
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
              {session.reasoningLevels.map((level) => level ?? t("common.notReported")).join(", ")}
            </td>
            <td>{session.sourceHostIds.map(hostLabel).join(", ")}</td>
            <td className="n">{formatCount(session.records)}</td>
            <td className="n">{formatTokens(session.totalTokens)}</td>
            <td className="n">{cost(session.estimatedCost, t("common.unpriced"))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageHistoryRecord } from "@llm-usage-monitor/contracts";
import { Zone } from "../components/panel.tsx";
import { formatCount, formatDateTime, formatMoney, formatTokens } from "../model/format.ts";
import { harnessColor, harnessLabel } from "../model/harness.ts";
import { groupHistoryByTask, type HistorySession } from "../model/usage-groups.ts";

export function History({ records }: { records: UsageHistoryRecord[] }) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupHistoryByTask(records), [records]);
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
          records: formatCount(records.length),
        })}
      </Zone>
      <div className="panel breakdown-body">
        {groups.map((group) => (
          <details
            className="rollup"
            key={group.key}
            open={openKeys.has(group.key)}
            onToggle={(event) => setOpen(group.key, event.currentTarget.open)}
          >
            <summary>
              <span className="rank-name" title={group.label}>
                {group.label}
              </span>
              <span className="rollup-tokens">
                {t("history.groupSessions", {
                  sessions: formatCount(group.sessions.length),
                  tokens: formatTokens(group.totalTokens),
                })}
              </span>
              <span className="rollup-tokens">{formatDateTime(group.lastActiveAt)}</span>
              <span className="rank-value">
                {group.estimatedCost === null
                  ? t("common.unpriced")
                  : formatMoney(group.estimatedCost)}
              </span>
            </summary>
            <SessionTable sessions={group.sessions} />
          </details>
        ))}
      </div>
    </section>
  );
}

function SessionTable({ sessions }: { sessions: HistorySession[] }) {
  const { t } = useTranslation();
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>{t("history.lastActive")}</th>
          <th>{t("history.harness")}</th>
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
            <td>{formatDateTime(session.lastActiveAt)}</td>
            <td>
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
            <td>{session.models.join(", ")}</td>
            <td>{session.reasoningLevels.join(", ")}</td>
            <td>{session.sourceHosts.join(", ")}</td>
            <td className="n">{formatCount(session.records)}</td>
            <td className="n">{formatTokens(session.totalTokens)}</td>
            <td className="n">
              {session.estimatedCost === null
                ? t("common.unpriced")
                : formatMoney(session.estimatedCost)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

import { useTranslation } from "react-i18next";
import type { SourceHost, UsageSourceInspection } from "@llm-usage-monitor/contracts";
import { formatCount, formatDateTime } from "../../model/format.ts";
import { harnessLabel } from "../../model/harness.ts";
import { sourceHostLabel } from "../../model/source-host.ts";

export function SourceInspections({
  inspections,
  sourceHosts,
}: {
  inspections: UsageSourceInspection[];
  sourceHosts: SourceHost[];
}) {
  const { t } = useTranslation();
  const hostLabel = (sourceHostId: string) => {
    const index = sourceHosts.findIndex((host) => host.id === sourceHostId);
    const host = sourceHosts[index];
    return host
      ? sourceHostLabel(host, t("common.sourceHostFallback", { index: index + 1 }))
      : sourceHostId;
  };
  return (
    <section className="settings-section" aria-labelledby="source-inspections-title">
      <div className="settings-section-head">
        <h2 id="source-inspections-title">{t("settings.sources.heading")}</h2>
        <p>{t("settings.sources.hint")}</p>
      </div>
      {inspections.length ? (
        <div className="table-card source-inspection-table">
          <table>
            <caption className="sr-only">{t("settings.sources.caption")}</caption>
            <thead>
              <tr>
                <th>{t("settings.sources.host")}</th>
                <th>{t("settings.sources.source")}</th>
                <th>{t("settings.sources.status")}</th>
                <th>{t("settings.sources.records")}</th>
                <th>{t("settings.sources.inspected")}</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((inspection) => (
                <tr key={`${inspection.sourceHostId}:${inspection.usageSourceId}`}>
                  <td>{hostLabel(inspection.sourceHostId)}</td>
                  <td>{harnessLabel(inspection.harnessId, t("common.unknownHarness"))}</td>
                  <td>
                    <span className={`source-status ${inspection.status}`}>
                      {t(`settings.sources.state.${inspection.status}`)}
                    </span>
                    {inspection.detail && <small>{inspection.detail}</small>}
                  </td>
                  <td className="n">{formatCount(inspection.records)}</td>
                  <td>{formatDateTime(inspection.inspectedAt) ?? inspection.inspectedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">{t("settings.sources.empty")}</p>
      )}
    </section>
  );
}

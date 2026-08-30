import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  SourceHost,
  UsageSourceInspection,
} from "@llm-usage-monitor/contracts";
import { HostGroups } from "./host-groups.tsx";
import { LanguageSettings } from "./language.tsx";
import { Pricing } from "./rates.tsx";
import { SourceInspections } from "./source-inspections.tsx";

type SettingsTab = "sources" | "rates" | "host-groups" | "language";

/** Ids only; labels follow the language. */
const TABS: readonly SettingsTab[] = ["sources", "rates", "host-groups", "language"];

/**
 * Owns which settings section is showing so `app.tsx` does not gain a tenth
 * piece of state for a concern that is entirely local to this screen.
 */
export function Settings({
  prices,
  hostGroups,
  memberships,
  sourceHosts,
  inspections,
  onSaved,
}: {
  prices: ModelPrice[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  inspections: UsageSourceInspection[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("sources");
  return (
    <section className="settings">
      {/* Same chip/aria-pressed idiom as Breakdown's Group-by row. */}
      <div className="group-by" role="group" aria-label={t("settings.sections")}>
        {TABS.map((item) => (
          <button
            type="button"
            key={item}
            className={`chip ${tab === item ? "on" : ""}`}
            aria-pressed={tab === item}
            onClick={() => setTab(item)}
          >
            {t(`settings.tabs.${item}`)}
          </button>
        ))}
      </div>
      {tab === "sources" && (
        <SourceInspections inspections={inspections} sourceHosts={sourceHosts} />
      )}
      {tab === "rates" && <Pricing prices={prices} onSaved={onSaved} />}
      {tab === "host-groups" && (
        <HostGroups
          hostGroups={hostGroups}
          memberships={memberships}
          sourceHosts={sourceHosts}
          onSaved={onSaved}
        />
      )}
      {tab === "language" && <LanguageSettings />}
    </section>
  );
}

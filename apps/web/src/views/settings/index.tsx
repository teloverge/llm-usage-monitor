import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  SourceHost,
} from "@llm-usage-monitor/contracts";
import { HostGroups } from "./host-groups.tsx";
import { Pricing } from "./rates.tsx";

type SettingsTab = "rates" | "host-groups" | "language";

/** Ids only; labels follow the language. */
const TABS: readonly SettingsTab[] = ["rates", "host-groups", "language"];

/**
 * Owns which settings section is showing so `app.tsx` does not gain a tenth
 * piece of state for a concern that is entirely local to this screen.
 */
export function Settings({
  prices,
  hostGroups,
  memberships,
  sourceHosts,
  onSaved,
}: {
  prices: ModelPrice[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>("rates");
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
      {tab === "rates" && <Pricing prices={prices} onSaved={onSaved} />}
      {tab === "host-groups" && (
        <HostGroups
          hostGroups={hostGroups}
          memberships={memberships}
          sourceHosts={sourceHosts}
          onSaved={onSaved}
        />
      )}
      {/* Filled in by the language-selector task. */}
      {tab === "language" && null}
    </section>
  );
}

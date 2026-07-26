import { useState } from "react";
import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  SourceHost,
} from "@llm-usage-monitor/contracts";
import { HostGroups } from "./host-groups.tsx";
import { Pricing } from "./rates.tsx";

type SettingsTab = "rates" | "host-groups";

const TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "rates", label: "Model rates" },
  { value: "host-groups", label: "Host groups" },
];

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
  const [tab, setTab] = useState<SettingsTab>("rates");
  return (
    <section className="settings">
      {/* Same chip/aria-pressed idiom as Breakdown's Group-by row. */}
      <div className="group-by" role="group" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.value}
            className={`chip ${tab === item.value ? "on" : ""}`}
            aria-pressed={tab === item.value}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "rates" ? (
        <Pricing prices={prices} onSaved={onSaved} />
      ) : (
        <HostGroups
          hostGroups={hostGroups}
          memberships={memberships}
          sourceHosts={sourceHosts}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}

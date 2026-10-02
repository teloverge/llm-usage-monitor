import type {
  CredentialObservation,
  DashboardAction,
  DashboardActionOutcome,
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  SourceHost,
  UsageFilters,
  UsageHistoryView,
  UsageSourceInspection,
} from "@llm-usage-monitor/contracts";

function filterQuery(filters: UsageFilters): URLSearchParams {
  return new URLSearchParams(
    Object.entries(filters).flatMap(([key, value]) =>
      value === undefined || value === "" ? [] : [[key, String(value)]],
    ),
  );
}
export async function getOverview(filters: UsageFilters): Promise<OverviewView> {
  return requestJson<OverviewView>(`./api/overview?${filterQuery(filters)}`);
}
/** Takes the same filters as the Overview, so both views answer for one selection. */
export async function getHistory(filters: UsageFilters): Promise<UsageHistoryView> {
  return requestJson<UsageHistoryView>(`./api/history?${filterQuery(filters)}`);
}
export async function getCatalog(): Promise<{
  prices: ModelPrice[];
  sourceHosts: SourceHost[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  credentials: CredentialObservation[];
  inspections: UsageSourceInspection[];
}> {
  return requestJson("./api/catalog");
}
export async function executeAction(action: DashboardAction): Promise<DashboardActionOutcome> {
  return requestJson("./api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
}
async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  if (!response.ok) throw new Error(`Usage Monitor request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

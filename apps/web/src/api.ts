import type {
  DashboardAction,
  DashboardActionOutcome,
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  OverviewView,
  SourceHost,
  UsageFilters,
  UsageHistoryRecord,
} from "@llm-usage-monitor/contracts";

export async function getOverview(filters: UsageFilters): Promise<OverviewView> {
  const query = new URLSearchParams(
    Object.entries(filters).flatMap(([key, value]) =>
      value === undefined || value === "" ? [] : [[key, String(value)]],
    ),
  );
  return requestJson<OverviewView>(`./api/overview?${query}`);
}
export async function getHistory(): Promise<UsageHistoryRecord[]> {
  return (await requestJson<{ records: UsageHistoryRecord[] }>("./api/history?limit=500")).records;
}
export async function getCatalog(): Promise<{
  prices: ModelPrice[];
  sourceHosts: SourceHost[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
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

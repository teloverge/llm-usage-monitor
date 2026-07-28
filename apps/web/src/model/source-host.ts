import type { SourceHost } from "@llm-usage-monitor/contracts";

const MAC_ADDRESS = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const BARE_HEX_ID = /^[0-9a-f]{12}$/i;

/**
 * Hostname is the preferred label, but some machines report a MAC address or a
 * bare hex identifier as their hostname. Those are meaningless to a reader and
 * mildly identifying, so they fall back to a positional label.
 *
 * The wording is injected rather than held here because it is translated and
 * `model/` never imports `t` — the same idiom `harnessLabel` uses for its
 * `unknownLabel` parameter. The caller renders `common.sourceHostFallback`
 * with the 1-based index already interpolated in.
 */
export function sourceHostLabel(host: SourceHost, fallback: string): string {
  const name = host.hostname?.trim();
  return name && !MAC_ADDRESS.test(name) && !BARE_HEX_ID.test(name) ? name : fallback;
}

/**
 * Builds an id-to-label resolver for the rows the analysis layer keys by raw
 * `sourceHostId` — the Overview's Hosts panel, the Breakdown's Host grouping,
 * and the History table's Host column.
 *
 * The positional fallback is 1-based on the CATALOG's order, so a host reads as
 * the same "Source Host 3" everywhere it appears rather than being renumbered
 * per panel by whatever subset that panel happens to rank.
 *
 * An id absent from the catalog passes through unchanged rather than becoming
 * a shared "unknown" label: two unregistered hosts must stay distinguishable,
 * the same reason `usageSourceLabel` returns the raw source id.
 */
export function sourceHostLabels(
  sourceHosts: SourceHost[],
  fallbackFor: (index: number) => string,
): (sourceHostId: string) => string {
  const byId = new Map(
    sourceHosts.map((host, index) => [host.id, sourceHostLabel(host, fallbackFor(index + 1))]),
  );
  return (sourceHostId) => byId.get(sourceHostId) ?? sourceHostId;
}

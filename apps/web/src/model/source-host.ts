import type { SourceHost } from "@llm-usage-monitor/contracts";

const MAC_ADDRESS = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i;
const BARE_HEX_ID = /^[0-9a-f]{12}$/i;

/**
 * Hostname is the preferred label, but some machines report a MAC address or a
 * bare hex identifier as their hostname. Those are meaningless to a reader and
 * mildly identifying, so they fall back to a positional label.
 */
export function sourceHostLabel(host: SourceHost, index: number): string {
  const name = host.hostname?.trim();
  return name && !MAC_ADDRESS.test(name) && !BARE_HEX_ID.test(name)
    ? name
    : `Source Host ${index + 1}`;
}

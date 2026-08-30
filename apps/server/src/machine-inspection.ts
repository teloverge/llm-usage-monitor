import { promises as fs } from "node:fs";
import { arch, homedir, hostname, networkInterfaces, platform } from "node:os";
import { join } from "node:path";
import type {
  SourceHost,
  SourceHostObservation,
  UsageQuotaSnapshot,
  UsageRecord,
  UsageSourceInspection,
} from "@llm-usage-monitor/contracts";
import { ClaudeSessionProvider } from "./claude-importer.ts";
import { CodexSessionProvider } from "./codex-importer.ts";
import { GrokSessionProvider } from "./grok-importer.ts";
import { OpenCodeSessionProvider, defaultDataDirectories } from "./opencode-importer.ts";
import type { ImportProvider } from "./run-import.ts";

export const MONITORED_SOURCES = [
  { usageSourceId: "codex-local", harnessId: "codex" },
  { usageSourceId: "claude-code-local", harnessId: "claude-code" },
  { usageSourceId: "grok-build-local", harnessId: "grok-build" },
  { usageSourceId: "opencode-local", harnessId: "opencode" },
] as const;

export interface ProviderInspectionResult {
  inspection: UsageSourceInspection;
  records: UsageRecord[];
  quotaSnapshots: UsageQuotaSnapshot[];
  state: unknown;
  home?: string;
}

export interface MachineInspection {
  host: SourceHost;
  observations: SourceHostObservation[];
  sources: ProviderInspectionResult[];
}

type ProviderDescriptor = (typeof MONITORED_SOURCES)[number] & {
  provider: ImportProvider;
  homes(): string[];
};

export async function inspectMachine(options: {
  sourceHostId: string;
  managedHostId: string;
  previousState?: (usageSourceId: string) => unknown;
  now?: Date;
}): Promise<MachineInspection> {
  const now = options.now ?? new Date();
  const inspectedAt = now.toISOString();
  const host = machineHost(options.sourceHostId, now);
  const sources = await Promise.all(
    providers().map(async (descriptor): Promise<ProviderInspectionResult> => {
      const base = {
        sourceHostId: options.sourceHostId,
        managedHostId: options.managedHostId,
        usageSourceId: descriptor.usageSourceId,
        harnessId: descriptor.harnessId,
        inspectedAt,
      };
      const home = await firstExisting(descriptor.homes());
      if (!home)
        return {
          inspection: {
            ...base,
            status: "unavailable",
            records: 0,
            detail: "Source data was not found on this host.",
          },
          records: [],
          quotaSnapshots: [],
          state: {},
        };
      try {
        const result = await descriptor.provider.collect(
          options.sourceHostId,
          home,
          options.previousState?.(descriptor.usageSourceId) ?? {},
        );
        const records = [...new Map(result.records.map((record) => [record.id, record])).values()];
        return {
          inspection: {
            ...base,
            status: "available",
            records: records.length,
          },
          records,
          quotaSnapshots: result.quotaSnapshots,
          state: result.state,
          home,
        };
      } catch {
        return {
          inspection: {
            ...base,
            status: "failed",
            records: 0,
            detail: "The source exists, but its usage metadata could not be read.",
          },
          records: [],
          quotaSnapshots: [],
          state: {},
          home,
        };
      }
    }),
  );
  return { host, observations: machineObservations(host, inspectedAt), sources };
}

function providers(): ProviderDescriptor[] {
  return [
    {
      ...MONITORED_SOURCES[0],
      provider: new CodexSessionProvider(),
      homes: () => [process.env.CODEX_HOME || join(homedir(), ".codex")],
    },
    {
      ...MONITORED_SOURCES[1],
      provider: new ClaudeSessionProvider(),
      homes: () => [process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude")],
    },
    {
      ...MONITORED_SOURCES[2],
      provider: new GrokSessionProvider(),
      homes: () => [process.env.GROK_HOME || join(homedir(), ".grok")],
    },
    {
      ...MONITORED_SOURCES[3],
      provider: new OpenCodeSessionProvider(),
      homes: () =>
        process.env.OPENCODE_DB
          ? [process.env.OPENCODE_DB]
          : process.env.OPENCODE_DATA_DIR
            ? [process.env.OPENCODE_DATA_DIR]
            : defaultDataDirectories(),
    },
  ];
}

function machineHost(sourceHostId: string, now: Date): SourceHost {
  const seenAt = now.toISOString();
  return {
    id: sourceHostId,
    hostname: hostname().trim() || null,
    platform: platform(),
    architecture: arch(),
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };
}

function machineObservations(host: SourceHost, seenAt: string): SourceHostObservation[] {
  const observations: SourceHostObservation[] = [];
  if (host.hostname)
    observations.push({
      sourceHostId: host.id,
      kind: "hostname",
      value: host.hostname,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    });
  const addresses = new Set<string>();
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) if (!entry.internal) addresses.add(entry.address);
  for (const value of addresses)
    observations.push({
      sourceHostId: host.id,
      kind: "ip-address",
      value,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    });
  return observations;
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await fs.access(path);
      return path;
    } catch {}
  }
  return undefined;
}

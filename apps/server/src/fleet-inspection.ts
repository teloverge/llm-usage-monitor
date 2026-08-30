import { createHash } from "node:crypto";
import { arch, hostname } from "node:os";
import type {
  CredentialSighting,
  SourceHost,
  SourceHostObservation,
  UsageQuotaSnapshot,
  UsageRecord,
  UsageSourceInspection,
} from "@llm-usage-monitor/contracts";
import {
  inspectRemoteHost,
  isLocalComputeHost,
  readComputeRegistry,
  RemoteInspectionError,
  type ManagedComputeHost,
} from "./compute-registry.ts";
import { inspectMachine, MONITORED_SOURCES, type MachineInspection } from "./machine-inspection.ts";

export interface FleetInspectionLedger {
  importState(providerId: string): unknown;
  commitProviderImport(providerId: string, records: UsageRecord[], state: unknown): number;
  replaceQuotaSnapshots(snapshots: UsageQuotaSnapshot[]): void;
  replaceUsageSourceInspections(inspections: UsageSourceInspection[]): void;
  upsertSourceHost(host: SourceHost, observations: SourceHostObservation[]): void;
  recordCredentialObservation(sighting: CredentialSighting): void;
}

export async function refreshManagedSources(options: {
  computeFile: string;
  agentPath: string;
  localSourceHostId: string;
  ledger: FleetInspectionLedger;
}): Promise<{ affectedRecords: number; inspections: UsageSourceInspection[] }> {
  const managedHosts = await readComputeRegistry(options.computeFile);
  const localName = hostname();
  const hosts = managedHosts.length ? managedHosts : [fallbackLocalHost(localName)];
  const results = await Promise.all(
    hosts.map(async (host): Promise<MachineInspection | UsageSourceInspection[]> => {
      if (isLocalComputeHost(host, localName))
        return inspectMachine({
          sourceHostId: options.localSourceHostId,
          managedHostId: host.id,
          previousState: (usageSourceId) =>
            options.ledger.importState(importKey(options.localSourceHostId, usageSourceId)),
        });
      const sourceHostId = `managed:${host.id}`;
      try {
        return await inspectRemoteHost({
          host,
          sourceHostId,
          agentPath: options.agentPath,
        });
      } catch (error) {
        options.ledger.upsertSourceHost(declaredHost(host, sourceHostId), []);
        const inspectedAt = new Date().toISOString();
        const detail = error instanceof Error ? error.message : "Remote inspection failed.";
        const status = error instanceof RemoteInspectionError ? error.kind : "failed";
        return MONITORED_SOURCES.map((source) => ({
          sourceHostId,
          managedHostId: host.id,
          usageSourceId: source.usageSourceId,
          harnessId: source.harnessId,
          status,
          records: 0,
          inspectedAt,
          detail,
        }));
      }
    }),
  );
  const inspections: UsageSourceInspection[] = [];
  let affectedRecords = 0;
  for (const result of results) {
    if (Array.isArray(result)) {
      inspections.push(...result);
      continue;
    }
    options.ledger.upsertSourceHost(result.host, result.observations);
    for (const source of result.sources) {
      inspections.push(source.inspection);
      if (source.inspection.status !== "available") continue;
      const local = source.inspection.sourceHostId === options.localSourceHostId;
      const records = local
        ? source.records
        : source.records.map((record) => ({
            ...record,
            id: remoteRecordId(source.inspection.managedHostId, record),
          }));
      affectedRecords += options.ledger.commitProviderImport(
        importKey(source.inspection.sourceHostId, source.inspection.usageSourceId),
        records,
        source.state,
      );
      try {
        options.ledger.replaceQuotaSnapshots(source.quotaSnapshots);
      } catch (error) {
        console.warn(`quota snapshot refused for ${source.inspection.usageSourceId}:`, error);
      }
      if (source.credential) {
        try {
          options.ledger.recordCredentialObservation(source.credential);
        } catch (error) {
          console.warn(
            `credential observation failed for ${source.inspection.usageSourceId}:`,
            error,
          );
        }
      }
    }
  }
  options.ledger.replaceUsageSourceInspections(inspections);
  return { affectedRecords, inspections };
}

function importKey(sourceHostId: string, usageSourceId: string): string {
  return `${sourceHostId}:${usageSourceId}`;
}

function remoteRecordId(managedHostId: string, record: UsageRecord): string {
  const digest = createHash("sha256").update(record.id).digest("hex").slice(0, 32);
  return `managed:${managedHostId}:${record.usageSourceId}:${digest}`;
}

function fallbackLocalHost(localHostname: string): ManagedComputeHost {
  return {
    id: localHostname,
    hostname: localHostname,
    tailnetDnsName: "",
    operatingSystem: process.platform,
    architecture: arch(),
    sshCommand: `ssh ${localHostname}`,
    nodeCommand: "node",
  };
}

function declaredHost(host: ManagedComputeHost, sourceHostId: string): SourceHost {
  const now = new Date().toISOString();
  return {
    id: sourceHostId,
    hostname: host.hostname,
    platform: /^windows/i.test(host.operatingSystem) ? "win32" : "linux",
    architecture: host.architecture,
    firstSeenAt: now,
    lastSeenAt: now,
  };
}

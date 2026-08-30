import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { basename } from "node:path";
import {
  credentialSightingSchema,
  usageQuotaSnapshotSchema,
  usageRecordSchema,
  usageSourceInspectionSchema,
  type SourceHost,
  type SourceHostObservation,
} from "@llm-usage-monitor/contracts";
import { MONITORED_SOURCES, type MachineInspection } from "./machine-inspection.ts";

export interface ManagedComputeHost {
  id: string;
  hostname: string;
  tailnetDnsName: string;
  operatingSystem: string;
  architecture: string;
  sshCommand: string;
  nodeCommand: string;
}

export class RemoteInspectionError extends Error {
  readonly kind: "unreachable" | "failed";

  constructor(kind: "unreachable" | "failed", message: string) {
    super(message);
    this.kind = kind;
  }
}

export async function readComputeRegistry(file: string): Promise<ManagedComputeHost[]> {
  let markdown: string;
  try {
    markdown = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return parseComputeRegistry(markdown);
}

export function parseComputeRegistry(markdown: string): ManagedComputeHost[] {
  const headings = [...markdown.matchAll(/^## `([^`]+)`\s*$/gm)];
  return headings.flatMap((heading, index) => {
    const id = heading[1]?.trim();
    if (!id) return [];
    const start = (heading.index ?? 0) + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const fields = tableFields(markdown.slice(start, end));
    const sshCommand = fields.get("SSH command") ?? "";
    if (!sshCommand) return [];
    return [
      {
        id,
        hostname: fields.get("Hostname") ?? id,
        tailnetDnsName: fields.get("Tailnet DNS name") ?? "",
        operatingSystem: fields.get("Operating system") ?? "unknown",
        architecture: fields.get("Architecture") ?? "unknown",
        sshCommand,
        nodeCommand: fields.get("Node command") ?? "node",
      },
    ];
  });
}

export function isLocalComputeHost(host: ManagedComputeHost, localHostname: string): boolean {
  const local = localHostname.trim().toLocaleLowerCase();
  return [host.id, host.hostname, host.tailnetDnsName.split(".")[0]]
    .filter((candidate): candidate is string => Boolean(candidate))
    .some((candidate) => candidate.toLocaleLowerCase() === local);
}

export function localTailnetDnsName(hosts: ManagedComputeHost[], localHostname: string): string {
  const local = hosts.find((host) => isLocalComputeHost(host, localHostname));
  if (!local) throw new Error(`COMPUTE.md does not identify the local host ${localHostname}.`);
  if (!local.tailnetDnsName) throw new Error(`COMPUTE.md has no Tailnet DNS name for ${local.id}.`);
  return local.tailnetDnsName;
}

export function remoteInspectionTimeoutMs(host: ManagedComputeHost): number {
  return /^windows\b/i.test(host.operatingSystem) ? 180_000 : 30_000;
}

export async function inspectRemoteHost(options: {
  host: ManagedComputeHost;
  sourceHostId: string;
  agentPath: string;
  timeoutMs?: number;
}): Promise<MachineInspection> {
  const command = shellWords(options.host.sshCommand);
  if (!command.length || basename(command[0]!).toLocaleLowerCase() !== "ssh")
    throw new RemoteInspectionError("failed", "The managed host has an invalid SSH command.");
  if (!/^[A-Za-z0-9_.:\\/+-]+$/.test(options.host.nodeCommand))
    throw new RemoteInspectionError("failed", "The managed host has an invalid Node command.");
  const agent = await fs.readFile(options.agentPath);
  const args = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    ...command.slice(1),
    options.host.nodeCommand,
    "--input-type=module",
    "-",
    "inspect",
    "--managed-host-id",
    options.host.id,
    "--source-host-id",
    options.sourceHostId,
  ];
  return new Promise<MachineInspection>((resolve, reject) => {
    const child = spawn(command[0]!, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    const fail = (error: Error) => {
      child.kill();
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new RemoteInspectionError("unreachable", "The SSH inspection timed out.")),
      options.timeoutMs ?? remoteInspectionTimeoutMs(options.host),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 100 * 1024 * 1024)
        return fail(
          new RemoteInspectionError("failed", "The remote inspection result exceeded 100 MB."),
        );
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((total, item) => total + item.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new RemoteInspectionError("unreachable", error.message));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const reason = Buffer.concat(stderr).toString("utf8").toLocaleLowerCase();
        const authentication = /permission denied|authentication failed/.test(reason);
        const unreachable =
          authentication ||
          /connection refused|could not resolve|no route to host|timed out/.test(reason);
        const message = authentication
          ? "SSH authentication failed."
          : unreachable
            ? "The SSH host could not be reached."
            : "The remote inspector could not run.";
        reject(new RemoteInspectionError(unreachable ? "unreachable" : "failed", message));
        return;
      }
      try {
        resolve(
          validateMachineInspection(
            JSON.parse(Buffer.concat(stdout).toString("utf8")),
            options.host.id,
            options.sourceHostId,
          ),
        );
      } catch {
        reject(
          new RemoteInspectionError(
            "failed",
            "The remote host returned an invalid inspection result.",
          ),
        );
      }
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(agent);
  });
}

export function validateMachineInspection(
  input: unknown,
  managedHostId: string,
  sourceHostId: string,
): MachineInspection {
  if (!input || typeof input !== "object") throw new Error("invalid inspection");
  const value = input as Record<string, unknown>;
  if (!value.host || typeof value.host !== "object") throw new Error("invalid host");
  const hostValue = value.host as Record<string, unknown>;
  const host: SourceHost = {
    id: boundedText(hostValue.id, 200),
    hostname: hostValue.hostname === null ? null : boundedText(hostValue.hostname, 500),
    platform: boundedText(hostValue.platform, 100),
    architecture: boundedText(hostValue.architecture, 100),
    firstSeenAt: isoText(hostValue.firstSeenAt),
    lastSeenAt: isoText(hostValue.lastSeenAt),
  };
  if (host.id !== sourceHostId) throw new Error("host identity mismatch");
  if (!Array.isArray(value.observations) || value.observations.length > 100)
    throw new Error("invalid observations");
  const observations = value.observations.map((item): SourceHostObservation => {
    if (!item || typeof item !== "object") throw new Error("invalid observation");
    const observation = item as Record<string, unknown>;
    const kind = boundedText(observation.kind, 20);
    if (kind !== "hostname" && kind !== "ip-address") throw new Error("invalid observation kind");
    const result: SourceHostObservation = {
      sourceHostId: boundedText(observation.sourceHostId, 200),
      kind,
      value: boundedText(observation.value, 500),
      firstSeenAt: isoText(observation.firstSeenAt),
      lastSeenAt: isoText(observation.lastSeenAt),
    };
    if (result.sourceHostId !== sourceHostId) throw new Error("observation identity mismatch");
    return result;
  });
  if (!Array.isArray(value.sources) || value.sources.length !== 4)
    throw new Error("invalid source results");
  const sources = value.sources.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid source result");
    const source = item as Record<string, unknown>;
    const inspection = usageSourceInspectionSchema.parse(source.inspection);
    if (inspection.sourceHostId !== sourceHostId || inspection.managedHostId !== managedHostId)
      throw new Error("source identity mismatch");
    if (!Array.isArray(source.records) || !Array.isArray(source.quotaSnapshots))
      throw new Error("invalid source payload");
    const records = source.records.map((record) => usageRecordSchema.parse(record));
    const quotaSnapshots = source.quotaSnapshots.map((snapshot) =>
      usageQuotaSnapshotSchema.parse(snapshot),
    );
    if (
      records.some((record) => record.sourceHostId !== sourceHostId) ||
      quotaSnapshots.some((snapshot) => snapshot.sourceHostId !== sourceHostId)
    )
      throw new Error("record identity mismatch");
    if (inspection.records !== records.length) throw new Error("record count mismatch");
    // Optional, so an agent bundled before sightings were part of the result
    // still validates; its sources simply remain unattributed.
    const credential =
      source.credential == null ? null : credentialSightingSchema.parse(source.credential);
    if (
      credential &&
      (credential.sourceHostId !== sourceHostId ||
        credential.usageSourceId !== inspection.usageSourceId)
    )
      throw new Error("credential identity mismatch");
    return { inspection, records, quotaSnapshots, state: {}, credential };
  });
  const sourceIds = new Set(sources.map((source) => source.inspection.usageSourceId));
  if (
    sourceIds.size !== MONITORED_SOURCES.length ||
    MONITORED_SOURCES.some((source) => !sourceIds.has(source.usageSourceId))
  )
    throw new Error("invalid source result set");
  return { host, observations, sources };
}

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > maximum)
    throw new Error("invalid text");
  return value;
}

function isoText(value: unknown): string {
  const text = boundedText(value, 40);
  if (Number.isNaN(Date.parse(text))) throw new Error("invalid date");
  return text;
}

function tableFields(section: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match || match[1] === "Field" || /^-+$/.test(match[1]!.trim())) continue;
    fields.set(match[1]!.trim(), stripCode(match[2]!.trim()));
  }
  return fields;
}

function stripCode(value: string): string {
  return value.startsWith("`") && value.endsWith("`") ? value.slice(1, -1) : value;
}

function shellWords(command: string): string[] {
  const words: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|([^\s]+)/g;
  for (const match of command.matchAll(pattern)) words.push(match[1] ?? match[2] ?? match[3] ?? "");
  return words.filter(Boolean);
}

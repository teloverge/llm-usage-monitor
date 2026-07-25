import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { networkInterfaces, hostname, platform, arch } from "node:os";
import { join } from "node:path";
import type { SourceHost, SourceHostObservation } from "@llm-usage-monitor/contracts";

export async function resolveLocalSourceHost(
  dataDirectory: string,
  now = new Date(),
): Promise<{ host: SourceHost; observations: SourceHostObservation[] }> {
  const identityFile = join(dataDirectory, "source-host.json");
  await fs.mkdir(dataDirectory, { recursive: true });
  let identity: { id: string; firstSeenAt: string };
  try {
    identity = JSON.parse(await fs.readFile(identityFile, "utf8")) as typeof identity;
  } catch {
    identity = { id: `host:${randomUUID()}`, firstSeenAt: now.toISOString() };
    await fs.writeFile(identityFile, JSON.stringify(identity, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
  const seenAt = now.toISOString();
  const hostName = hostname().trim() || null;
  const host: SourceHost = {
    id: identity.id,
    hostname: hostName,
    platform: platform(),
    architecture: arch(),
    firstSeenAt: identity.firstSeenAt,
    lastSeenAt: seenAt,
  };
  const values = new Set<string>();
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? []) if (!entry.internal) values.add(entry.address);
  const observations: SourceHostObservation[] = [
    ...(hostName
      ? [
          {
            sourceHostId: host.id,
            kind: "hostname" as const,
            value: hostName,
            firstSeenAt: seenAt,
            lastSeenAt: seenAt,
          },
        ]
      : []),
    ...[...values].map((value) => ({
      sourceHostId: host.id,
      kind: "ip-address" as const,
      value,
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
    })),
  ];
  return { host, observations };
}

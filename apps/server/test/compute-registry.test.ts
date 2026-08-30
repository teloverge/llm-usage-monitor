import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalComputeHost,
  localTailnetDnsName,
  parseComputeRegistry,
  remoteInspectionTimeoutMs,
  validateMachineInspection,
} from "../src/compute-registry.ts";
import { MONITORED_SOURCES } from "../src/machine-inspection.ts";

const SOURCE_HOST_ID = "managed:pf-omen";

function remoteResult(credential: unknown) {
  const at = "2026-08-30T02:00:00.000Z";
  return {
    host: {
      id: SOURCE_HOST_ID,
      hostname: "PF-Omen",
      platform: "win32",
      architecture: "x64",
      firstSeenAt: at,
      lastSeenAt: at,
    },
    observations: [],
    sources: MONITORED_SOURCES.map((source) => ({
      inspection: {
        sourceHostId: SOURCE_HOST_ID,
        managedHostId: "pf-omen",
        usageSourceId: source.usageSourceId,
        harnessId: source.harnessId,
        status: "available",
        records: 0,
        inspectedAt: at,
      },
      records: [],
      quotaSnapshots: [],
      state: {},
      ...(source.usageSourceId === "codex-local" ? { credential } : {}),
    })),
  };
}

const sighting = {
  usageSourceId: "codex-local",
  sourceHostId: SOURCE_HOST_ID,
  mode: "subscription",
  fingerprint: "ddf56ff57053",
  inferred: false,
  observedAt: "2026-08-30T02:00:00.000Z",
};

describe("managed compute registry", () => {
  it("parses managed host identity and SSH fields from COMPUTE.md", () => {
    const hosts = parseComputeRegistry(`
# Managed compute

## \`amd-halo\`

| Field | Value |
| --- | --- |
| Hostname | \`amd-halo\` |
| Tailnet DNS name | \`amd-halo.example.ts.net\` |
| Operating system | Linux |
| Architecture | \`x86_64\` |
| SSH command | \`ssh pfdev@amd-halo.example.ts.net\` |

## \`pf-omen\`

| Field | Value |
| --- | --- |
| Hostname | \`PF-Omen\` |
| Tailnet DNS name | \`pf-omen.example.ts.net\` |
| Operating system | Windows 11 |
| Architecture | \`x86_64\` |
| SSH command | \`ssh pfdev@pf-omen.example.ts.net\` |
| Node command | \`C:\\Users\\pfdev\\.vite-plus\\js_runtime\\node\\24.20.0\\node.exe\` |
`);
    assert.equal(hosts.length, 2);
    assert.deepEqual(hosts[1], {
      id: "pf-omen",
      hostname: "PF-Omen",
      tailnetDnsName: "pf-omen.example.ts.net",
      operatingSystem: "Windows 11",
      architecture: "x86_64",
      sshCommand: "ssh pfdev@pf-omen.example.ts.net",
      nodeCommand: "C:\\Users\\pfdev\\.vite-plus\\js_runtime\\node\\24.20.0\\node.exe",
    });
    assert.equal(isLocalComputeHost(hosts[0]!, "AMD-HALO"), true);
    assert.equal(isLocalComputeHost(hosts[1]!, "amd-halo"), false);
    assert.equal(localTailnetDnsName(hosts, "AMD-HALO"), "amd-halo.example.ts.net");
    assert.equal(remoteInspectionTimeoutMs(hosts[0]!), 30_000);
    assert.equal(remoteInspectionTimeoutMs(hosts[1]!), 180_000);
  });

  it("ignores descriptive sections that are not managed host entries", () => {
    assert.deepEqual(parseComputeRegistry("# Managed compute\n\n## Notes\n\nNo host table."), []);
  });

  it("keeps a remote host's credential sighting", () => {
    const result = validateMachineInspection(remoteResult(sighting), "pf-omen", SOURCE_HOST_ID);
    assert.deepEqual(result.sources[0]!.credential, sighting);
  });

  /**
   * The agent bundled before sightings existed sends no `credential` field. Its
   * result must still be accepted, or updating the server would silently drop
   * every remote host until each was re-inspected with the new bundle.
   */
  it("accepts a remote result that carries no credential sighting", () => {
    const result = validateMachineInspection(remoteResult(undefined), "pf-omen", SOURCE_HOST_ID);
    assert.equal(result.sources[0]!.credential, null);
    assert.equal(
      validateMachineInspection(remoteResult(null), "pf-omen", SOURCE_HOST_ID).sources[0]!
        .credential,
      null,
    );
  });

  it("refuses a sighting that names another host or source", () => {
    assert.throws(
      () =>
        validateMachineInspection(
          remoteResult({ ...sighting, sourceHostId: "host:other" }),
          "pf-omen",
          SOURCE_HOST_ID,
        ),
      /credential identity mismatch/,
    );
    assert.throws(
      () =>
        validateMachineInspection(
          remoteResult({ ...sighting, usageSourceId: "claude-code-local" }),
          "pf-omen",
          SOURCE_HOST_ID,
        ),
      /credential identity mismatch/,
    );
  });

  it("refuses a malformed sighting", () => {
    assert.throws(() =>
      validateMachineInspection(
        remoteResult({ ...sighting, fingerprint: "not-hex" }),
        "pf-omen",
        SOURCE_HOST_ID,
      ),
    );
  });

  it("refuses Tailnet mode when the local host has no Tailnet DNS name", () => {
    assert.throws(
      () =>
        localTailnetDnsName(
          [
            {
              id: "local",
              hostname: "local",
              tailnetDnsName: "",
              operatingSystem: "Linux",
              architecture: "x86_64",
              sshCommand: "ssh local",
              nodeCommand: "node",
            },
          ],
          "local",
        ),
      /Tailnet DNS name/,
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalComputeHost,
  localTailnetDnsName,
  parseComputeRegistry,
  remoteInspectionTimeoutMs,
} from "../src/compute-registry.ts";

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

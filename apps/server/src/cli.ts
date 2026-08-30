#!/usr/bin/env node
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDirectory } from "./app-paths.ts";
import { localTailnetDnsName, readComputeRegistry } from "./compute-registry.ts";
import { readDiscovery, startUsageMonitorServer } from "./server.ts";

const command = process.argv[2] ?? "start";
const dataDirectory = appDataDirectory();
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory =
  process.env.LLM_USAGE_MONITOR_WEB_DIR || join(currentDirectory, "..", "..", "web", "dist");
const computeFile =
  process.env.LLM_USAGE_MONITOR_COMPUTE_FILE || join(process.cwd(), ".armadai", "COMPUTE.md");
const agentPath =
  process.env.LLM_USAGE_MONITOR_AGENT_PATH ||
  join(currentDirectory, "..", "..", "source-host-agent", "dist", "cli.mjs");
const network = await serverNetwork();

if (command === "status") {
  const discovery = await readDiscovery(dataDirectory);
  console.log(discovery ? `running ${discovery.dashboardUrl}` : "stopped");
  process.exit(discovery ? 0 : 1);
}
if (command === "refresh") {
  const discovery = await readDiscovery(dataDirectory);
  if (!discovery) throw new Error("The Usage Monitor Server is not running.");
  console.log(JSON.stringify(await refreshSources(discovery), null, 2));
  process.exit(0);
}
if (command !== "start") throw new Error(`Unknown server command: ${command}`);
const existing = await readDiscovery(dataDirectory);
if (existing) {
  console.log(existing.dashboardUrl);
  if (process.argv.includes("--open")) openBrowser(existing.dashboardUrl);
  if (process.argv.includes("--refresh")) await refreshSources(existing);
  process.exit(0);
}
const running = await startUsageMonitorServer({
  dataDirectory,
  webDirectory,
  runtimeId: process.env.LLM_USAGE_MONITOR_RUNTIME_ID,
  computeFile,
  agentPath,
  ...network,
});
console.log(running.discovery.dashboardUrl);
if (process.argv.includes("--open")) openBrowser(running.discovery.dashboardUrl);
if (process.argv.includes("--refresh")) {
  try {
    await refreshSources(running.discovery);
  } catch (error) {
    console.warn(error instanceof Error ? error.message : String(error));
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => running.close().finally(() => process.exit(0)));

function openBrowser(url: string) {
  const [executable, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(executable, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  }).unref();
}

async function refreshSources(discovery: { origin: string; dashboardUrl: string }) {
  const response = await fetch(new URL("api/actions", discovery.dashboardUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: discovery.origin },
    body: JSON.stringify({ version: 1, type: "refresh-sources" }),
  });
  if (!response.ok) throw new Error(`Source refresh failed (${response.status}).`);
  return response.json();
}

async function serverNetwork(): Promise<{
  listenHost?: string;
  advertisedHost?: string;
}> {
  const configuredListenHost = process.env.LLM_USAGE_MONITOR_LISTEN_HOST?.trim();
  const configuredAdvertisedHost = process.env.LLM_USAGE_MONITOR_ADVERTISED_HOST?.trim();
  if (configuredListenHost || configuredAdvertisedHost)
    return {
      ...(configuredListenHost ? { listenHost: configuredListenHost } : {}),
      ...(configuredAdvertisedHost ? { advertisedHost: configuredAdvertisedHost } : {}),
    };
  if (!process.argv.includes("--tailnet")) return {};
  const tailnetHost = localTailnetDnsName(await readComputeRegistry(computeFile), hostname());
  return { listenHost: tailnetHost, advertisedHost: tailnetHost };
}

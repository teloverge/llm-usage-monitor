#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appDataDirectory } from "./app-paths.ts";
import { readDiscovery, startUsageMonitorServer } from "./server.ts";

const command = process.argv[2] ?? "start";
const dataDirectory = appDataDirectory();
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const webDirectory =
  process.env.LLM_USAGE_MONITOR_WEB_DIR || join(currentDirectory, "..", "..", "web", "dist");

if (command === "status") {
  const discovery = await readDiscovery(dataDirectory);
  console.log(discovery ? `running ${discovery.dashboardUrl}` : "stopped");
  process.exit(discovery ? 0 : 1);
}
if (command !== "start") throw new Error(`Unknown server command: ${command}`);
const existing = await readDiscovery(dataDirectory);
if (existing) {
  console.log(existing.dashboardUrl);
  process.exit(0);
}
const running = await startUsageMonitorServer({
  dataDirectory,
  webDirectory,
  runtimeId: process.env.LLM_USAGE_MONITOR_RUNTIME_ID,
});
console.log(running.discovery.dashboardUrl);
if (process.argv.includes("--open")) openBrowser(running.discovery.dashboardUrl);
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

import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as vscode from "vscode";

interface Discovery {
  pid: number;
  origin: string;
  dashboardUrl: string;
  healthUrl: string;
  shutdownUrl: string;
  runtimeId?: string | null;
}
const LEGACY_RECORDS_KEY = "usageRecords.v1";
const MIGRATION_MARKER = "portableHostMigration.v1";
const STOPPED_MARKER = "server.stopped";

export async function activate(context: vscode.ExtensionContext) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.name = "LLM Usage Monitor";
  status.command = "llmUsageMonitor.openDashboard";
  context.subscriptions.push(status);
  let serverStart: Promise<Discovery> | null = null;
  let trayForServerPid: number | null = null;
  const ensureServer = async (explicit = false): Promise<Discovery> => {
    const dataDirectory = appDataDirectory();
    const runtimeId = await expectedRuntimeId(context);
    if (explicit) await fs.rm(join(dataDirectory, STOPPED_MARKER), { force: true });
    else if (await exists(join(dataDirectory, STOPPED_MARKER))) throw new ServerStoppedError();
    const running = await readDiscovery(dataDirectory);
    if (running?.runtimeId === runtimeId) {
      await ensureWindowsTray(context, running, dataDirectory, trayForServerPid, (pid) => {
        trayForServerPid = pid;
      });
      return running;
    }
    if (running) {
      await stopServer(running);
      trayForServerPid = null;
    }
    if (!serverStart)
      serverStart = discoverOrStart(context, runtimeId)
        .then(async (discovery) => {
          await ensureWindowsTray(context, discovery, dataDirectory, trayForServerPid, (pid) => {
            trayForServerPid = pid;
          });
          return discovery;
        })
        .finally(() => {
          serverStart = null;
        });
    return serverStart;
  };
  const refreshStatus = async () => {
    if (!vscode.workspace.getConfiguration("llmUsageMonitor").get("showStatusBar", true))
      return status.hide();
    try {
      const discovery = await ensureServer();
      const view = await request(discovery, "api/overview?timeframe=today");
      status.text = `$(pulse) LLM ${new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(view.totals.estimatedCost))}`;
      status.tooltip = `${Number(view.totals.totalTokens).toLocaleString()} tokens today · API-equivalent estimate`;
      status.show();
    } catch (error) {
      status.text =
        error instanceof ServerStoppedError
          ? "$(circle-slash) LLM monitor stopped"
          : "$(warning) LLM monitor offline";
      status.show();
    }
  };
  const action = async (value: unknown, explicit = true) => {
    const discovery = await ensureServer(explicit);
    const result = await request(discovery, "api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: discovery.origin },
      body: JSON.stringify(value),
    });
    await refreshStatus();
    return result;
  };
  const openDashboard = async () => {
    const discovery = await ensureServer(true);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(discovery.dashboardUrl));
    if (!opened) throw new Error("The system browser did not accept the dashboard URL.");
  };
  context.subscriptions.push(
    vscode.commands.registerCommand("llmUsageMonitor.openDashboard", openDashboard),
    vscode.commands.registerCommand("llmUsageMonitor.importCodexHistory", async () => {
      const codexHome = vscode.workspace
        .getConfiguration("llmUsageMonitor")
        .get<string>("codexHome", "");
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Refreshing local Codex usage" },
        () => action({ version: 1, type: "import-codex", ...(codexHome ? { codexHome } : {}) }),
      );
      vscode.window.showInformationMessage(
        `Refreshed ${Number(result.affectedRecords || 0).toLocaleString()} Usage Records.`,
      );
    }),
  );
  try {
    await ensureServer();
    if (!context.globalState.get<boolean>(MIGRATION_MARKER, false)) {
      const records = context.globalState.get<unknown[]>(LEGACY_RECORDS_KEY, []);
      await action(
        {
          version: 1,
          type: "migrate-legacy",
          migrationId: `vscode-global-state:${context.extension.id}`,
          records,
        },
        false,
      );
      await context.globalState.update(MIGRATION_MARKER, true);
    }
    if (vscode.workspace.getConfiguration("llmUsageMonitor").get("autoImport", true))
      await action({ version: 1, type: "import-codex" }, false);
  } catch (error) {
    if (!(error instanceof ServerStoppedError))
      vscode.window.showErrorMessage(
        `LLM Usage Monitor could not start: ${error instanceof Error ? error.message : String(error)}`,
      );
  }
  await refreshStatus();
}

async function discoverOrStart(
  context: vscode.ExtensionContext,
  runtimeId: string,
): Promise<Discovery> {
  const dataDirectory = appDataDirectory();
  const existing = await readDiscovery(dataDirectory);
  if (existing?.runtimeId === runtimeId) return existing;
  const serverPath = join(context.extensionPath, "dist", "runtime", "server.mjs");
  const webDirectory = join(context.extensionPath, "dist", "runtime", "web");
  const nodePath = vscode.workspace
    .getConfiguration("llmUsageMonitor")
    .get<string>("nodePath", "node");
  const child = spawn(nodePath, [serverPath, "start"], {
    detached: false,
    windowsHide: true,
    stdio: "ignore",
    shell: false,
    env: {
      ...process.env,
      LLM_USAGE_MONITOR_WEB_DIR: webDirectory,
      LLM_USAGE_MONITOR_RUNTIME_ID: runtimeId,
    },
  });
  child.on("error", () => undefined);
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const discovery = await readDiscovery(dataDirectory);
    if (discovery?.runtimeId === runtimeId) return discovery;
  }
  throw new Error(
    `The shared Usage Monitor Server did not become ready. Confirm that ${nodePath} resolves to Node.js 24 or newer.`,
  );
}

async function ensureWindowsTray(
  context: vscode.ExtensionContext,
  discovery: Discovery,
  dataDirectory: string,
  currentServerPid: number | null,
  rememberPid: (pid: number) => void,
) {
  if (process.platform !== "win32" || currentServerPid === discovery.pid) return;
  try {
    const state = JSON.parse(await fs.readFile(join(dataDirectory, "tray.json"), "utf8")) as {
      pid?: number;
      serverPid?: number;
    };
    if (state.serverPid === discovery.pid && state.pid && processExists(state.pid)) {
      rememberPid(discovery.pid);
      return;
    }
  } catch {}
  const powershellPath = join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const trayPath = join(context.extensionPath, "dist", "runtime", "tray.ps1");
  const iconPath = join(context.extensionPath, "dist", "logo.png");
  const tray = spawn(
    powershellPath,
    [
      "-NoProfile",
      "-STA",
      "-WindowStyle",
      "Hidden",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      trayPath,
      "-DataDirectory",
      dataDirectory,
      "-DashboardUrl",
      discovery.dashboardUrl,
      "-ShutdownUrl",
      discovery.shutdownUrl,
      "-Origin",
      discovery.origin,
      "-ServerPid",
      String(discovery.pid),
      "-IconPath",
      iconPath,
    ],
    { detached: false, windowsHide: true, stdio: "ignore", shell: false },
  );
  tray.on("error", () => {
    rememberPid(-1);
  });
  tray.unref();
  rememberPid(discovery.pid);
}

async function readDiscovery(dataDirectory: string): Promise<Discovery | null> {
  try {
    const value = JSON.parse(await fs.readFile(join(dataDirectory, "server.json"), "utf8")) as Omit<
      Discovery,
      "shutdownUrl"
    > & { shutdownUrl?: string };
    const response = await fetch(value.healthUrl, { signal: AbortSignal.timeout(1_000) });
    const health = (await response.json()) as { pid?: number; runtimeId?: string | null };
    if (!response.ok || health.pid !== value.pid) return null;
    return {
      ...value,
      runtimeId: health.runtimeId,
      shutdownUrl: value.shutdownUrl || new URL("shutdown", value.dashboardUrl).href,
    };
  } catch {
    return null;
  }
}
async function expectedRuntimeId(context: vscode.ExtensionContext): Promise<string> {
  const manifest = JSON.parse(
    await fs.readFile(join(context.extensionPath, "dist", "runtime", "runtime.json"), "utf8"),
  ) as { runtimeId?: unknown };
  if (typeof manifest.runtimeId !== "string" || !manifest.runtimeId)
    throw new Error("The staged Usage Monitor runtime identity is missing.");
  return manifest.runtimeId;
}
async function stopServer(discovery: Discovery): Promise<void> {
  try {
    await fetch(discovery.shutdownUrl, {
      method: "POST",
      headers: { Origin: discovery.origin },
      signal: AbortSignal.timeout(2_000),
    });
  } catch {}
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      await fetch(discovery.healthUrl, { signal: AbortSignal.timeout(200) });
    } catch {
      return;
    }
  }
  throw new Error("The previous Usage Monitor Server did not stop during the runtime update.");
}
async function request(discovery: Discovery, resource: string, init?: RequestInit): Promise<any> {
  const response = await fetch(new URL(resource, discovery.dashboardUrl), {
    ...init,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Usage Monitor request failed (${response.status}).`);
  return response.json();
}
function appDataDirectory(): string {
  if (process.env.LLM_USAGE_MONITOR_HOME) return process.env.LLM_USAGE_MONITOR_HOME;
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "Teloverge",
      "LLM Usage Monitor",
    );
  if (process.platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Teloverge LLM Usage Monitor");
  return join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "teloverge-llm-usage-monitor",
  );
}
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
class ServerStoppedError extends Error {
  constructor() {
    super("The Usage Monitor Server was exited from the system tray.");
  }
}

export function deactivate() {}

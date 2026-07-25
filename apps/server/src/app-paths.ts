import { homedir } from "node:os";
import { join } from "node:path";

export function appDataDirectory(env = process.env, platform = process.platform): string {
  if (env.LLM_USAGE_MONITOR_HOME) return env.LLM_USAGE_MONITOR_HOME;
  if (platform === "win32")
    return join(
      env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
      "Teloverge",
      "LLM Usage Monitor",
    );
  if (platform === "darwin")
    return join(homedir(), "Library", "Application Support", "Teloverge LLM Usage Monitor");
  return join(
    env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
    "teloverge-llm-usage-monitor",
  );
}

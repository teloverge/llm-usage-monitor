export type SupportedPlatform = "win32" | "darwin" | "linux";
export interface StartupPlan {
  mechanism: string;
  scope: "per-user";
  description: string;
}
export function startupPlan(platform: SupportedPlatform): StartupPlan {
  if (platform === "win32")
    return {
      mechanism: "Task Scheduler at user logon",
      scope: "per-user",
      description:
        "A non-elevated task starts usage-monitor-agent run when the enrolled user signs in.",
    };
  if (platform === "darwin")
    return {
      mechanism: "LaunchAgent",
      scope: "per-user",
      description: "A user LaunchAgent starts usage-monitor-agent run after login.",
    };
  return {
    mechanism: "systemd user service",
    scope: "per-user",
    description: "A systemd --user unit starts usage-monitor-agent run for the enrolled user.",
  };
}

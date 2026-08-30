#!/usr/bin/env node
import { startupPlan, type SupportedPlatform } from "./startup.ts";
import { hostname } from "node:os";
import { inspectMachine } from "../../server/src/machine-inspection.ts";

const command = process.argv[2] ?? "status";
if (command === "inspect") {
  const managedHostId = argument("--managed-host-id") || hostname();
  const sourceHostId = argument("--source-host-id") || `managed:${managedHostId}`;
  const inspection = await inspectMachine({ sourceHostId, managedHostId });
  const result = JSON.stringify({
    ...inspection,
    // Remote refreshes are complete scans. The server cannot reuse a
    // path-keyed cache created on another machine, so sending it would only
    // duplicate records and expose remote filesystem names.
    sources: inspection.sources.map(({ home: _home, ...source }) => ({ ...source, state: {} })),
  });
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${result}\n`, (error) => (error ? reject(error) : resolve()));
  });
  process.exit(0);
}
if (command === "status") {
  console.log("not enrolled; remote fleet transport is not implemented");
  process.exit(0);
}
if (command === "run")
  throw new Error(
    "Source Host Agent transport is disabled until authenticated fleet enrollment is implemented.",
  );
if (command === "enroll")
  throw new Error("Fleet enrollment is intentionally unavailable in this release.");
if (command === "install") {
  const plan = startupPlan(process.platform as SupportedPlatform);
  console.log(`${plan.mechanism} (${plan.scope}): ${plan.description}`);
  console.log("Installation is disabled until enrollment is implemented.");
  process.exit(0);
}
if (command === "uninstall") {
  console.log("No Source Host Agent startup registration exists in this release.");
  process.exit(0);
}
throw new Error(`Unknown Source Host Agent command: ${command}`);

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

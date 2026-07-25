#!/usr/bin/env node
import { startupPlan, type SupportedPlatform } from "./startup.ts";

const command = process.argv[2] ?? "status";
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

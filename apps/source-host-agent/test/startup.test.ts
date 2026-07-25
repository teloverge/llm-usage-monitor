import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startupPlan } from "../src/startup.ts";

describe("Source Host Agent startup", () => {
  it("uses a non-elevated per-user Windows startup mechanism", () => {
    const plan = startupPlan("win32");
    assert.equal(plan.mechanism, "Task Scheduler at user logon");
    assert.equal(plan.scope, "per-user");
  });
  it("uses per-user startup on macOS and Linux", () => {
    assert.equal(startupPlan("darwin").scope, "per-user");
    assert.equal(startupPlan("linux").scope, "per-user");
  });
});

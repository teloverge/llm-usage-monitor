import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDashboardActions } from "../src/index.ts";

const createPorts = () => ({
  localSourceHostId: "host:local",
  importCodex: async () => 2,
  importClaude: async () => 5,
  importGrok: async () => 4,
  migrateLegacy: (_id: string, records: unknown[]) => records.length,
  replacePrices: () => {},
  clearRecords: () => 3,
  setHostGroup: () => {},
});

describe("Dashboard Actions", () => {
  it("executes a validated action through one interface", async () =>
    assert.deepEqual(
      await createDashboardActions(createPorts()).execute({ version: 1, type: "import-codex" }),
      { ok: true, code: "codex-imported", affectedRecords: 2 },
    ));
  it("imports Grok Build history through the same interface", async () =>
    assert.deepEqual(
      await createDashboardActions(createPorts()).execute({ version: 1, type: "import-grok" }),
      { ok: true, code: "grok-imported", affectedRecords: 4 },
    ));
  it("fails closed on an unknown action", async () =>
    assert.rejects(
      createDashboardActions(createPorts()).execute({ version: 1, type: "delete-everything" }),
    ));
});

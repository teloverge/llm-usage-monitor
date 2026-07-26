import type { DashboardActionOutcome, ModelPrice, UsageRecord } from "@llm-usage-monitor/contracts";
import { dashboardActionSchema, usageRecordSchema } from "@llm-usage-monitor/contracts";

export interface DashboardActionPorts {
  localSourceHostId: string;
  importCodex(codexHome?: string): Promise<number>;
  importClaude(claudeHome?: string): Promise<number>;
  migrateLegacy(id: string, records: UsageRecord[]): number;
  replacePrices(prices: ModelPrice[]): void;
  clearRecords(): number;
  setHostGroup(id: string, name: string, sourceHostIds: string[], effectiveAt: string): void;
}

export function createDashboardActions(ports: DashboardActionPorts) {
  return {
    async execute(input: unknown): Promise<DashboardActionOutcome> {
      const action = dashboardActionSchema.parse(input);
      switch (action.type) {
        case "import-codex":
          return {
            ok: true,
            code: "codex-imported",
            affectedRecords: await ports.importCodex(action.codexHome),
          };
        case "import-claude":
          return {
            ok: true,
            code: "claude-imported",
            affectedRecords: await ports.importClaude(action.claudeHome),
          };
        case "migrate-legacy": {
          const records = action.records.map((record) =>
            usageRecordSchema.parse({ ...record, sourceHostId: ports.localSourceHostId }),
          );
          return {
            ok: true,
            code: "legacy-migrated",
            affectedRecords: ports.migrateLegacy(action.migrationId, records),
          };
        }
        case "replace-prices":
          ports.replacePrices(action.prices);
          return { ok: true, code: "prices-replaced" };
        case "clear-records":
          return { ok: true, code: "records-cleared", affectedRecords: ports.clearRecords() };
        case "set-host-group":
          ports.setHostGroup(
            action.hostGroupId,
            action.name,
            action.sourceHostIds,
            action.effectiveAt,
          );
          return { ok: true, code: "host-group-set" };
      }
    },
  };
}

export type DashboardActions = ReturnType<typeof createDashboardActions>;

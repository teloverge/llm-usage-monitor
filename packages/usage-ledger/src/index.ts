import { DatabaseSync } from "node:sqlite";
import type {
  HostGroupMembership,
  ModelPrice,
  SourceHost,
  SourceHostObservation,
  UsageRecord,
} from "@llm-usage-monitor/contracts";
import {
  decodeUsageRecord,
  modelPriceSchema,
  usageRecordSchema,
} from "@llm-usage-monitor/contracts";

export class UsageLedger {
  readonly database: DatabaseSync;

  constructor(path = ":memory:") {
    this.database = new DatabaseSync(path);
    this.database.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
    );
    this.migrate();
  }

  close(): void {
    this.database.close();
  }

  upsertRecords(records: UsageRecord[]): number {
    const validated = records.map((record) => usageRecordSchema.parse(record));
    const statement = this.database
      .prepare(`INSERT INTO usage_records (id, source_host_id, recorded_at, payload)
      VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source_host_id=excluded.source_host_id, recorded_at=excluded.recorded_at, payload=excluded.payload`);
    return this.transaction(() => {
      for (const record of validated)
        statement.run(record.id, record.sourceHostId, record.timestamp, JSON.stringify(record));
      return validated.length;
    });
  }

  records(): UsageRecord[] {
    return this.database
      .prepare("SELECT payload FROM usage_records ORDER BY recorded_at DESC")
      .all()
      .map((row) => decodeUsageRecord(JSON.parse(String(row.payload))));
  }

  clearRecords(): number {
    const count = Number(
      (this.database.prepare("SELECT COUNT(*) AS count FROM usage_records").get()?.count as
        | number
        | bigint
        | undefined) ?? 0,
    );
    this.database.exec("DELETE FROM usage_records; DELETE FROM provider_import_state;");
    return count;
  }

  upsertSourceHost(host: SourceHost, observations: SourceHostObservation[]): void {
    this.transaction(() => {
      this.database
        .prepare(`INSERT INTO source_hosts (id, hostname, platform, architecture, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET hostname=COALESCE(excluded.hostname, source_hosts.hostname), platform=excluded.platform, architecture=excluded.architecture, last_seen_at=excluded.last_seen_at`)
        .run(
          host.id,
          host.hostname,
          host.platform,
          host.architecture,
          host.firstSeenAt,
          host.lastSeenAt,
        );
      const insert = this.database
        .prepare(`INSERT INTO source_host_observations (source_host_id, kind, value, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(source_host_id, kind, value) DO UPDATE SET last_seen_at=excluded.last_seen_at`);
      for (const observation of observations)
        insert.run(
          observation.sourceHostId,
          observation.kind,
          observation.value,
          observation.firstSeenAt,
          observation.lastSeenAt,
        );
      this.database
        .prepare(`DELETE FROM source_host_observations WHERE rowid IN (
        SELECT rowid FROM source_host_observations WHERE source_host_id=? ORDER BY last_seen_at DESC LIMIT -1 OFFSET 100
      )`)
        .run(host.id);
    });
  }

  sourceHosts(): SourceHost[] {
    return this.database
      .prepare("SELECT * FROM source_hosts ORDER BY COALESCE(hostname, id)")
      .all()
      .map((row) => ({
        id: String(row.id),
        hostname: row.hostname === null ? null : String(row.hostname),
        platform: String(row.platform),
        architecture: String(row.architecture),
        firstSeenAt: String(row.first_seen_at),
        lastSeenAt: String(row.last_seen_at),
      }));
  }

  sourceHostObservations(sourceHostId: string): SourceHostObservation[] {
    return this.database
      .prepare(
        "SELECT * FROM source_host_observations WHERE source_host_id=? ORDER BY last_seen_at DESC",
      )
      .all(sourceHostId)
      .map((row) => ({
        sourceHostId: String(row.source_host_id),
        kind: String(row.kind) as SourceHostObservation["kind"],
        value: String(row.value),
        firstSeenAt: String(row.first_seen_at),
        lastSeenAt: String(row.last_seen_at),
      }));
  }

  replacePrices(prices: ModelPrice[]): void {
    const validated = prices.map((price) => modelPriceSchema.parse(price));
    this.transaction(() => {
      this.database.exec("DELETE FROM model_prices");
      const insert = this.database.prepare(
        "INSERT INTO model_prices (provider, model, payload) VALUES (?, ?, ?)",
      );
      for (const price of validated)
        insert.run(
          price.provider.toLocaleLowerCase(),
          price.model.toLocaleLowerCase(),
          JSON.stringify(price),
        );
    });
  }

  prices(): ModelPrice[] {
    return this.database
      .prepare("SELECT payload FROM model_prices ORDER BY provider, model")
      .all()
      .map((row) => modelPriceSchema.parse(JSON.parse(String(row.payload))));
  }

  setHostGroup(id: string, name: string, sourceHostIds: string[], effectiveAt: string): void {
    this.transaction(() => {
      this.database
        .prepare(
          "INSERT INTO host_groups (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        )
        .run(id, name);
      this.database
        .prepare(
          "UPDATE host_group_memberships SET effective_to=? WHERE host_group_id=? AND effective_to IS NULL",
        )
        .run(effectiveAt, id);
      const insert = this.database.prepare(
        "INSERT INTO host_group_memberships (host_group_id, source_host_id, effective_from, effective_to) VALUES (?, ?, ?, NULL)",
      );
      for (const sourceHostId of new Set(sourceHostIds)) insert.run(id, sourceHostId, effectiveAt);
    });
  }

  memberships(): HostGroupMembership[] {
    return this.database
      .prepare("SELECT * FROM host_group_memberships ORDER BY effective_from")
      .all()
      .map((row) => ({
        hostGroupId: String(row.host_group_id),
        sourceHostId: String(row.source_host_id),
        effectiveFrom: String(row.effective_from),
        effectiveTo: row.effective_to === null ? null : String(row.effective_to),
      }));
  }

  hasMigration(id: string): boolean {
    return Boolean(
      this.database.prepare("SELECT 1 AS found FROM applied_migrations WHERE id=?").get(id),
    );
  }
  markMigration(id: string): void {
    this.database
      .prepare("INSERT OR IGNORE INTO applied_migrations (id, applied_at) VALUES (?, ?)")
      .run(id, new Date().toISOString());
  }
  applyMigration(id: string, records: UsageRecord[]): number {
    if (this.hasMigration(id)) return 0;
    const validated = records.map((record) => usageRecordSchema.parse(record));
    return this.transaction(() => {
      const insert = this.database
        .prepare(`INSERT INTO usage_records (id, source_host_id, recorded_at, payload) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET source_host_id=excluded.source_host_id, recorded_at=excluded.recorded_at, payload=excluded.payload`);
      for (const record of validated)
        insert.run(record.id, record.sourceHostId, record.timestamp, JSON.stringify(record));
      this.database
        .prepare("INSERT INTO applied_migrations (id, applied_at) VALUES (?, ?)")
        .run(id, new Date().toISOString());
      return validated.length;
    });
  }
  importState(providerId: string): unknown {
    const row = this.database
      .prepare("SELECT payload FROM provider_import_state WHERE provider_id=?")
      .get(providerId);
    return row ? JSON.parse(String(row.payload)) : {};
  }
  setImportState(providerId: string, state: unknown): void {
    this.database
      .prepare(
        "INSERT INTO provider_import_state (provider_id, payload) VALUES (?, ?) ON CONFLICT(provider_id) DO UPDATE SET payload=excluded.payload",
      )
      .run(providerId, JSON.stringify(state));
  }
  commitProviderImport(providerId: string, records: UsageRecord[], state: unknown): number {
    const validated = records.map((record) => usageRecordSchema.parse(record));
    return this.transaction(() => {
      const insert = this.database
        .prepare(`INSERT INTO usage_records (id, source_host_id, recorded_at, payload) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET source_host_id=excluded.source_host_id, recorded_at=excluded.recorded_at, payload=excluded.payload`);
      for (const record of validated)
        insert.run(record.id, record.sourceHostId, record.timestamp, JSON.stringify(record));
      this.database
        .prepare(
          "INSERT INTO provider_import_state (provider_id, payload) VALUES (?, ?) ON CONFLICT(provider_id) DO UPDATE SET payload=excluded.payload",
        )
        .run(providerId, JSON.stringify(state));
      return validated.length;
    });
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS usage_records (id TEXT PRIMARY KEY, source_host_id TEXT NOT NULL, recorded_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS usage_records_time ON usage_records(recorded_at);
      CREATE INDEX IF NOT EXISTS usage_records_host_time ON usage_records(source_host_id, recorded_at);
      CREATE TABLE IF NOT EXISTS source_hosts (id TEXT PRIMARY KEY, hostname TEXT, platform TEXT NOT NULL, architecture TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_host_observations (source_host_id TEXT NOT NULL REFERENCES source_hosts(id), kind TEXT NOT NULL CHECK(kind IN ('hostname','ip-address')), value TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, PRIMARY KEY(source_host_id, kind, value));
      CREATE TABLE IF NOT EXISTS host_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS host_group_memberships (host_group_id TEXT NOT NULL REFERENCES host_groups(id), source_host_id TEXT NOT NULL REFERENCES source_hosts(id), effective_from TEXT NOT NULL, effective_to TEXT, PRIMARY KEY(host_group_id, source_host_id, effective_from));
      CREATE TABLE IF NOT EXISTS model_prices (provider TEXT NOT NULL, model TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(provider, model));
      CREATE TABLE IF NOT EXISTS provider_import_state (provider_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS applied_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    `);
  }

  private transaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

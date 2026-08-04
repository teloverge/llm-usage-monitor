import { DatabaseSync } from "node:sqlite";
import type {
  CredentialObservation,
  CredentialSighting,
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  SourceHost,
  SourceHostObservation,
  UsageQuotaSnapshot,
  UsageRecord,
} from "@llm-usage-monitor/contracts";
import {
  credentialObservationSchema,
  credentialSightingSchema,
  decodeUsageRecord,
  modelPriceSchema,
  usageQuotaSnapshotSchema,
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
    this.database.exec(
      "DELETE FROM usage_records; DELETE FROM provider_import_state; DELETE FROM usage_quota_snapshots;",
    );
    return count;
  }

  /**
   * Keeps the NEWEST snapshot per (usage source, host, credential), not the
   * most recently written one. Quota state is a point-in-time observation, so
   * an import that happens to see older evidence — a partial scan, a re-read of
   * an archived session, two sources racing — must not overwrite a fresher
   * reading. Without the WHERE clause this is last-write-wins, which passes any
   * test that writes in ascending order and silently reverts the quota meter in
   * production.
   *
   * The credential is part of the key so an account SWITCH is not an overwrite:
   * each subscription keeps its last-known meters, which is what lets several
   * accounts on the same provider sit side by side on the Plan limits tab.
   *
   * The comparison is lexicographic on ISO-8601. `usageQuotaSnapshotSchema`
   * pins `observedAt` to UTC (Zod's `.datetime()` rejects offsets), so that is
   * chronological — with one bounded exception: mixed sub-second precision at
   * the same second sorts "…00Z" after "…00.5Z". Sources emit uniform
   * precision, and the worst case is picking the wrong one of two observations
   * under a second apart, so this stays a string compare rather than a parse.
   */
  replaceQuotaSnapshots(snapshots: UsageQuotaSnapshot[]): void {
    const validated = snapshots.map((snapshot) => usageQuotaSnapshotSchema.parse(snapshot));
    this.transaction(() => {
      const insert = this.database
        .prepare(`INSERT INTO usage_quota_snapshots (usage_source_id, source_host_id, credential_id, observed_at, payload) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(usage_source_id, source_host_id, credential_id) DO UPDATE SET observed_at=excluded.observed_at, payload=excluded.payload
        WHERE excluded.observed_at > usage_quota_snapshots.observed_at`);
      // A stamped snapshot supersedes the unattributed row for its source and
      // host. That row is the same account before it could be identified — a
      // pre-upgrade reading, or a run where the credential collector saw
      // nothing — not evidence of a distinct account, and leaving it would
      // render a permanent stale card beside the identified one.
      const supersede = this.database.prepare(
        "DELETE FROM usage_quota_snapshots WHERE usage_source_id=? AND source_host_id=? AND credential_id=''",
      );
      for (const snapshot of validated) {
        if (snapshot.credentialId) supersede.run(snapshot.usageSourceId, snapshot.sourceHostId);
        insert.run(
          snapshot.usageSourceId,
          snapshot.sourceHostId,
          snapshot.credentialId ?? "",
          snapshot.observedAt,
          JSON.stringify(snapshot),
        );
      }
    });
  }

  quotaSnapshots(): UsageQuotaSnapshot[] {
    return this.database
      .prepare("SELECT payload FROM usage_quota_snapshots ORDER BY usage_source_id")
      .all()
      .map((row) => usageQuotaSnapshotSchema.parse(JSON.parse(String(row.payload))));
  }

  /**
   * Records a credential sighting under the first-seen rule.
   *
   * A sighting matching the latest one for its (usage source, host) only
   * advances `observed_at`. Only a CHANGE of mode or fingerprint opens a new
   * effective-dated row, and `effective_from` is the instant that change was
   * first seen.
   *
   * Writing a row per sighting instead would not merely be wasteful, it would
   * defeat the feature: `auth.json` is rewritten on every token refresh, so
   * `effective_from` would advance every day, no observation would ever precede
   * an older record, and every record would resolve to unattributed forever
   * while the table filled with thousands of identical rows.
   *
   * `effectiveFrom` is assigned here and nowhere else. A collector cannot set
   * it, which is what makes "never backdated" structural rather than a rule
   * someone has to remember.
   *
   * A new row's `effectiveFrom` is clamped to never precede the latest
   * existing row's `observedAt` for that (usage source, host). Without the
   * clamp, a backwards clock jump — an NTP correction, a VM resuming from a
   * suspended snapshot, a dual-boot machine with a skewed hardware clock —
   * would open the new row dated earlier than a row already on record,
   * backdating attribution for everything in between. README.md, CHANGELOG.md,
   * and CONTEXT.md all state attribution is never backdated; this clamp is
   * what keeps that true when the system clock itself misbehaves.
   */
  recordCredentialObservation(sighting: CredentialSighting): void {
    const seen = credentialSightingSchema.parse(sighting);
    this.transaction(() => {
      const latest = this.database
        .prepare(
          `SELECT mode, fingerprint, effective_from, observed_at FROM credential_observations
           WHERE usage_source_id=? AND source_host_id=? ORDER BY effective_from DESC LIMIT 1`,
        )
        .get(seen.usageSourceId, seen.sourceHostId) as
        | { mode: string; fingerprint: string; effective_from: string; observed_at: string }
        | undefined;
      const unchanged = latest?.mode === seen.mode && latest?.fingerprint === seen.fingerprint;
      const effectiveFrom = unchanged
        ? latest!.effective_from
        : latest && seen.observedAt < latest.observed_at
          ? latest.observed_at
          : seen.observedAt;
      // An observation seen out of order must not drag the latest confirmation
      // backwards; imports can re-read older evidence.
      if (unchanged && seen.observedAt <= latest!.observed_at) return;
      const observation: CredentialObservation = { ...seen, effectiveFrom };
      this.database
        .prepare(
          `INSERT INTO credential_observations
           (usage_source_id, source_host_id, mode, fingerprint, payload, effective_from, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(usage_source_id, source_host_id, mode, fingerprint, effective_from)
           DO UPDATE SET observed_at=excluded.observed_at, payload=excluded.payload`,
        )
        .run(
          observation.usageSourceId,
          observation.sourceHostId,
          observation.mode,
          observation.fingerprint,
          JSON.stringify(observation),
          observation.effectiveFrom,
          observation.observedAt,
        );
    });
  }

  /**
   * Oldest first, because that is the order attribution reads them in.
   *
   * Deliberately NOT cleared by `clearRecords`: a first-seen date cannot be
   * recovered once lost. Re-observing tomorrow would date the credential to
   * tomorrow and strand every earlier record in the unattributed bucket, so
   * clearing usage must not destroy an observation about the machine.
   */
  credentialObservations(): CredentialObservation[] {
    return this.database
      .prepare("SELECT payload FROM credential_observations ORDER BY effective_from")
      .all()
      .map((row) => credentialObservationSchema.parse(JSON.parse(String(row.payload))));
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

  /**
   * Sets a group's full membership as of `effectiveAt`. Both "close" statements
   * matter: the first ends memberships this group no longer claims, the second
   * ends the incoming hosts' memberships in OTHER groups. Without the second, a
   * host moved between groups keeps two open rows and `effectiveGroup`'s
   * `.find()` resolves it to whichever was created first — not the one chosen.
   */
  setHostGroup(id: string, name: string, sourceHostIds: string[], effectiveAt: string): void {
    const hosts = [...new Set(sourceHostIds)];
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
      const release = this.database.prepare(
        "UPDATE host_group_memberships SET effective_to=? WHERE source_host_id=? AND host_group_id<>? AND effective_to IS NULL",
      );
      for (const sourceHostId of hosts) release.run(effectiveAt, sourceHostId, id);
      // DO UPDATE, not DO NOTHING: the close above may have just stamped this
      // exact row, and DO NOTHING would leave the membership retired.
      const insert = this.database.prepare(
        `INSERT INTO host_group_memberships (host_group_id, source_host_id, effective_from, effective_to) VALUES (?, ?, ?, NULL)
         ON CONFLICT(host_group_id, source_host_id, effective_from) DO UPDATE SET effective_to=NULL`,
      );
      for (const sourceHostId of hosts) insert.run(id, sourceHostId, effectiveAt);
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

  hostGroups(): HostGroup[] {
    return this.database
      .prepare("SELECT id, name FROM host_groups ORDER BY name")
      .all()
      .map((row) => ({ id: String(row.id), name: String(row.name) }));
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
      CREATE TABLE IF NOT EXISTS usage_quota_snapshots (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, credential_id TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(usage_source_id, source_host_id, credential_id));
      CREATE TABLE IF NOT EXISTS credential_observations (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, mode TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, effective_from TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY (usage_source_id, source_host_id, mode, fingerprint, effective_from));
    `);
    this.upgradeQuotaSnapshotsKey();
  }

  /**
   * Re-keys a pre-0.6 snapshot table. The primary key gained `credential_id`
   * so one account's login no longer overwrites another's last-known meters;
   * a legacy table — detected by the missing column, since CREATE IF NOT
   * EXISTS will not have touched it — is rebuilt with every row keyed as
   * unattributed. The next import stamps the live account and supersedes the
   * unattributed row, so the rebuild needs no knowledge of credentials.
   */
  private upgradeQuotaSnapshotsKey(): void {
    const columns = this.database.prepare("PRAGMA table_info(usage_quota_snapshots)").all();
    if (columns.some((column) => String(column.name) === "credential_id")) return;
    this.database.exec(`
      ALTER TABLE usage_quota_snapshots RENAME TO usage_quota_snapshots_legacy;
      CREATE TABLE usage_quota_snapshots (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, credential_id TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(usage_source_id, source_host_id, credential_id));
      INSERT INTO usage_quota_snapshots (usage_source_id, source_host_id, credential_id, observed_at, payload)
        SELECT usage_source_id, source_host_id, '', observed_at, payload FROM usage_quota_snapshots_legacy;
      DROP TABLE usage_quota_snapshots_legacy;
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

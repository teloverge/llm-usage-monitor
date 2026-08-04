# Plan Limits Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Plan limits panel off the Overview into a fourth top-level tab organized as one card per Credential, with the ledger retaining one quota snapshot per credential so multiple subscriptions to the same provider no longer overwrite each other.

**Architecture:** The quota snapshot contract gains an optional `credentialId` stamped by the import pipeline at observation time; the ledger's `usage_quota_snapshots` primary key gains that credential so account switches retain rather than overwrite; the analysis layer computes an `active` flag (latest observation per source+host) before applying the Period/Host/Credential filters; the web app grows a `planLimits` view that groups snapshots into credential-first cards. The Overview's rail keeps only Token Mix and Hosts.

**Tech Stack:** TypeScript strict, Zod 4 (contracts), node:sqlite (ledger), React 19 + react-i18next (web), node:test + node:assert/strict (all tests).

## Global Constraints

- Package manager is Bun (`bun@1.3.14`); workflow entry point is the `vp` CLI: `vp install`, `vp run check`.
- Run a single test file with: `node --experimental-strip-types --test <path/to/file.test.ts>` (this is exactly what the root `test` script globs).
- `vp run check` = format:check (oxfmt) + lint (oxlint) + typecheck (tsc) + test + build. It must pass before the final commit of the last task.
- Commit messages are plain imperative sentences with NO conventional-commit prefix (repo style: "Join Grok turn timestamps as instants and cover the label table"). Every commit ends with a second `-m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`.
- Domain vocabulary comes from `CONTEXT.md`: Usage Quota Snapshot, Credential, Usage Source, Source Host, Harness. A Usage Quota Snapshot is "attributed to the Credential in effect at observation" (already updated in CONTEXT.md).
- Comments in this repo state constraints and rationale the code cannot show, in full sentences. Match that register; never narrate what a line does.
- i18n: `apps/web/src/i18n/i18next.d.ts` types all keys from `typeof en` with `strictKeyChecks: true` — every new key must be added to **all eight** locale files (`en`, `de`, `es`, `fr`, `hi`, `ja`, `ru`, `zh`), and removing a key means removing it from all eight. Translations are machine-authored by convention (CHANGELOG 0.4.1 discloses this).
- Web model code (`apps/web/src/model/*`) never imports `t` or React — it takes labels/translators as parameters and is tested headlessly.
- `credentialId` string format is `credentialIdFor` output: `` `${mode}:${fingerprint}` `` (e.g. `subscription:9a1b2c3d4e5f`); the unattributed sentinel `UNATTRIBUTED_CREDENTIAL = "unattributed"` is deliberately not a valid `credentialIdFor` output.
- Fingerprints in tests must match the contract regex `^([0-9a-f]{12})?$` (12 lowercase hex or empty).

## File Structure

```
packages/contracts/src/index.ts          + credentialId on usageQuotaSnapshotSchema; + QuotaSnapshotView; OverviewView.quotaSnapshots retyped (Task 4)
packages/contracts/test/contracts.test.ts+ schema tests
packages/usage-ledger/src/index.ts       quota PK gains credential_id; legacy re-key; supersede '' row
packages/usage-ledger/test/ledger.test.ts+ retention + migration tests
apps/server/src/run-import.ts            sighting resolved first, snapshots stamped
apps/server/test/run-import.test.ts      + stamping tests
packages/usage-analysis/src/index.ts     + planLimits(); analyzeUsage uses it
packages/usage-analysis/test/analysis.test.ts  2 tests updated, new Plan limits describe
apps/web/src/model/plan-limits.ts        NEW: planCards(), cardInferred()
apps/web/test/plan-limits.test.ts        NEW: card grouping tests
apps/web/src/views/plan-limits.tsx       NEW: the tab
apps/web/src/app.tsx                     4th view wired
apps/web/src/views/overview.tsx          Plan limits panel removed
apps/web/src/components/quota-meters.tsx DELETED (markup absorbed by plan-limits.tsx)
apps/web/src/model/credential.ts         latestCredential deleted (last consumer gone)
apps/web/test/credential.test.ts         latestCredential describe deleted
apps/web/src/i18n/locales/*.json         nav.planLimits + planLimits.{active,empty}; overview.planLimits removed (×8)
apps/web/src/styles.css                  .plan-cards / .plan-card-active / .plan-active
README.md, CHANGELOG.md                  capability bullet + 0.6.0 entry
```

---

### Task 1: Credential identity on the quota snapshot contract

**Files:**

- Modify: `packages/contracts/src/index.ts` (usageQuotaSnapshotSchema, ~line 106; interface near OverviewView, ~line 327)
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**

- Consumes: existing `usageQuotaSnapshotSchema`, `UsageQuotaSnapshot`.
- Produces: `UsageQuotaSnapshot.credentialId?: string`; `export interface QuotaSnapshotView extends UsageQuotaSnapshot { active: boolean }`. Tasks 2–6 rely on both names exactly.

- [ ] **Step 0: Create the feature branch**

```bash
git checkout -b feature/plan-limits-tab main
```

- [ ] **Step 1: Write the failing test**

In `packages/contracts/test/contracts.test.ts`, add `usageQuotaSnapshotSchema` to the existing import from `../src/index.ts` if it is not already imported, then append:

```ts
describe("Usage Quota Snapshot credential attribution", () => {
  const base = {
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    observedAt: "2026-08-01T10:00:00.000Z",
    windows: [],
  };

  it("accepts the credential stamped at observation", () => {
    const parsed = usageQuotaSnapshotSchema.parse({
      ...base,
      credentialId: "subscription:9a1b2c3d4e5f",
    });
    assert.equal(parsed.credentialId, "subscription:9a1b2c3d4e5f");
  });

  it("still accepts a snapshot observed with no credential", () => {
    assert.equal(usageQuotaSnapshotSchema.parse(base).credentialId, undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`
Expected: FAIL — strict schema rejects the unrecognised `credentialId` key.

- [ ] **Step 3: Extend the schema and add the view interface**

In `usageQuotaSnapshotSchema`, after the `plan` field, add:

```ts
    /**
     * `credentialIdFor` of the Credential in effect when this was observed,
     * stamped by the import pipeline rather than the source. Absent means no
     * credential was observed alongside the reading — the snapshot then reads
     * as unattributed, the same statement the record attribution makes.
     */
    credentialId: z.string().min(1).max(220).optional(),
```

Immediately above the `OverviewView` interface, add:

```ts
/**
 * A snapshot as the analysis serves it. `active` marks the latest observation
 * per (usage source, host) — the credential that source is on NOW. It is
 * derived, which is why it lives on a view type rather than in the stored
 * snapshot schema a collector validates against.
 */
export interface QuotaSnapshotView extends UsageQuotaSnapshot {
  active: boolean;
}
```

Do NOT change `OverviewView.quotaSnapshots` yet — that retype lands with the analysis change in Task 4 so no intermediate commit fails typecheck.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/contracts/src/index.ts packages/contracts/test/contracts.test.ts
git commit -m "Add credential identity to the quota snapshot contract" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Ledger retains one quota snapshot per credential

**Files:**

- Modify: `packages/usage-ledger/src/index.ts` (`replaceQuotaSnapshots` ~line 84, `migrate()` ~line 383)
- Test: `packages/usage-ledger/test/ledger.test.ts`

**Interfaces:**

- Consumes: `UsageQuotaSnapshot.credentialId` from Task 1.
- Produces: `replaceQuotaSnapshots(snapshots: UsageQuotaSnapshot[]): void` and `quotaSnapshots(): UsageQuotaSnapshot[]` keep their signatures; behavior changes to per-credential retention. New private method `upgradeQuotaSnapshotsKey(): void`.

- [ ] **Step 1: Write the failing tests**

In `packages/usage-ledger/test/ledger.test.ts`, add `UsageQuotaSnapshot` to the type import from contracts, add these imports at the top:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
```

Then append inside the file (top level, alongside the existing describes). The fixture is named `quotaFixture`, NOT `snapshot`, because the existing `describe("Quota snapshot storage")` block already scopes a local `snapshot` helper and shadowing it would trip lint:

```ts
const quotaFixture = (over: Partial<UsageQuotaSnapshot> = {}): UsageQuotaSnapshot => ({
  usageSourceId: "test-local",
  sourceHostId: "host:a",
  observedAt: "2026-08-01T10:00:00.000Z",
  windows: [{ id: "session", label: "5-hour window", usedPercent: 40 }],
  ...over,
});

describe("quota snapshot retention per credential", () => {
  it("retains one snapshot per credential instead of overwriting on account switch", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([quotaFixture({ credentialId: "subscription:aaaaaaaaaaaa" })]);
    ledger.replaceQuotaSnapshots([
      quotaFixture({
        credentialId: "subscription:bbbbbbbbbbbb",
        observedAt: "2026-08-02T10:00:00.000Z",
      }),
    ]);
    const kept = ledger.quotaSnapshots().map((item) => item.credentialId);
    assert.deepEqual(kept.sort(), ["subscription:aaaaaaaaaaaa", "subscription:bbbbbbbbbbbb"]);
  });

  it("keeps the newest snapshot per credential, not the last written", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([quotaFixture({ credentialId: "subscription:aaaaaaaaaaaa" })]);
    ledger.replaceQuotaSnapshots([
      quotaFixture({
        credentialId: "subscription:aaaaaaaaaaaa",
        observedAt: "2026-07-31T10:00:00.000Z",
        windows: [{ id: "session", label: "5-hour window", usedPercent: 99 }],
      }),
    ]);
    const kept = ledger.quotaSnapshots();
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.windows[0]?.usedPercent, 40);
  });

  it("supersedes the unattributed row once the same source reports a credential", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([quotaFixture()]);
    ledger.replaceQuotaSnapshots([
      quotaFixture({
        credentialId: "subscription:aaaaaaaaaaaa",
        observedAt: "2026-08-02T10:00:00.000Z",
      }),
    ]);
    const kept = ledger.quotaSnapshots();
    assert.equal(kept.length, 1);
    assert.equal(kept[0]?.credentialId, "subscription:aaaaaaaaaaaa");
  });

  it("does not supersede another host's unattributed row", () => {
    const ledger = create();
    ledger.replaceQuotaSnapshots([quotaFixture({ sourceHostId: "host:b" })]);
    ledger.replaceQuotaSnapshots([
      quotaFixture({
        credentialId: "subscription:aaaaaaaaaaaa",
        observedAt: "2026-08-02T10:00:00.000Z",
      }),
    ]);
    assert.equal(ledger.quotaSnapshots().length, 2);
  });
});

describe("quota snapshot key migration", () => {
  it("re-keys a legacy table as unattributed and keeps its rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "lum-ledger-"));
    const path = join(directory, "ledger.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(
      `CREATE TABLE usage_quota_snapshots (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, observed_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(usage_source_id, source_host_id));`,
    );
    const stored = quotaFixture({ observedAt: "2026-07-01T00:00:00.000Z" });
    legacy
      .prepare("INSERT INTO usage_quota_snapshots VALUES (?, ?, ?, ?)")
      .run("test-local", "host:a", stored.observedAt, JSON.stringify(stored));
    legacy.close();
    const ledger = new UsageLedger(path);
    try {
      assert.equal(ledger.quotaSnapshots().length, 1);
      // The re-keyed row participates in the new retention: a stamped write
      // supersedes it rather than colliding with it.
      ledger.replaceQuotaSnapshots([
        quotaFixture({
          credentialId: "subscription:aaaaaaaaaaaa",
          observedAt: "2026-08-01T00:00:00.000Z",
        }),
      ]);
      assert.deepEqual(
        ledger.quotaSnapshots().map((item) => item.credentialId),
        ["subscription:aaaaaaaaaaaa"],
      );
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: FAIL — the two-column primary key overwrites on account switch, and the migration test fails because the legacy table shape is kept.

- [ ] **Step 3: Implement retention and migration**

In `migrate()`, change the `usage_quota_snapshots` CREATE line to the three-column key:

```sql
CREATE TABLE IF NOT EXISTS usage_quota_snapshots (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, credential_id TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(usage_source_id, source_host_id, credential_id));
```

After the `this.database.exec(...)` in `migrate()`, call `this.upgradeQuotaSnapshotsKey();` and add the method:

```ts
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
```

Replace `replaceQuotaSnapshots` with (keep the existing doc comment, changing its first line to "Keeps the NEWEST snapshot per (usage source, host, credential), not the most recently written one." — the ISO-8601 rationale paragraphs stay as they are):

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: PASS (all — existing quota tests in this file must also still pass).

- [ ] **Step 5: Commit**

```bash
git add packages/usage-ledger/src/index.ts packages/usage-ledger/test/ledger.test.ts
git commit -m "Retain one quota snapshot per credential in the ledger" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Import pipeline stamps snapshots with the observed credential

**Files:**

- Modify: `apps/server/src/run-import.ts`
- Test: `apps/server/test/run-import.test.ts`

**Interfaces:**

- Consumes: `credentialIdFor` from contracts; ledger behavior from Task 2.
- Produces: `runProviderImport` keeps its exact signature; snapshots reach the ledger with `credentialId` set whenever the credential collector returned a sighting.

- [ ] **Step 1: Write the failing tests**

Append to `apps/server/test/run-import.test.ts` inside the existing `describe("runProviderImport credential observation", ...)` block (it already defines `sighting` with mode `subscription` and fingerprint `9a1b2c3d4e5f`):

```ts
it("stamps the stored snapshot with the credential in effect at observation", async () => {
  const ledger = new UsageLedger();
  try {
    await runProviderImport(
      provider([goodSnapshot]),
      ledger,
      "host:a",
      undefined,
      () => {},
      async () => sighting,
    );
    assert.equal(ledger.quotaSnapshots()[0]?.credentialId, "subscription:9a1b2c3d4e5f");
  } finally {
    ledger.close();
  }
});

it("stores the snapshot unstamped when the collector observed nothing", async () => {
  const ledger = new UsageLedger();
  try {
    await runProviderImport(
      provider([goodSnapshot]),
      ledger,
      "host:a",
      undefined,
      () => {},
      async () => null,
    );
    assert.equal(ledger.quotaSnapshots().length, 1);
    assert.equal(ledger.quotaSnapshots()[0]?.credentialId, undefined);
  } finally {
    ledger.close();
  }
});

it("stores the snapshot unstamped when the collector throws", async () => {
  const ledger = new UsageLedger();
  const failures: string[] = [];
  try {
    await runProviderImport(
      provider([goodSnapshot]),
      ledger,
      "host:a",
      undefined,
      (id) => failures.push(id),
      async () => {
        throw new Error("auth.json vanished mid-read");
      },
    );
    // The reading is still true; only its attribution is unknown. A collector
    // failure downgrades the stamp, never the snapshot.
    assert.equal(ledger.quotaSnapshots().length, 1);
    assert.equal(ledger.quotaSnapshots()[0]?.credentialId, undefined);
    assert.deepEqual(failures, ["fake-local"]);
  } finally {
    ledger.close();
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test apps/server/test/run-import.test.ts`
Expected: FAIL — `credentialId` is undefined in the first new test (snapshots are written before the sighting is resolved).

- [ ] **Step 3: Reorder and stamp**

In `apps/server/src/run-import.ts`, add `credentialIdFor` to the contracts import (it becomes a value import):

```ts
import {
  credentialIdFor,
  type CredentialSighting,
  type UsageQuotaSnapshot,
  type UsageRecord,
} from "@llm-usage-monitor/contracts";
```

Replace the body of `runProviderImport` after the `commitProviderImport` line with:

```ts
// The sighting is resolved BEFORE the quota write so each snapshot can be
// stamped with the credential in effect at observation — the fact the ledger
// now keys retention on. A collector failure downgrades the stamp, never the
// snapshot: the reading is still true, it is merely unattributed.
let sighting: CredentialSighting | null = null;
if (observeCredential) {
  try {
    sighting = await observeCredential(result.stats.home, new Date().toISOString());
  } catch (error) {
    onAuxiliaryWriteFailed(provider.id, error);
  }
}
// Computed outside the map: TypeScript does not carry the null-check
// narrowing of a mutable binding into a closure, and the id is the same for
// every snapshot in the run anyway.
const stamp = sighting ? credentialIdFor(sighting) : null;
const stamped = stamp
  ? result.quotaSnapshots.map((snapshot) => ({ ...snapshot, credentialId: stamp }))
  : result.quotaSnapshots;
try {
  ledger.replaceQuotaSnapshots(stamped);
} catch (error) {
  // Refused, not ignored: swallowing this silently would hide a mapper that
  // has drifted from the contract behind a panel that merely looks stale.
  onAuxiliaryWriteFailed(provider.id, error);
}
if (sighting) {
  try {
    ledger.recordCredentialObservation(sighting);
  } catch (error) {
    // Same reasoning as the quota write above: the credential is a reading
    // about the machine, not the usage, and must not be able to discard a run.
    onAuxiliaryWriteFailed(provider.id, error);
  }
}
return committed;
```

Extend the function's doc comment: after "…cannot fail the import.", add "The credential is read before the quota is written because the snapshot carries the credential's id; the two remain independently fallible."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/run-import.test.ts`
Expected: PASS — including every pre-existing test in the file (order of auxiliary failures is unchanged from the callers' perspective).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/run-import.ts apps/server/test/run-import.test.ts
git commit -m "Stamp imported quota snapshots with the observed credential" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Analysis serves filtered, active-marked plan limits

**Files:**

- Modify: `packages/contracts/src/index.ts` (`OverviewView.quotaSnapshots`, ~line 350)
- Modify: `packages/usage-analysis/src/index.ts`
- Test: `packages/usage-analysis/test/analysis.test.ts`

**Interfaces:**

- Consumes: `QuotaSnapshotView`, `UNATTRIBUTED_CREDENTIAL`, existing `timeframeRange`, `currentQuota`.
- Produces: `export function planLimits(snapshots: UsageQuotaSnapshot[], filters: UsageFilters, now: Date): QuotaSnapshotView[]`; `OverviewView.quotaSnapshots: QuotaSnapshotView[]`. Task 6's view consumes `QuotaSnapshotView[]` from `overview.quotaSnapshots`.

- [ ] **Step 1: Update the two existing tests that pin the old pass-through behavior**

In `packages/usage-analysis/test/analysis.test.ts`, `describe("Quota snapshots in the overview")`:

Replace the assertion in `"passes supplied snapshots through unchanged"` (line ~530) and rename the test:

```ts
it("serves supplied snapshots marked active", () => {
  const snapshots = [
    {
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      plan: "plus",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
    },
  ];
  const view = analyzeUsage({
    records: [],
    prices: [],
    memberships: [],
    quotaSnapshots: snapshots,
    filters: { timeframe: "all" },
  });
  assert.deepEqual(view.quotaSnapshots, [{ ...snapshots[0], active: true }]);
});
```

Replace `"reports quota unchanged regardless of the active filters"` (and its leading comment, lines ~543-566) entirely with:

```ts
// The task query still never touches quota — a card has no task to match —
// but Period, Host and Credential now DO filter snapshots: the Plan limits
// tab treats the Period chip as its recency filter, with "All" revealing
// accounts long since logged out.
it("ignores the task query", () => {
  const snapshots = [
    {
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      plan: "plus",
      observedAt: "2026-07-23T10:00:00.000Z",
      windows: [{ id: "primary", label: "5-hour window", usedPercent: 41.5 }],
    },
  ];
  const view = analyzeUsage({
    records: [],
    prices: [],
    memberships: [],
    quotaSnapshots: snapshots,
    filters: { timeframe: "all", query: "matches-nothing" },
  });
  assert.equal(view.totals.records, 0);
  assert.equal(view.quotaSnapshots.length, 1);
});
```

- [ ] **Step 2: Add the new failing tests**

Append a new top-level describe:

```ts
describe("Plan limits", () => {
  const now = new Date("2026-08-03T12:00:00.000Z");
  const quota = (over: Partial<UsageQuotaSnapshot> = {}): UsageQuotaSnapshot => ({
    usageSourceId: "claude-code-local",
    sourceHostId: "host:a",
    observedAt: "2026-08-03T10:00:00.000Z",
    windows: [{ id: "session", label: "Session", usedPercent: 20 }],
    ...over,
  });
  const analyze = (snapshots: UsageQuotaSnapshot[], filters: UsageFilters) =>
    analyzeUsage({
      records: [],
      prices: [],
      memberships: [],
      quotaSnapshots: snapshots,
      filters,
      now,
    });

  it("marks only the latest observation per source and host active", () => {
    const view = analyze(
      [
        quota({
          credentialId: "subscription:aaaaaaaaaaaa",
          observedAt: "2026-07-01T10:00:00.000Z",
        }),
        quota({ credentialId: "subscription:bbbbbbbbbbbb" }),
      ],
      { timeframe: "all" },
    );
    assert.deepEqual(
      view.quotaSnapshots.map((item) => [item.credentialId, item.active]),
      [
        ["subscription:bbbbbbbbbbbb", true],
        ["subscription:aaaaaaaaaaaa", false],
      ],
    );
  });

  it("does not let filtering to an old credential promote it to active", () => {
    const view = analyze(
      [
        quota({
          credentialId: "subscription:aaaaaaaaaaaa",
          observedAt: "2026-07-01T10:00:00.000Z",
        }),
        quota({ credentialId: "subscription:bbbbbbbbbbbb" }),
      ],
      { timeframe: "all", credentialId: "subscription:aaaaaaaaaaaa" },
    );
    assert.deepEqual(
      view.quotaSnapshots.map((item) => [item.credentialId, item.active]),
      [["subscription:aaaaaaaaaaaa", false]],
    );
  });

  it("filters by period on the observation time", () => {
    const view = analyze(
      [
        quota(),
        quota({
          credentialId: "subscription:aaaaaaaaaaaa",
          observedAt: "2026-06-01T10:00:00.000Z",
        }),
      ],
      { timeframe: "7" },
    );
    assert.equal(view.quotaSnapshots.length, 1);
    assert.equal(view.quotaSnapshots[0]?.credentialId, undefined);
  });

  it("filters by host", () => {
    const view = analyze(
      [quota(), quota({ sourceHostId: "host:b", usageSourceId: "codex-local" })],
      { timeframe: "all", sourceHostId: "host:b" },
    );
    assert.deepEqual(
      view.quotaSnapshots.map((item) => item.sourceHostId),
      ["host:b"],
    );
  });

  it("resolves the unattributed filter to unstamped snapshots", () => {
    const view = analyze(
      [quota(), quota({ credentialId: "subscription:aaaaaaaaaaaa", sourceHostId: "host:b" })],
      { timeframe: "all", credentialId: "unattributed" },
    );
    assert.equal(view.quotaSnapshots.length, 1);
    assert.equal(view.quotaSnapshots[0]?.credentialId, undefined);
  });

  it("orders active snapshots first, then by recency", () => {
    const view = analyze(
      [
        quota({
          credentialId: "subscription:aaaaaaaaaaaa",
          observedAt: "2026-07-01T10:00:00.000Z",
        }),
        quota({
          credentialId: "subscription:cccccccccccc",
          observedAt: "2026-07-15T10:00:00.000Z",
        }),
        quota({ credentialId: "subscription:bbbbbbbbbbbb" }),
      ],
      { timeframe: "all" },
    );
    assert.deepEqual(
      view.quotaSnapshots.map((item) => item.credentialId),
      ["subscription:bbbbbbbbbbbb", "subscription:cccccccccccc", "subscription:aaaaaaaaaaaa"],
    );
  });
});
```

`UsageQuotaSnapshot` and `UsageFilters` types are already imported in this test file; add them if the import list lacks them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: FAIL — no `active` field, nothing filtered.

- [ ] **Step 4: Implement**

In `packages/contracts/src/index.ts`, retype the field and replace its comment:

```ts
  /**
   * The Plan limits tab's data: snapshots retained per credential, marked
   * `active` for the latest observation per (usage source, host), filtered by
   * period (on observation time), host, and credential — never by the task
   * query. Empty means nothing matching was observed, which is distinct from a
   * source reporting itself as unused.
   */
  quotaSnapshots: QuotaSnapshotView[];
```

(`QuotaSnapshotView` is declared above `OverviewView` since Task 1.)

In `packages/usage-analysis/src/index.ts`:

Add `QuotaSnapshotView` to the type import and `UNATTRIBUTED_CREDENTIAL` is already imported. Replace the `quotaSnapshots` line in `analyzeUsage`'s return with:

```ts
    quotaSnapshots: planLimits(input.quotaSnapshots ?? [], input.filters, now),
```

Replace the `AnalysisInput.quotaSnapshots` comment with:

```ts
/**
 * Filtered by period, host and credential — the Plan limits tab treats the
 * Period chip as its recency filter over `observedAt`, "All" being what
 * reveals accounts long since logged out. The task query never applies: a
 * quota card has no task to match. (Until 0.6 these were served unfiltered;
 * that stance made sense while the meters sat beside usage totals on the
 * Overview, which they no longer do.)
 */
```

Add below `currentQuota`:

```ts
/**
 * The Plan limits tab's read of the snapshot store.
 *
 * `active` is computed BEFORE any filter runs: it marks the latest observation
 * per (usage source, host) — the credential that source is on now — and
 * narrowing the view to an old credential must not promote that credential's
 * card to active.
 *
 * Sorted active-first, then by recency, so the accounts currently in use lead
 * regardless of how stale the retained history behind them is.
 */
export function planLimits(
  snapshots: UsageQuotaSnapshot[],
  filters: UsageFilters,
  now: Date,
): QuotaSnapshotView[] {
  const latest = new Map<string, string>();
  for (const snapshot of snapshots) {
    const key = `${snapshot.usageSourceId}\u0000${snapshot.sourceHostId}`;
    const seen = latest.get(key);
    if (!seen || snapshot.observedAt > seen) latest.set(key, snapshot.observedAt);
  }
  const [from, to] = timeframeRange(filters, now);
  return currentQuota(snapshots, now)
    .map((snapshot) => ({
      ...snapshot,
      active:
        latest.get(`${snapshot.usageSourceId}\u0000${snapshot.sourceHostId}`) ===
        snapshot.observedAt,
    }))
    .filter((snapshot) => {
      const observed = Date.parse(snapshot.observedAt);
      return (
        observed >= from &&
        observed <= to &&
        (!filters.sourceHostId || snapshot.sourceHostId === filters.sourceHostId) &&
        (!filters.credentialId ||
          (filters.credentialId === UNATTRIBUTED_CREDENTIAL
            ? !snapshot.credentialId
            : snapshot.credentialId === filters.credentialId))
      );
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        right.observedAt.localeCompare(left.observedAt),
    );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: PASS — including the untouched `currentQuota` describe.

- [ ] **Step 6: Typecheck the workspace and commit**

Run: `bun run typecheck`
Expected: PASS everywhere EXCEPT possibly `apps/web/src/components/quota-meters.tsx` — if it errors on `QuotaSnapshotView` vs `UsageQuotaSnapshot`, it will not: `QuotaSnapshotView extends UsageQuotaSnapshot`, so the component's wider parameter type still accepts it. If tsc is clean:

```bash
git add packages/contracts/src/index.ts packages/usage-analysis/src/index.ts packages/usage-analysis/test/analysis.test.ts
git commit -m "Serve plan limits filtered by period, host and credential" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Credential-first card grouping in the web model

**Files:**

- Create: `apps/web/src/model/plan-limits.ts`
- Test: `apps/web/test/plan-limits.test.ts`

**Interfaces:**

- Consumes: `QuotaSnapshotView`, `CredentialObservation`, `credentialIdFor` from contracts.
- Produces (Task 6 renders exactly these):

```ts
export interface PlanCard {
  credentialId: string | null;
  mode: string | null;
  plan?: string;
  active: boolean;
  snapshots: QuotaSnapshotView[];
}
export function planCards(snapshots: QuotaSnapshotView[]): PlanCard[];
export function cardInferred(card: PlanCard, credentials: CredentialObservation[]): boolean;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/web/test/plan-limits.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { cardInferred, planCards } from "../src/model/plan-limits.ts";

const snapshot = (over: Partial<QuotaSnapshotView> = {}): QuotaSnapshotView => ({
  usageSourceId: "claude-code-local",
  sourceHostId: "host:a",
  observedAt: "2026-08-03T10:00:00.000Z",
  windows: [],
  active: true,
  ...over,
});

describe("planCards", () => {
  it("groups the same credential across hosts into one card", () => {
    const cards = planCards([
      snapshot({ credentialId: "subscription:aaaaaaaaaaaa" }),
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        sourceHostId: "host:b",
        observedAt: "2026-08-02T10:00:00.000Z",
      }),
    ]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0]?.snapshots.length, 2);
    assert.equal(cards[0]?.mode, "subscription");
  });

  it("keeps unattributed snapshots on per-source cards, never one shared bucket", () => {
    const cards = planCards([snapshot(), snapshot({ usageSourceId: "codex-local" })]);
    assert.equal(cards.length, 2);
    assert.deepEqual(
      cards.map((card) => card.credentialId),
      [null, null],
    );
  });

  it("orders active cards first, then by most recent observation", () => {
    const cards = planCards([
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        active: false,
        observedAt: "2026-07-01T10:00:00.000Z",
      }),
      snapshot({
        credentialId: "subscription:cccccccccccc",
        active: false,
        observedAt: "2026-07-15T10:00:00.000Z",
      }),
      snapshot({ credentialId: "subscription:bbbbbbbbbbbb" }),
    ]);
    assert.deepEqual(
      cards.map((card) => card.credentialId),
      ["subscription:bbbbbbbbbbbb", "subscription:cccccccccccc", "subscription:aaaaaaaaaaaa"],
    );
  });

  it("takes the plan tier from the newest snapshot naming one", () => {
    const cards = planCards([
      snapshot({ credentialId: "subscription:aaaaaaaaaaaa" }),
      snapshot({
        credentialId: "subscription:aaaaaaaaaaaa",
        sourceHostId: "host:b",
        observedAt: "2026-08-01T10:00:00.000Z",
        plan: "claude_max_20x",
      }),
    ]);
    assert.equal(cards[0]?.plan, "claude_max_20x");
  });
});

describe("cardInferred", () => {
  const observation = (over: Partial<CredentialObservation> = {}): CredentialObservation => ({
    usageSourceId: "claude-code-local",
    sourceHostId: "host:a",
    mode: "subscription",
    fingerprint: "aaaaaaaaaaaa",
    inferred: true,
    effectiveFrom: "2026-07-10T00:00:00.000Z",
    observedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  });

  it("reports the newest matching observation's inferred flag", () => {
    const [card] = planCards([snapshot({ credentialId: "subscription:aaaaaaaaaaaa" })]);
    assert.equal(cardInferred(card!, [observation()]), true);
    assert.equal(
      cardInferred(card!, [
        observation(),
        observation({ inferred: false, observedAt: "2026-08-01T00:00:00.000Z" }),
      ]),
      false,
    );
  });

  it("is never inferred for an unattributed card", () => {
    const [card] = planCards([snapshot()]);
    assert.equal(cardInferred(card!, [observation()]), false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test apps/web/test/plan-limits.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the model**

Create `apps/web/src/model/plan-limits.ts`:

```ts
import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { credentialIdFor } from "@llm-usage-monitor/contracts";

export interface PlanCard {
  /** `credentialIdFor` id, or null for snapshots observed with no credential. */
  credentialId: string | null;
  /** Raw contract mode ("subscription", "api-key", …), or null when unattributed. */
  mode: string | null;
  /** Plan tier from the newest snapshot naming one. */
  plan?: string;
  /** True when any grouped snapshot is its source's current observation. */
  active: boolean;
  /** Newest first, so the card's header facts come from its freshest evidence. */
  snapshots: QuotaSnapshotView[];
}

/**
 * Groups the analysis's snapshots into one card per Credential — the
 * subscription is the thing, the source and host merely where it was observed
 * from, so one account seen from two machines is ONE card with two meter
 * groups.
 *
 * Unattributed snapshots do NOT share a bucket: each keeps a per-source card,
 * because two sources with unknown accounts are not known to be the SAME
 * account, and merging them would assert exactly that. The `\u0000` prefix
 * keeps those keys out of the credential-id namespace.
 */
export function planCards(snapshots: QuotaSnapshotView[]): PlanCard[] {
  const buckets = new Map<string, QuotaSnapshotView[]>();
  for (const snapshot of snapshots) {
    const key = snapshot.credentialId ?? `\u0000${snapshot.usageSourceId}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(snapshot);
    else buckets.set(key, [snapshot]);
  }
  return [...buckets.entries()]
    .map(([key, grouped]) => {
      const newestFirst = [...grouped].sort((left, right) =>
        right.observedAt.localeCompare(left.observedAt),
      );
      const credentialId = key.startsWith("\u0000") ? null : key;
      return {
        credentialId,
        mode: credentialId ? credentialId.slice(0, credentialId.lastIndexOf(":")) : null,
        plan: newestFirst.find((snapshot) => snapshot.plan)?.plan,
        active: grouped.some((snapshot) => snapshot.active),
        snapshots: newestFirst,
      };
    })
    .sort(
      (left, right) =>
        Number(right.active) - Number(left.active) ||
        (right.snapshots[0]?.observedAt ?? "").localeCompare(left.snapshots[0]?.observedAt ?? ""),
    );
}

/**
 * Whether the card's mode was deduced rather than stated — the same marking
 * `quota-meters` used to take from `latestCredential`. Judged from the NEWEST
 * matching observation: a mode once inferred and since stated outright has
 * been confirmed, and keeping the hedge would understate what is now known.
 */
export function cardInferred(card: PlanCard, credentials: CredentialObservation[]): boolean {
  let newest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (!card.credentialId || credentialIdFor(credential) !== card.credentialId) continue;
    if (!newest || credential.observedAt > newest.observedAt) newest = credential;
  }
  return newest?.inferred ?? false;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test apps/web/test/plan-limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/model/plan-limits.ts apps/web/test/plan-limits.test.ts
git commit -m "Group plan-limit snapshots into per-credential cards" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The Plan limits tab — view, nav, Overview removal, i18n, styles

No unit-test cycle here — this task is JSX, locale JSON and CSS; its gates are `bun run typecheck`, the full test suite staying green, and a manual run. Web components have no DOM test harness in this repo; all logic already landed tested in Tasks 4–5.

**Files:**

- Create: `apps/web/src/views/plan-limits.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/views/overview.tsx`
- Delete: `apps/web/src/components/quota-meters.tsx`
- Modify: `apps/web/src/model/credential.ts` (delete `latestCredential`)
- Modify: `apps/web/test/credential.test.ts` (delete its describe + import)
- Modify: `apps/web/src/i18n/locales/{en,de,es,fr,hi,ja,ru,zh}.json`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: `planCards`/`cardInferred`/`PlanCard` (Task 5), `QuotaSnapshotView` (Task 1), `overview.quotaSnapshots: QuotaSnapshotView[]` (Task 4), existing `credentialLabel`, `countsAgainstPlan`, `usageSourceLabel`, `quotaMeterView`, `QUOTA_GLYPH`, `quotaWindowLabel`, `formatDateTime`, `formatWholePercent`, `Panel`, `STATUS`.
- Produces: `export function PlanLimits({ snapshots, credentials, hostLabel }: { snapshots: QuotaSnapshotView[]; credentials: CredentialObservation[]; hostLabel: (sourceHostId: string) => string }): JSX element`; `View` union gains `"planLimits"`.

- [ ] **Step 1: Add the locale keys (all eight files)**

In each locale, (a) add `"planLimits"` to the `nav` group, reusing the language's existing `overview.planLimits` value; (b) delete `"planLimits"` from the `overview` group; (c) add a top-level `"planLimits"` group directly after the `"quota"` group. Values per locale:

| locale | nav.planLimits       | planLimits.active | planLimits.empty                                          |
| ------ | -------------------- | ----------------- | --------------------------------------------------------- |
| en     | `Plan limits`        | `In use`          | `No plan limits observed in this period.`                 |
| de     | `Plan-Limits`        | `In Benutzung`    | `In diesem Zeitraum wurden keine Plan-Limits beobachtet.` |
| es     | `Límites del plan`   | `En uso`          | `No se observaron límites del plan en este período.`      |
| fr     | `Limites du forfait` | `En usage`        | `Aucune limite de forfait observée sur cette période.`    |
| hi     | `प्लान सीमाएँ`       | `उपयोग में`       | `इस अवधि में कोई प्लान सीमा नहीं देखी गई।`                |
| ja     | `プランの上限`       | `使用中`          | `この期間にプランの上限は観測されていません。`            |
| ru     | `Лимиты плана`       | `Используется`    | `За этот период лимиты плана не наблюдались.`             |
| zh     | `计划限额`           | `使用中`          | `此期间未观测到计划限额。`                                |

The en.json fragments, exactly (the other locales mirror the structure with the values above):

```json
  "nav": {
    "overview": "Overview",
    "breakdown": "Breakdown",
    "history": "History",
    "planLimits": "Plan limits"
  },
```

```json
  "planLimits": {
    "active": "In use",
    "empty": "No plan limits observed in this period."
  },
```

- [ ] **Step 2: Create the view**

Create `apps/web/src/views/plan-limits.tsx` (the meter markup is carried over verbatim from `quota-meters.tsx`, minus the per-group credential badge, which is now card-level):

```tsx
import { useTranslation } from "react-i18next";
import type { CredentialObservation, QuotaSnapshotView } from "@llm-usage-monitor/contracts";
import { STATUS } from "../theme/palette.ts";
import { countsAgainstPlan, credentialLabel } from "../model/credential.ts";
import { formatDateTime, formatWholePercent, type QuotaStatus } from "../model/format.ts";
import { usageSourceLabel } from "../model/harness.ts";
import { cardInferred, planCards } from "../model/plan-limits.ts";
import { QUOTA_GLYPH, quotaMeterView } from "../model/quota-meter.ts";
import { quotaWindowLabel } from "../model/quota-window.ts";
import { Panel } from "../components/panel.tsx";

const FILL: Record<QuotaStatus, string> = {
  good: STATUS.good,
  warning: STATUS.warning,
  critical: STATUS.critical,
  unreported: "transparent",
};

export function PlanLimits({
  snapshots,
  credentials,
  hostLabel,
}: {
  snapshots: QuotaSnapshotView[];
  credentials: CredentialObservation[];
  hostLabel: (sourceHostId: string) => string;
}) {
  const { t } = useTranslation();
  const cards = planCards(snapshots);
  if (!cards.length) return <p className="empty-state">{t("planLimits.empty")}</p>;
  return (
    <div className="plan-cards">
      {cards.map((card) => (
        <Panel
          key={card.credentialId ?? `source:${card.snapshots[0]!.usageSourceId}`}
          label={
            card.credentialId ? credentialLabel(card.credentialId, t) : t("credential.unattributed")
          }
          className={card.active ? "plan-card-active" : ""}
        >
          <p className="quota-credential">
            {card.plan && <span>{card.plan}</span>}
            {card.active && <b className="plan-active">{t("planLimits.active")}</b>}
            {/*
              Codex states its mode; Claude's is deduced from an environment
              this process may not fully see. Marking the difference is the
              same instinct as reporting unreported rather than zero.
            */}
            {cardInferred(card, credentials) && <em>{t("credential.inferred")}</em>}
          </p>
          {card.mode && !countsAgainstPlan(card.mode) && (
            // The reason this feature exists: without it a percentage sits
            // beside spend that never touched the window it describes.
            <p className="quota-note">{t("credential.notCounted")}</p>
          )}
          <div className="quota-groups">
            {card.snapshots.map((snapshot) => {
              const observedAt = formatDateTime(snapshot.observedAt);
              return (
                <div
                  className="quota-group"
                  key={`${snapshot.usageSourceId}/${snapshot.sourceHostId}`}
                >
                  <p className="quota-source">
                    <span>
                      {usageSourceLabel(snapshot.usageSourceId)} ·{" "}
                      {hostLabel(snapshot.sourceHostId)}
                    </span>
                    {/*
                      These figures are caches refreshed only while their harness
                      is running, so the age of the reading is part of the claim.
                      A bare percentage with no date asserts more than the source
                      supports.
                    */}
                    {observedAt && (
                      <span className="quota-observed">{t("quota.asOf", { at: observedAt })}</span>
                    )}
                  </p>
                  {snapshot.windows.map((window) => {
                    const { status, shown, width } = quotaMeterView(window);
                    const resets = window.resetsAt ? formatDateTime(window.resetsAt) : null;
                    const label = quotaWindowLabel(window, t);
                    return (
                      <div className="quota-window" key={window.id}>
                        <p className="quota-head">
                          <b>{label}</b>
                          <span className={`quota-value ${status}`}>
                            {shown === null
                              ? t("common.notReported")
                              : `${QUOTA_GLYPH[status]} ${formatWholePercent(shown)}`.trim()}
                          </span>
                        </p>
                        {/*
                          No track at all when nothing was reported. An empty meter
                          is indistinguishable from a meter reading zero, and this
                          dashboard treats "did not say" and "said none" as
                          different facts.
                        */}
                        {shown !== null && (
                          <div
                            className="meter"
                            role="meter"
                            aria-valuenow={shown}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuetext={t("quota.used", { percent: formatWholePercent(shown) })}
                            aria-label={label}
                          >
                            <i style={{ width: `${width}%`, background: FILL[status] }} />
                          </div>
                        )}
                        {resets && (
                          <p className="quota-reset">{t("quota.resets", { at: resets })}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </Panel>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Wire the fourth view in `app.tsx`**

Three edits:

```ts
export type View = "overview" | "breakdown" | "history" | "planLimits";
```

```ts
const VIEWS: readonly View[] = ["overview", "breakdown", "history", "planLimits"];
```

Add the import `import { PlanLimits } from "./views/plan-limits.tsx";` and, in `ViewSlot`, before the final `return <History .../>`:

```tsx
if (view === "planLimits")
  return overview ? (
    <PlanLimits
      snapshots={overview.quotaSnapshots}
      credentials={overview.credentials}
      hostLabel={hostLabel}
    />
  ) : null;
```

- [ ] **Step 4: Remove the panel from the Overview**

In `apps/web/src/views/overview.tsx`: delete the `QuotaMeters` import, the `usageSourceLabel` half of the harness import (keep `harnessLabel`), and the entire `<Panel label={t("overview.planLimits")}>…</Panel>` block (lines ~55-66). The rail keeps Token Mix and Hosts.

- [ ] **Step 5: Delete the superseded component and helper**

- Delete the file `apps/web/src/components/quota-meters.tsx`.
- In `apps/web/src/model/credential.ts`, delete the `latestCredential` function (lines ~41-54).
- In `apps/web/test/credential.test.ts`, delete the `describe("latestCredential", ...)` block and remove `latestCredential` from the import list.

- [ ] **Step 6: Add the styles**

In `apps/web/src/styles.css`, directly after the `.quota-note` rule (~line 471):

```css
.plan-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--gap);
  align-items: start;
}
.plan-card-active {
  border-color: var(--accent);
}
.plan-active {
  color: var(--accent);
  font-weight: 650;
  font-size: var(--size-meta);
}
```

- [ ] **Step 7: Verify**

Run: `bun run typecheck` — expected PASS (this is what catches a missed `overview.planLimits` usage or a locale key typo, via `strictKeyChecks`).
Run: `node --experimental-strip-types --test apps/web/test/credential.test.ts apps/web/test/plan-limits.test.ts` — expected PASS.
Run: `bun run test` — expected PASS.

- [ ] **Step 8: See it work**

```powershell
vp run build:web; vp run build:server; node apps/server/dist/cli.mjs start --open
```

Confirm: the topbar shows a fourth "Plan limits" item; the tab shows one card per credential with meters, plan tier, "In use" badge and as-of stamps; the Overview rail no longer has a Plan limits panel; switching Period to "Today" before a refresh empties the tab honestly; the Host and Credential chips narrow the cards; the search box does nothing here. Stop the server afterwards (tray Exit or Ctrl+C).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Move plan limits to a dedicated credential-first tab" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Documentation and full verification

**Files:**

- Modify: `README.md` (capability bullets, lines 18-19)
- Modify: `CHANGELOG.md` (new top entry)

**Interfaces:** none — prose only.

- [ ] **Step 1: Update the README capability bullets**

Replace the two bullets at lines 18-19 ("Shows API-equivalent spend … per-source plan limits." and "Reads plan limits …") with:

```markdown
- Shows API-equivalent spend as a single headline figure with its cost drivers by harness, model, and task, plus token composition.
- Presents plan limits on a dedicated tab, one card per credential: several subscriptions to the same provider each keep their last-known meters instead of overwriting each other when accounts switch, and the account currently in use is marked. Reads plan limits from what each harness already stores locally — Codex's session rate-limit events and Claude Code's cached utilization block. Each meter is stamped with the time the reading was taken, and a window whose reset time has passed is withheld rather than shown at a percentage that no longer applies.
```

- [ ] **Step 2: Add the CHANGELOG entry**

At the top of `CHANGELOG.md`, under `# Changelog`, insert:

```markdown
## 0.6.0

- Plan limits moved from the Overview to their own tab, organized as one card per credential: the subscription is the thing, the harness merely where it was observed from, so one account seen from several machines is a single card. The account currently in use is marked "In use".
- Multiple subscriptions to the same provider are now retained side by side. Switching accounts no longer overwrites the previous account's last-known meters; each snapshot is stamped with the credential in effect when it was observed, and a reading from before the monitor could identify the account is superseded once the same source reports who it is.
- The Period chip is the tab's recency filter — "All retained" reveals accounts long since logged out, whose expired windows are withheld as always — and the Host and Credential chips narrow the cards. The task search does not apply to plan limits.
```

- [ ] **Step 3: Full check**

Run: `vp run check`
Expected: PASS end to end (format, lint, typecheck, tests, build). Fix anything it flags before committing — oxfmt formatting of the new files is the usual candidate (`vp run format`).

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "Document the credential-first Plan limits tab" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note for the release that eventually ships this: the workspace `package.json` version bump to 0.6.0 belongs to the release flow, not this branch (per the maintainer's convention: bump the version and cut a release before every local VSIX build; never package the same version twice).

---

## Out of scope (explicitly agreed)

- No importers for ChatGPT (consumer app) or the VS Code Continue extension — their usage stays invisible; provider-reported meters may still reflect their consumption because quota is account-level.
- No remnant of the Plan limits panel on the Overview.
- No real two-account test data exists (the maintainer has one subscription per provider); multi-credential behavior is covered exclusively by the fabricated-fingerprint tests above.
- `UsageQuotaSnapshot.balance` remains stored-but-unrendered, exactly as before.

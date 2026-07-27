# Credential attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell subscription usage apart from API-key usage — on the plan-limits panel, in the breakdown, and as a filter — by observing each harness's credential and attributing every Usage Record to whichever credential was in effect when it happened.

**Architecture:** Collectors read each harness's current credential and hand the ledger a _sighting_; the ledger turns sightings into effective-dated _observations_ under a first-seen rule, so re-seeing the same credential is a no-op. Attribution is then derived in `usage-analysis` (never stamped on records), exactly as Host Group membership already is. Records older than the earliest observation land in a distinguished unattributed bucket and are never backfilled.

**Tech Stack:** TypeScript with native Node type-stripping, `node:test` + `node:assert/strict`, Zod 4 contracts, SQLite via the ledger, React 19 + i18next web app, oxfmt/oxlint, Bun via the `vp` CLI.

**Spec:** `docs/superpowers/specs/2026-07-26-credential-attribution-design.md`
**Depends on:** `docs/superpowers/plans/2026-07-26-claude-plan-limits.md` (merged into this branch's history)

## Global Constraints

- Node.js 24+, Bun 1.3+. Full verification is `bun run check` (format:check + lint + typecheck + test + build); `vp run check` is equivalent if `vp` is on PATH.
- **`bun run test` cannot catch type errors.** Node's runner strips type annotations without checking them, so a passing suite does not mean the code compiles. Run `bun run typecheck` separately and report its real output. This has already bitten this project once.
- **`bun run check` includes `format:check`.** If oxfmt objects, run `bun run format` and commit _everything_ it changes, not only your own files. This has also already bitten this project once.
- Tests are `node:test` `describe`/`it` with `node:assert/strict`. No test framework dependency exists; do not add one.
- Test files sit **directly** in a `test/` directory — the runner glob `apps/*/test/*.test.ts` is one level deep only.
- Local TypeScript imports use explicit `.ts` extensions.
- **Never read credential material.** `~/.claude/.credentials.json` is never opened. In `~/.codex/auth.json`, only `auth_mode`, `OPENAI_API_KEY`'s _presence_, and `tokens.account_id` may be read — the token bodies are never read, hashed, or logged. Fingerprints are taken from account identifiers only, never from keys.
- **Absent measurements are omitted fields, never `0` or `""`-as-a-value.** The dashboard distinguishes "did not say" from "said none".
- **Nothing is ever backdated.** A collector cannot set `effectiveFrom`; only the ledger assigns it, at the instant a credential is first seen.
- User-visible strings go through i18next with keys added to **both** `en.json` and `es.json`. A key in one locale only is a silent runtime gap that nothing type-checks.
- Analysis keys rows by raw id; the _view_ resolves labels. `model/` never imports `t` — translated wording is injected as a parameter, the idiom `harnessLabel` and `RankList` already use.
- Commit after every task.

---

### Task 1: Credential contracts

The vocabulary every later task depends on. `CredentialSighting` and `CredentialObservation` differ by exactly one field, and that difference is the design: a collector states what it sees, the ledger decides when it was first seen.

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/contracts.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `credentialModeSchema` — `z.enum(["subscription","api-key","bedrock","vertex","unknown"])`
  - `credentialSightingSchema`, `credentialObservationSchema` (both `.strict()`)
  - `type CredentialMode`, `type CredentialSighting`, `type CredentialObservation`
  - `credentialIdFor(credential: { mode: string; fingerprint: string }): string`
  - `UNATTRIBUTED_CREDENTIAL: "unattributed"`
  - `UsageFilters.credentialId?: string`

- [ ] **Step 1: Write the failing test**

Append to `packages/contracts/test/contracts.test.ts`, adding the new names to the existing import from `../src/index.ts`:

```ts
describe("credential contracts", () => {
  const sighting = {
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    mode: "subscription" as const,
    fingerprint: "9a1b2c3d4e5f",
    inferred: false,
    observedAt: "2026-07-26T22:00:00.000Z",
  };

  it("accepts a sighting a collector can state", () => {
    assert.deepEqual(credentialSightingSchema.parse(sighting), sighting);
  });

  it("refuses a sighting that tries to set its own effective date", () => {
    // The whole point of the split: a collector able to set `effectiveFrom`
    // could backdate attribution, which the spec forbids outright.
    assert.throws(() =>
      credentialSightingSchema.parse({ ...sighting, effectiveFrom: "2020-01-01T00:00:00.000Z" }),
    );
  });

  it("accepts an observation once the ledger has dated it", () => {
    const observation = { ...sighting, effectiveFrom: "2026-07-26T22:00:00.000Z" };
    assert.deepEqual(credentialObservationSchema.parse(observation), observation);
  });

  it("accepts an empty fingerprint for a source that states no account", () => {
    assert.equal(credentialSightingSchema.parse({ ...sighting, fingerprint: "" }).fingerprint, "");
  });

  it("refuses a fingerprint that is not 12 lowercase hex", () => {
    for (const fingerprint of ["9A1B2C3D4E5F", "9a1b2c", "9a1b2c3d4e5fa", "zzzzzzzzzzzz"]) {
      assert.throws(
        () => credentialSightingSchema.parse({ ...sighting, fingerprint }),
        new RegExp(""),
        `should refuse ${fingerprint}`,
      );
    }
  });

  it("refuses a mode outside the known set", () => {
    assert.throws(() => credentialSightingSchema.parse({ ...sighting, mode: "oauth" }));
  });

  it("derives a bucket key that is stable and carries no secret", () => {
    assert.equal(credentialIdFor(sighting), "subscription:9a1b2c3d4e5f");
    assert.equal(credentialIdFor({ mode: "api-key", fingerprint: "" }), "api-key:");
  });

  it("names the unattributed bucket distinctly", () => {
    assert.equal(UNATTRIBUTED_CREDENTIAL, "unattributed");
    assert.notEqual(UNATTRIBUTED_CREDENTIAL, credentialIdFor({ mode: "unknown", fingerprint: "" }));
  });

  it("accepts a credential filter", () => {
    assert.equal(
      filtersSchema.parse({ timeframe: "30", credentialId: "subscription:9a1b2c3d4e5f" })
        .credentialId,
      "subscription:9a1b2c3d4e5f",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`
Expected: FAIL — `credentialSightingSchema` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `packages/contracts/src/index.ts`, above `usageRecordSchema`:

```ts
export const credentialModeSchema = z.enum([
  "subscription",
  "api-key",
  "bedrock",
  "vertex",
  "unknown",
]);

/**
 * The facts a collector can state about a credential.
 *
 * `fingerprint` is a one-way digest of an ACCOUNT identifier — 12 lowercase hex,
 * or empty when the source names no account. It exists to tell two accounts
 * apart, never to identify one, and it is never taken from key material.
 */
const credentialFacts = {
  usageSourceId: z.string().min(1).max(200),
  sourceHostId: z.string().min(1).max(200),
  mode: credentialModeSchema,
  fingerprint: z.string().regex(/^([0-9a-f]{12})?$/),
  plan: z.string().max(200).optional(),
  /** True when the mode was deduced rather than stated by the source. */
  inferred: z.boolean(),
  observedAt: z.string().datetime(),
};

/**
 * What a collector hands the ledger. `effectiveFrom` is absent BY CONSTRUCTION:
 * it means "first time this credential was seen", which only the ledger knows,
 * and a collector able to set it could backdate attribution.
 */
export const credentialSightingSchema = z.object(credentialFacts).strict();

/** A sighting the ledger has dated. */
export const credentialObservationSchema = z
  .object({ ...credentialFacts, effectiveFrom: z.string().datetime() })
  .strict();

export type CredentialMode = z.infer<typeof credentialModeSchema>;
export type CredentialSighting = z.infer<typeof credentialSightingSchema>;
export type CredentialObservation = z.infer<typeof credentialObservationSchema>;

/**
 * Bucket key and filter value. Derivable from the observation itself, so no
 * lookup is needed to group or filter by credential, and it carries a
 * fingerprint rather than an identifier.
 */
export function credentialIdFor(credential: { mode: string; fingerprint: string }): string {
  return `${credential.mode}:${credential.fingerprint}`;
}

/**
 * The bucket for records older than the earliest observation for their
 * (usage source, host). Deliberately not a valid `credentialIdFor` output, so it
 * can never collide with a real credential — including `unknown:`, which means
 * "we saw a credential and could not classify it", a different statement from
 * "we had not started looking yet".
 */
export const UNATTRIBUTED_CREDENTIAL = "unattributed";
```

In `filtersSchema`, after the `usageSourceId` line:

```ts
    credentialId: z.string().max(200).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test packages/contracts/test/contracts.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add packages/contracts/src/index.ts packages/contracts/test/contracts.test.ts
git commit -m "Add credential observation contracts

A sighting is what a collector can state; an observation is a sighting
the ledger has dated. They differ by effectiveFrom alone, and that
difference is the design - a collector able to set it could backdate
attribution."
```

---

### Task 2: Credential fingerprint

**Files:**

- Create: `apps/server/src/credential-fingerprint.ts`
- Test: `apps/server/test/credential-fingerprint.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `credentialFingerprint(value: unknown): string` — 12 lowercase hex, or `""`.

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/credential-fingerprint.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { credentialFingerprint } from "../src/credential-fingerprint.ts";

const ACCOUNT = "937ec57b-57ff-4293-abce-493df76661c8";

describe("credentialFingerprint", () => {
  it("is stable for the same account", () => {
    assert.equal(credentialFingerprint(ACCOUNT), credentialFingerprint(ACCOUNT));
  });

  it("produces 12 lowercase hex characters", () => {
    assert.match(credentialFingerprint(ACCOUNT), /^[0-9a-f]{12}$/);
  });

  it("distinguishes two accounts", () => {
    assert.notEqual(credentialFingerprint(ACCOUNT), credentialFingerprint("a-different-account"));
  });

  it("does not contain the value it digested", () => {
    // The ledger must never hold an account identifier, even in part.
    assert.ok(!credentialFingerprint(ACCOUNT).includes("937ec57b"));
  });

  it("reports no fingerprint when the source names no account", () => {
    for (const value of [undefined, null, "", "   ", 42, {}]) {
      assert.equal(credentialFingerprint(value), "", `should be empty for ${String(value)}`);
    }
  });

  it("ignores surrounding whitespace", () => {
    assert.equal(credentialFingerprint(` ${ACCOUNT} `), credentialFingerprint(ACCOUNT));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/credential-fingerprint.test.ts`
Expected: FAIL — `Cannot find module '../src/credential-fingerprint.ts'`

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/credential-fingerprint.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * One-way digest of an ACCOUNT identifier, for telling two accounts apart.
 *
 * Twelve hex characters is 48 bits — ample to distinguish the handful of
 * accounts on one machine, and short enough that the stored value never looks
 * like an identifier someone could use.
 *
 * Never call this on key material. Hashing is one-way, but the project's promise
 * is not to READ credentials at all, and an account id is enough to tell
 * accounts apart without ever touching a secret.
 */
export function credentialFingerprint(value: unknown): string {
  const account = typeof value === "string" ? value.trim() : "";
  if (!account) return "";
  return createHash("sha256").update(account).digest("hex").slice(0, 12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/credential-fingerprint.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/credential-fingerprint.ts apps/server/test/credential-fingerprint.test.ts
git commit -m "Fingerprint account identifiers so the ledger holds none

Twelve hex characters distinguishes the accounts on one machine without
the ledger ever storing something that identifies one."
```

---

### Task 3: Ledger storage under the first-seen rule

The rule this task implements is the one that makes the whole feature work rather than silently produce nothing. Read the reasoning in the step 3 comment before writing it.

**Files:**

- Modify: `packages/usage-ledger/src/index.ts` (the `migrate()` SQL block, plus two new methods)
- Test: `packages/usage-ledger/test/ledger.test.ts`

**Interfaces:**

- Consumes: `credentialSightingSchema`, `credentialObservationSchema`, `CredentialSighting`, `CredentialObservation` from Task 1.
- Produces:
  - `UsageLedger.recordCredentialObservation(sighting: CredentialSighting): void`
  - `UsageLedger.credentialObservations(): CredentialObservation[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-ledger/test/ledger.test.ts`. The file already has a `ledger()` helper that registers ledgers for cleanup — reuse it. Add `CredentialSighting` to the type imports from `@llm-usage-monitor/contracts`.

```ts
describe("Credential observations", () => {
  const sighting = (over: Partial<CredentialSighting> = {}): CredentialSighting => ({
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    mode: "subscription",
    fingerprint: "9a1b2c3d4e5f",
    inferred: false,
    observedAt: "2026-07-20T10:00:00.000Z",
    ...over,
  });

  it("dates a first sighting from when it was seen", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    const [observation] = store.credentialObservations();
    assert.equal(observation?.effectiveFrom, "2026-07-20T10:00:00.000Z");
    assert.equal(observation?.mode, "subscription");
  });

  it("does not open a new row when the same credential is seen again", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));

    // auth.json is rewritten on every token refresh. A row per sighting would
    // march effectiveFrom forward daily, leave no observation preceding any
    // record, and strand every record in the unattributed bucket forever.
    assert.equal(store.credentialObservations().length, 1);
    assert.equal(store.credentialObservations()[0]?.effectiveFrom, "2026-07-20T10:00:00.000Z");
    assert.equal(store.credentialObservations()[0]?.observedAt, "2026-07-25T10:00:00.000Z");
  });

  it("does not move the latest confirmation backwards", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-20T10:00:00.000Z" }));
    assert.equal(store.credentialObservations()[0]?.observedAt, "2026-07-25T10:00:00.000Z");
  });

  it("opens a new row when the mode changes, keeping the old one", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(
      sighting({ mode: "api-key", observedAt: "2026-07-25T10:00:00.000Z" }),
    );
    assert.deepEqual(
      store
        .credentialObservations()
        .map((observation) => [observation.mode, observation.effectiveFrom]),
      [
        ["subscription", "2026-07-20T10:00:00.000Z"],
        ["api-key", "2026-07-25T10:00:00.000Z"],
      ],
    );
  });

  it("opens a new row when the account changes", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(
      sighting({ fingerprint: "0f1e2d3c4b5a", observedAt: "2026-07-25T10:00:00.000Z" }),
    );
    assert.equal(store.credentialObservations().length, 2);
  });

  it("keeps each usage source and host independent", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    store.recordCredentialObservation(sighting({ usageSourceId: "claude-code-local" }));
    store.recordCredentialObservation(sighting({ sourceHostId: "host:b" }));
    assert.equal(store.credentialObservations().length, 3);
  });

  it("returns observations oldest first", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting({ observedAt: "2026-07-25T10:00:00.000Z" }));
    store.recordCredentialObservation(
      sighting({ mode: "api-key", observedAt: "2026-07-20T10:00:00.000Z" }),
    );
    assert.deepEqual(
      store.credentialObservations().map((observation) => observation.effectiveFrom),
      ["2026-07-20T10:00:00.000Z", "2026-07-25T10:00:00.000Z"],
    );
  });

  it("survives clearing records", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting());
    store.clearRecords();

    // A first-seen date cannot be recovered once lost: re-observing tomorrow
    // dates the credential to tomorrow and unattributes everything before it.
    // Clearing USAGE must not destroy an observation about the machine.
    assert.equal(store.credentialObservations().length, 1);
  });

  it("keeps the optional plan and the inferred flag", () => {
    const store = ledger();
    store.recordCredentialObservation(sighting({ plan: "claude_max_20x", inferred: true }));
    assert.equal(store.credentialObservations()[0]?.plan, "claude_max_20x");
    assert.equal(store.credentialObservations()[0]?.inferred, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: FAIL — `store.recordCredentialObservation is not a function`.

- [ ] **Step 3: Add the table**

In `packages/usage-ledger/src/index.ts`, inside `migrate()`'s `this.database.exec(...)` template, after the `usage_quota_snapshots` line:

```sql
      CREATE TABLE IF NOT EXISTS credential_observations (usage_source_id TEXT NOT NULL, source_host_id TEXT NOT NULL, mode TEXT NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, effective_from TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY (usage_source_id, source_host_id, mode, fingerprint, effective_from));
```

Additive, so empty and populated ledgers behave identically and no migration id is needed.

- [ ] **Step 4: Write the reader and writer**

Add to the `UsageLedger` class, after `quotaSnapshots()`, and add `credentialObservationSchema`, `credentialSightingSchema`, `type CredentialObservation`, `type CredentialSighting` to the imports from `@llm-usage-monitor/contracts`:

```ts
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
      const effectiveFrom = unchanged ? latest!.effective_from : seen.observedAt;
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: PASS, including the pre-existing suites.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add packages/usage-ledger/src/index.ts packages/usage-ledger/test/ledger.test.ts
git commit -m "Store credential observations under the first-seen rule

Re-seeing the same credential only advances the last-confirmed time.
A row per sighting would march effectiveFrom forward on every token
refresh and strand every record in the unattributed bucket forever."
```

---

### Task 4: Codex credential collector

Codex **states** its mode, so this is an observation rather than an inference.

**Files:**

- Create: `apps/server/src/codex-credential.ts`
- Test: `apps/server/test/codex-credential.test.ts`

**Interfaces:**

- Consumes: `credentialFingerprint` (Task 2), `CredentialSighting`/`CredentialMode` (Task 1).
- Produces: `codexCredentialSighting(home: string, sourceHostId: string, observedAt: string): Promise<CredentialSighting | null>`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/codex-credential.test.ts`:

```ts
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { codexCredentialSighting } from "../src/codex-credential.ts";

const scratch: string[] = [];
async function homeWith(auth: unknown): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-codex-auth-"));
  scratch.push(dir);
  if (auth !== undefined) {
    await fs.writeFile(
      join(dir, "auth.json"),
      typeof auth === "string" ? auth : JSON.stringify(auth),
      "utf8",
    );
  }
  return dir;
}
after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

const OBSERVED = "2026-07-26T22:00:00.000Z";

describe("codexCredentialSighting", () => {
  it("reads a subscription from the stated auth mode", async () => {
    const home = await homeWith({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: null,
      tokens: { account_id: "c8c541e4-1234", access_token: "secret-token-value" },
    });
    const sighting = await codexCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.usageSourceId, "codex-local");
    assert.equal(sighting?.mode, "subscription");
    assert.equal(sighting?.observedAt, OBSERVED);
    // Codex says so outright; nothing is being deduced.
    assert.equal(sighting?.inferred, false);
    assert.match(String(sighting?.fingerprint), /^[0-9a-f]{12}$/);
  });

  it("never lets token material reach the sighting", async () => {
    const home = await homeWith({
      auth_mode: "chatgpt",
      tokens: {
        account_id: "c8c541e4-1234",
        access_token: "secret-token-value",
        refresh_token: "rt.secret",
      },
    });
    const serialized = JSON.stringify(await codexCredentialSighting(home, "host:a", OBSERVED));
    assert.ok(!serialized.includes("secret-token-value"));
    assert.ok(!serialized.includes("rt.secret"));
    assert.ok(!serialized.includes("c8c541e4-1234"));
  });

  it("reads an API key from the stated auth mode", async () => {
    const home = await homeWith({ auth_mode: "apikey", OPENAI_API_KEY: "sk-live-value" });
    const sighting = await codexCredentialSighting(home, "host:a", OBSERVED);
    assert.equal(sighting?.mode, "api-key");
    // No account is stated in this mode, and a key is never fingerprinted.
    assert.equal(sighting?.fingerprint, "");
    assert.ok(!JSON.stringify(sighting).includes("sk-live-value"));
  });

  it("falls back to a key present with no stated mode", async () => {
    const home = await homeWith({ OPENAI_API_KEY: "sk-live-value" });
    assert.equal((await codexCredentialSighting(home, "host:a", OBSERVED))?.mode, "api-key");
  });

  it("classifies an unrecognised mode as unknown rather than dropping it", async () => {
    const home = await homeWith({ auth_mode: "device-code" });
    assert.equal((await codexCredentialSighting(home, "host:a", OBSERVED))?.mode, "unknown");
  });

  it("reports nothing when there is no evidence at all", async () => {
    assert.equal(
      await codexCredentialSighting(await homeWith(undefined), "host:a", OBSERVED),
      null,
    );
    assert.equal(
      await codexCredentialSighting(await homeWith("{ not json"), "host:a", OBSERVED),
      null,
    );
    assert.equal(await codexCredentialSighting(await homeWith([1, 2]), "host:a", OBSERVED), null);
    assert.equal(await codexCredentialSighting(await homeWith({}), "host:a", OBSERVED), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/codex-credential.test.ts`
Expected: FAIL — `Cannot find module '../src/codex-credential.ts'`

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/codex-credential.ts`:

```ts
import { promises as fs } from "node:fs";
import { join } from "node:path";
import type { CredentialMode, CredentialSighting } from "@llm-usage-monitor/contracts";
import { credentialFingerprint } from "./credential-fingerprint.ts";

const MAX_AUTH_BYTES = 4 * 1024 * 1024;

/**
 * Reads the credential Codex is currently using.
 *
 * Codex STATES its mode in `auth.json`, so this is an observation rather than an
 * inference and the sighting is marked accordingly. Only `auth_mode`, the
 * presence of `OPENAI_API_KEY`, and `tokens.account_id` are read — the token
 * bodies sitting beside them are never read, hashed, or logged.
 *
 * No file, no evidence, no sighting: absence is reported as nothing observed,
 * never as an "unknown" credential, which would claim we looked and found
 * something we could not classify.
 */
export async function codexCredentialSighting(
  home: string,
  sourceHostId: string,
  observedAt: string,
): Promise<CredentialSighting | null> {
  let parsed: unknown;
  try {
    const path = join(home, "auth.json");
    const stat = await fs.stat(path);
    if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) return null;
    parsed = JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
  const auth =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  const mode = auth && codexMode(auth);
  if (!auth || !mode) return null;
  const tokens =
    auth.tokens && typeof auth.tokens === "object" && !Array.isArray(auth.tokens)
      ? (auth.tokens as Record<string, unknown>)
      : null;
  return {
    usageSourceId: "codex-local",
    sourceHostId,
    mode,
    // The ACCOUNT id, never the key. In api-key mode Codex names no account and
    // the credential is distinguished by its mode alone.
    fingerprint: credentialFingerprint(tokens?.account_id),
    inferred: false,
    observedAt,
  };
}

function codexMode(auth: Record<string, unknown>): CredentialMode | null {
  const stated = typeof auth.auth_mode === "string" ? auth.auth_mode.trim().toLowerCase() : "";
  if (stated === "chatgpt") return "subscription";
  if (stated === "apikey") return "api-key";
  if (stated) return "unknown";
  // Older layouts state no mode and simply carry the key.
  return typeof auth.OPENAI_API_KEY === "string" && auth.OPENAI_API_KEY.trim() ? "api-key" : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/codex-credential.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/codex-credential.ts apps/server/test/codex-credential.test.ts
git commit -m "Observe Codex's stated credential

Codex names its own auth mode, so this is observed rather than inferred.
Only the mode and the account id are read; the tokens beside them are
never read, hashed or logged."
```

---

### Task 5: Claude credential collector

Claude states nothing, so this one **infers** — and says so.

**Files:**

- Modify: `apps/server/src/claude-quota.ts` (export `planLabel`)
- Create: `apps/server/src/claude-credential.ts`
- Test: `apps/server/test/claude-credential.test.ts`

**Interfaces:**

- Consumes: `credentialFingerprint` (Task 2); `planLabel` from `claude-quota.ts`.
- Produces: `claudeCredentialSighting(config: Record<string, unknown> | null, env: Record<string, string | undefined>, sourceHostId: string, observedAt: string): CredentialSighting | null`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/claude-credential.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { claudeCredentialSighting } from "../src/claude-credential.ts";

const OBSERVED = "2026-07-26T22:00:00.000Z";
const config = {
  oauthAccount: {
    emailAddress: "someone@example.com",
    accountUuid: "937ec57b-57ff-4293-abce-493df76661c8",
    organizationType: "claude_max",
    organizationRateLimitTier: "default_claude_max_20x",
  },
};

describe("claudeCredentialSighting", () => {
  it("reads a subscription from the cached account", () => {
    const sighting = claudeCredentialSighting(config, {}, "host:a", OBSERVED);
    assert.equal(sighting?.usageSourceId, "claude-code-local");
    assert.equal(sighting?.mode, "subscription");
    assert.equal(sighting?.plan, "claude_max_20x");
    assert.match(String(sighting?.fingerprint), /^[0-9a-f]{12}$/);
    // Nothing local states Claude's mode, so every reading here is deduced.
    assert.equal(sighting?.inferred, true);
  });

  it("prefers a gateway over an API key when both are set", () => {
    // A shell with CLAUDE_CODE_USE_BEDROCK reaches the model through Bedrock;
    // calling that a direct API key would name the wrong biller.
    const env = { CLAUDE_CODE_USE_BEDROCK: "1", ANTHROPIC_API_KEY: "sk-ant-value" };
    assert.equal(claudeCredentialSighting(config, env, "host:a", OBSERVED)?.mode, "bedrock");
    assert.equal(
      claudeCredentialSighting(config, { CLAUDE_CODE_USE_VERTEX: "true" }, "host:a", OBSERVED)
        ?.mode,
      "vertex",
    );
  });

  it("reads an API key from either environment variable", () => {
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
      const sighting = claudeCredentialSighting(
        config,
        { [key]: "sk-ant-value" },
        "host:a",
        OBSERVED,
      );
      assert.equal(sighting?.mode, "api-key", key);
      assert.ok(!JSON.stringify(sighting).includes("sk-ant-value"));
    }
  });

  it("still fingerprints the account in api-key mode", () => {
    // The account is what tells two credentials apart; the key is never touched.
    const withKey = claudeCredentialSighting(
      config,
      { ANTHROPIC_API_KEY: "k" },
      "host:a",
      OBSERVED,
    );
    const without = claudeCredentialSighting(config, {}, "host:a", OBSERVED);
    assert.equal(withKey?.fingerprint, without?.fingerprint);
  });

  it("treats a disabled gateway flag as unset", () => {
    for (const value of ["0", "false", "", "  "]) {
      assert.equal(
        claudeCredentialSighting(config, { CLAUDE_CODE_USE_BEDROCK: value }, "host:a", OBSERVED)
          ?.mode,
        "subscription",
        `should ignore ${JSON.stringify(value)}`,
      );
    }
  });

  it("reports an API key even with no cached account", () => {
    const sighting = claudeCredentialSighting(null, { ANTHROPIC_API_KEY: "k" }, "host:a", OBSERVED);
    assert.equal(sighting?.mode, "api-key");
    assert.equal(sighting?.fingerprint, "");
    assert.equal(sighting?.plan, undefined);
  });

  it("reports nothing when there is no evidence at all", () => {
    assert.equal(claudeCredentialSighting(null, {}, "host:a", OBSERVED), null);
    assert.equal(claudeCredentialSighting({}, {}, "host:a", OBSERVED), null);
  });

  it("stores no account identifier", () => {
    const serialized = JSON.stringify(claudeCredentialSighting(config, {}, "host:a", OBSERVED));
    assert.ok(!serialized.includes("someone@example.com"));
    assert.ok(!serialized.includes("937ec57b-57ff-4293-abce-493df76661c8"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/claude-credential.test.ts`
Expected: FAIL — `Cannot find module '../src/claude-credential.ts'`

- [ ] **Step 3: Export `planLabel` from the quota module**

In `apps/server/src/claude-quota.ts`, change `function planLabel(` to `export function planLabel(`. It is reused rather than reimplemented so the badge and the meter cannot end up naming the same plan differently.

- [ ] **Step 4: Write the implementation**

Create `apps/server/src/claude-credential.ts`:

```ts
import type { CredentialMode, CredentialSighting } from "@llm-usage-monitor/contracts";
import { planLabel } from "./claude-quota.ts";
import { credentialFingerprint } from "./credential-fingerprint.ts";

/**
 * Deduces the credential Claude Code is reaching Anthropic with.
 *
 * Nothing local STATES this. Claude Code's transcripts carry no auth field and
 * its session files carry none either, so the mode is assembled from the
 * environment this process can see plus the presence of a cached OAuth account.
 * Every sighting is therefore marked `inferred`, and there is a real hole behind
 * that flag: Claude Code launched from a shell carrying `ANTHROPIC_API_KEY` that
 * the Usage Monitor Server's own process cannot see reads as a subscription.
 * There is no local artefact that would reveal it. The flag is how the dashboard
 * declines to present this with the authority it gives Codex.
 *
 * `env` is a parameter rather than a read of `process.env` so the inference can
 * be tested without mutating the process.
 */
export function claudeCredentialSighting(
  config: Record<string, unknown> | null,
  env: Record<string, string | undefined>,
  sourceHostId: string,
  observedAt: string,
): CredentialSighting | null {
  const account = asRecord(config?.oauthAccount);
  const mode = claudeMode(account, env);
  if (!mode) return null;
  const plan = account ? planLabel(account) : undefined;
  return {
    usageSourceId: "claude-code-local",
    sourceHostId,
    mode,
    // Always the ACCOUNT, never the key — including in api-key mode, where the
    // account is what distinguishes two credentials and the key is untouched.
    fingerprint: credentialFingerprint(account?.accountUuid),
    ...(plan ? { plan } : {}),
    inferred: true,
    observedAt,
  };
}

/**
 * Gateways are tested before the API key because they are explicit routing
 * decisions: a shell setting `CLAUDE_CODE_USE_BEDROCK` alongside an Anthropic
 * key is reaching the model through Bedrock, and reporting that as a direct API
 * key would name the wrong biller.
 */
function claudeMode(
  account: Record<string, unknown> | null,
  env: Record<string, string | undefined>,
): CredentialMode | null {
  if (enabled(env.CLAUDE_CODE_USE_BEDROCK)) return "bedrock";
  if (enabled(env.CLAUDE_CODE_USE_VERTEX)) return "vertex";
  if (present(env.ANTHROPIC_API_KEY) || present(env.ANTHROPIC_AUTH_TOKEN)) return "api-key";
  if (account) return "subscription";
  // No account and no environment signal is nothing observed, not an unknown
  // credential — the same distinction the rest of the dashboard draws between
  // "did not say" and "said none".
  return null;
}

function enabled(value: string | undefined): boolean {
  const flag = (value ?? "").trim().toLowerCase();
  return flag !== "" && flag !== "0" && flag !== "false";
}
function present(value: string | undefined): boolean {
  return Boolean(value && value.trim());
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/claude-credential.test.ts apps/server/test/claude-quota.test.ts`
Expected: PASS. The quota tests are included because this task changed that file's exports.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add apps/server/src/claude-credential.ts apps/server/src/claude-quota.ts apps/server/test/claude-credential.test.ts
git commit -m "Infer Claude's credential and mark it as inferred

Nothing local states it, so the mode is assembled from the environment
this process can see plus a cached OAuth account. A shell that carries
ANTHROPIC_API_KEY where the server cannot see it still reads as a
subscription - the inferred flag is how the dashboard declines to claim
otherwise."
```

---

### Task 6: Observe credentials during import

The collectors exist but nothing calls them. This wires them into the one place that already guarantees an auxiliary write cannot fail an import.

**Files:**

- Modify: `apps/server/src/run-import.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/run-import.test.ts`

**Interfaces:**

- Consumes: `codexCredentialSighting` (Task 4), `claudeCredentialSighting` (Task 5), `UsageLedger.recordCredentialObservation` (Task 3).
- Produces: `runProviderImport(provider, ledger, sourceHostId, home, onAuxiliaryWriteFailed, observeCredential?)` — the fifth parameter is **renamed** from `onQuotaRejected`; the sixth is new and optional.

- [ ] **Step 1: Write the failing test**

In `apps/server/test/run-import.test.ts`, the existing `provider()` helper returns `{ records, quotaSnapshots, state }`. Add `stats: { home: "/fixture/home" }` to that returned object — `runProviderImport` now passes the resolved home to the credential collector, and both real providers already return it.

Then append:

```ts
describe("runProviderImport credential observation", () => {
  const sighting = {
    usageSourceId: "fake-local",
    sourceHostId: "host:a",
    mode: "subscription" as const,
    fingerprint: "9a1b2c3d4e5f",
    inferred: false,
    observedAt: "2026-07-26T22:00:00.000Z",
  };

  it("records the credential the collector observed", async () => {
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
      assert.equal(ledger.credentialObservations().length, 1);
      assert.equal(ledger.credentialObservations()[0]?.mode, "subscription");
    } finally {
      ledger.close();
    }
  });

  it("hands the collector the home the provider actually used", async () => {
    const ledger = new UsageLedger();
    const homes: Array<string | undefined> = [];
    try {
      await runProviderImport(
        provider([goodSnapshot]),
        ledger,
        "host:a",
        undefined,
        () => {},
        async (home) => {
          homes.push(home);
          return null;
        },
      );
      // Not re-derived from environment defaults: the same directory the
      // importer read, so a configured home cannot make the two disagree.
      assert.deepEqual(homes, ["/fixture/home"]);
    } finally {
      ledger.close();
    }
  });

  it("commits records even when the credential collector throws", async () => {
    const ledger = new UsageLedger();
    const failures: string[] = [];
    try {
      const committed = await runProviderImport(
        provider([goodSnapshot]),
        ledger,
        "host:a",
        undefined,
        (id) => failures.push(id),
        async () => {
          throw new Error("auth.json vanished mid-read");
        },
      );
      // Same invariant the quota write already has: an auxiliary reading must
      // never be able to discard a run's usage.
      assert.equal(committed, 1);
      assert.equal(ledger.records().length, 1);
      assert.deepEqual(failures, ["fake-local"]);
    } finally {
      ledger.close();
    }
  });

  it("records nothing when the collector observed nothing", async () => {
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
      assert.equal(ledger.credentialObservations().length, 0);
    } finally {
      ledger.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/run-import.test.ts`
Expected: FAIL — no observation is recorded (the sixth parameter is ignored).

- [ ] **Step 3: Extend the import runner**

In `apps/server/src/run-import.ts`:

Add `CredentialSighting` to the type imports. Add `stats` to `ProviderImportResult`:

```ts
export interface ProviderImportResult {
  records: UsageRecord[];
  quotaSnapshots: UsageQuotaSnapshot[];
  state: unknown;
  /** The provider's resolved home, so auxiliary collectors read the same one. */
  stats: { home: string };
}
```

Add the writer to `ImportLedger`:

```ts
  recordCredentialObservation(sighting: CredentialSighting): void;
```

Rename the callback and add the collector. The function becomes:

```ts
export async function runProviderImport(
  provider: ImportProvider,
  ledger: ImportLedger,
  sourceHostId: string,
  home: string | undefined,
  onAuxiliaryWriteFailed: (providerId: string, error: unknown) => void,
  observeCredential?: (
    home: string,
    observedAt: string,
  ) => Promise<CredentialSighting | null> | CredentialSighting | null,
): Promise<number> {
  const result = await provider.collect(sourceHostId, home, ledger.importState(provider.id));
  const committed = ledger.commitProviderImport(provider.id, result.records, result.state);
  try {
    ledger.replaceQuotaSnapshots(result.quotaSnapshots);
  } catch (error) {
    onAuxiliaryWriteFailed(provider.id, error);
  }
  if (observeCredential) {
    try {
      const sighting = await observeCredential(result.stats.home, new Date().toISOString());
      if (sighting) ledger.recordCredentialObservation(sighting);
    } catch (error) {
      // Same reasoning as the quota write above: the credential is a reading
      // about the machine, not the usage, and must not be able to discard a run.
      onAuxiliaryWriteFailed(provider.id, error);
    }
  }
  return committed;
}
```

Update the function's doc-comment's closing paragraph to say that **both** auxiliary writes — quota and credential — happen after the commit and cannot fail it.

- [ ] **Step 4: Wire the collectors in**

In `apps/server/src/server.ts`, add the imports:

```ts
import { claudeCredentialSighting } from "./claude-credential.ts";
import { readClaudeConfig } from "./claude-quota.ts";
import { codexCredentialSighting } from "./codex-credential.ts";
```

and replace the `runImport` definition and the two ports that use it:

```ts
  const runImport = (
    provider: CodexSessionProvider | ClaudeSessionProvider,
    home: string | undefined,
    observeCredential: (home: string, observedAt: string) => Promise<CredentialSighting | null>,
  ) =>
    runProviderImport(
      provider,
      ledger,
      local.host.id,
      home,
      (providerId, error) => {
        console.warn(`auxiliary write refused for ${providerId}:`, error);
      },
      observeCredential,
    );
  const actions = createDashboardActions({
    localSourceHostId: local.host.id,
    importCodex: (codexHome) =>
      runImport(importer, codexHome, (home, observedAt) =>
        codexCredentialSighting(home, local.host.id, observedAt),
      ),
    importClaude: (claudeHome) =>
      runImport(claudeImporter, claudeHome, async (home, observedAt) =>
        claudeCredentialSighting(
          await readClaudeConfig(home),
          process.env,
          local.host.id,
          observedAt,
        ),
      ),
```

Add `CredentialSighting` to the type imports from `@llm-usage-monitor/contracts` at the top of the file. Leave the remaining ports (`migrateLegacy`, `replacePrices`, `clearRecords`, `setHostGroup`) exactly as they are.

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/run-import.test.ts apps/server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
bun run typecheck
git add apps/server/src/run-import.ts apps/server/src/server.ts apps/server/test/run-import.test.ts
git commit -m "Observe each harness's credential during import

Wired into the one place that already guarantees an auxiliary write
cannot fail an import, and given the same home the importer resolved so
a configured directory cannot make the two disagree."
```

---

### Task 7: Attribution in analysis

**Files:**

- Modify: `packages/usage-analysis/src/index.ts`
- Modify: `packages/contracts/src/index.ts` (`OverviewView`)
- Test: `packages/usage-analysis/test/analysis.test.ts`

**Interfaces:**

- Consumes: `CredentialObservation`, `credentialIdFor`, `UNATTRIBUTED_CREDENTIAL` (Task 1).
- Produces:
  - `effectiveCredential(credentials, usageSourceId, sourceHostId, timestamp): CredentialObservation | undefined`
  - `AnalysisInput.credentials?: CredentialObservation[]`
  - `OverviewView.byCredential: RankedUsage[]`, `OverviewView.credentials: CredentialObservation[]`
  - `filterUsageRecords(records, filters, memberships, now?, credentials?)`

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`, adding `effectiveCredential` to the existing import from `../src/index.ts` and `CredentialObservation` to the contracts type import:

```ts
describe("effectiveCredential", () => {
  const observation = (
    mode: "subscription" | "api-key",
    effectiveFrom: string,
  ): CredentialObservation => ({
    usageSourceId: "codex-local",
    sourceHostId: "host:a",
    mode,
    fingerprint: mode === "subscription" ? "9a1b2c3d4e5f" : "",
    inferred: false,
    effectiveFrom,
    observedAt: effectiveFrom,
  });
  const history = [
    observation("subscription", "2026-07-10T00:00:00.000Z"),
    observation("api-key", "2026-07-20T00:00:00.000Z"),
  ];

  it("finds nothing before the first observation", () => {
    // Never backfilled: the first observation says nothing about the month
    // before it, and guessing would turn a thin signal into a confident lie.
    assert.equal(
      effectiveCredential(history, "codex-local", "host:a", "2026-07-01T00:00:00.000Z"),
      undefined,
    );
  });

  it("finds the credential in effect between two observations", () => {
    assert.equal(
      effectiveCredential(history, "codex-local", "host:a", "2026-07-15T00:00:00.000Z")?.mode,
      "subscription",
    );
  });

  it("finds the latest observation at or before the record", () => {
    assert.equal(
      effectiveCredential(history, "codex-local", "host:a", "2026-07-25T00:00:00.000Z")?.mode,
      "api-key",
    );
    assert.equal(
      effectiveCredential(history, "codex-local", "host:a", "2026-07-20T00:00:00.000Z")?.mode,
      "api-key",
    );
  });

  it("does not borrow another source's or another host's credential", () => {
    assert.equal(
      effectiveCredential(history, "claude-code-local", "host:a", "2026-07-25T00:00:00.000Z"),
      undefined,
    );
    assert.equal(
      effectiveCredential(history, "codex-local", "host:b", "2026-07-25T00:00:00.000Z"),
      undefined,
    );
  });
});

describe("credential attribution", () => {
  const record = (id: string, timestamp: string): UsageRecord => ({
    id,
    sourceHostId: "host:a",
    usageSourceId: "codex-local",
    harnessId: "codex",
    timestamp,
    taskName: "Task",
    provider: "openai",
    model: "gpt",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 5,
    totalTokens: 15,
    lastTokenUsage: null,
    source: "codex-local",
  });
  const credentials: CredentialObservation[] = [
    {
      usageSourceId: "codex-local",
      sourceHostId: "host:a",
      mode: "subscription",
      fingerprint: "9a1b2c3d4e5f",
      inferred: false,
      effectiveFrom: "2026-07-15T00:00:00.000Z",
      observedAt: "2026-07-15T00:00:00.000Z",
    },
  ];
  const analyze = (filters = {}) =>
    analyzeUsage({
      records: [
        record("old", "2026-07-01T00:00:00.000Z"),
        record("new", "2026-07-20T00:00:00.000Z"),
      ],
      prices: [],
      memberships: [],
      credentials,
      filters: { timeframe: "all", ...filters },
      now: new Date("2026-07-26T00:00:00.000Z"),
    });

  it("splits usage across the credential and the unattributed bucket", () => {
    assert.deepEqual(
      analyze()
        .byCredential.map((row) => [row.key, row.records])
        .sort(),
      [
        ["subscription:9a1b2c3d4e5f", 1],
        ["unattributed", 1],
      ].sort(),
    );
  });

  it("carries the observations so a view can label them", () => {
    assert.equal(analyze().credentials.length, 1);
  });

  it("filters to one credential", () => {
    const view = analyze({ credentialId: "subscription:9a1b2c3d4e5f" });
    assert.equal(view.totals.records, 1);
  });

  it("filters to the unattributed bucket", () => {
    // Reachable on purpose: on an existing ledger most history is unattributed,
    // and the reader needs to be able to see exactly which records those are.
    assert.equal(analyze({ credentialId: "unattributed" }).totals.records, 1);
  });

  it("attributes nothing when no observation exists", () => {
    const view = analyzeUsage({
      records: [record("new", "2026-07-20T00:00:00.000Z")],
      prices: [],
      memberships: [],
      filters: { timeframe: "all" },
      now: new Date("2026-07-26T00:00:00.000Z"),
    });
    assert.deepEqual(
      view.byCredential.map((row) => row.key),
      ["unattributed"],
    );
    assert.deepEqual(view.credentials, []);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: FAIL — `effectiveCredential is not a function`.

- [ ] **Step 3: Extend the OverviewView contract**

In `packages/contracts/src/index.ts`, add to `OverviewView` after `byHarness`:

```ts
  /**
   * Keyed by `credentialIdFor` output, plus the `UNATTRIBUTED_CREDENTIAL`
   * bucket for records older than the earliest observation for their source and
   * host. That bucket is never merged into a real credential — it is the guard
   * that keeps a thin signal from reading as a confident one.
   */
  byCredential: RankedUsage[];
  /**
   * The observations themselves, so a view can render a badge and label a filter
   * without a second request. Not filtered by `filters`, for the same reason
   * `quotaSnapshots` is not: which credential a machine uses is a standing fact,
   * not a property of the selected records.
   */
  credentials: CredentialObservation[];
```

- [ ] **Step 4: Write the analysis implementation**

In `packages/usage-analysis/src/index.ts`, add `CredentialObservation` to the type imports and `credentialIdFor`, `UNATTRIBUTED_CREDENTIAL` to the value imports from `@llm-usage-monitor/contracts`.

Add to `AnalysisInput`:

```ts
  /**
   * Optional so the analysis tests that predate credentials keep compiling.
   * Absent means nothing has been observed, and every record is unattributed —
   * which is the truthful reading, not a degraded one.
   */
  credentials?: CredentialObservation[];
```

In `analyzeUsage`, before the `return`:

```ts
const credentials = input.credentials ?? [];
```

Pass it to the filter and add the two view fields:

```ts
const selected = filterUsageRecords(
  input.records,
  input.filters,
  input.memberships,
  now,
  credentials,
);
```

```ts
    byCredential: rank(priced, ({ record }) => credentialKey(credentials, record)),
    credentials,
```

Extend `filterUsageRecords`'s signature and predicate:

```ts
export function filterUsageRecords(
  records: UsageRecord[],
  filters: UsageFilters,
  memberships: HostGroupMembership[],
  now = new Date(),
  credentials: CredentialObservation[] = [],
): UsageRecord[] {
```

```ts
      (!filters.credentialId || credentialKey(credentials, record) === filters.credentialId) &&
```

Add the two helpers beside `effectiveGroup`:

```ts
/**
 * The credential in effect for one (usage source, host) at one instant: the
 * observation with the greatest `effectiveFrom` at or before it.
 *
 * Unlike `effectiveGroup`, observations carry no `effectiveTo` — a credential
 * stays in effect until a different one is observed — so this scans for the
 * latest qualifying row rather than the first containing window.
 *
 * Nothing before the earliest observation qualifies. That is deliberate and is
 * the guard the whole feature rests on: the first observation says nothing about
 * the month before it, so those records stay unattributed rather than being
 * credited to a credential that may not have been in use.
 */
export function effectiveCredential(
  credentials: CredentialObservation[],
  usageSourceId: string,
  sourceHostId: string,
  timestamp: string,
): CredentialObservation | undefined {
  const at = Date.parse(timestamp);
  let latest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (credential.usageSourceId !== usageSourceId) continue;
    if (credential.sourceHostId !== sourceHostId) continue;
    const from = Date.parse(credential.effectiveFrom);
    if (Number.isNaN(from) || from > at) continue;
    if (!latest || from > Date.parse(latest.effectiveFrom)) latest = credential;
  }
  return latest;
}

function credentialKey(credentials: CredentialObservation[], record: UsageRecord): string {
  const credential = effectiveCredential(
    credentials,
    record.usageSourceId,
    record.sourceHostId,
    record.timestamp,
  );
  return credential ? credentialIdFor(credential) : UNATTRIBUTED_CREDENTIAL;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

Typecheck will fail until `analyzeUsage` populates both new required `OverviewView` fields — that is expected, and step 4 does it. Confirm it is clean before committing.

```bash
bun run typecheck
git add packages/usage-analysis/src/index.ts packages/usage-analysis/test/analysis.test.ts packages/contracts/src/index.ts
git commit -m "Attribute records to the credential in effect when they happened

Derived, never stamped, so a better observation tomorrow improves every
past answer. Records older than the earliest observation stay in a
distinguished unattributed bucket rather than being credited to a
credential that may not have been in use."
```

---

### Task 8: Serve the observations

**Files:**

- Modify: `apps/server/src/server.ts` (the `api/catalog` and `api/overview` handlers)
- Modify: `apps/web/src/api.ts` (`getCatalog` return type)
- Test: `apps/server/test/server.test.ts`

**Interfaces:**

- Consumes: `UsageLedger.credentialObservations()` (Task 3), `AnalysisInput.credentials` (Task 7).
- Produces: `/api/catalog` gains `credentials`; `/api/overview` attributes records.

- [ ] **Step 1: Write the failing test**

Append to `apps/server/test/server.test.ts`, following the boot-a-real-server pattern the file already uses:

```ts
it("serves credential observations in the catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-monitor-server-"));
  const web = join(root, "web");
  await mkdir(web);
  await writeFile(join(web, "index.html"), "<!doctype html><title>test</title>");
  const running = await startUsageMonitorServer({
    dataDirectory: join(root, "data"),
    webDirectory: web,
  });
  cleanup.push(async () => {
    await running.close();
    await rm(root, { recursive: true, force: true });
  });

  const catalog = (await fetch(new URL("api/catalog", running.discovery.dashboardUrl)).then(
    (response) => response.json(),
  )) as { credentials?: unknown[] };
  const overview = (await fetch(new URL("api/overview", running.discovery.dashboardUrl)).then(
    (response) => response.json(),
  )) as OverviewView;

  // Present and empty, not absent: a fresh ledger has observed nothing, and
  // the view must still be able to render the unattributed state.
  assert.ok(Array.isArray(catalog.credentials));
  assert.deepEqual(overview.credentials, []);
  assert.ok(Array.isArray(overview.byCredential));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/server.test.ts`
Expected: FAIL — `catalog.credentials` is `undefined`.

- [ ] **Step 3: Serve them**

In `apps/server/src/server.ts`, add to the `api/catalog` response object:

```ts
        credentials: ledger.credentialObservations(),
```

and to the `analyzeUsage` call in the `api/overview` handler:

```ts
          credentials: ledger.credentialObservations(),
```

In `apps/web/src/api.ts`, add `CredentialObservation` to the type imports and to `getCatalog`'s return type:

```ts
  credentials: CredentialObservation[];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --experimental-strip-types --test apps/server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add apps/server/src/server.ts apps/web/src/api.ts apps/server/test/server.test.ts
git commit -m "Serve credential observations to the dashboard"
```

---

### Task 9: Credential display model

Pure functions in `model/`, which is where this repo tests web logic — all 14 files in `apps/web/test/` do exactly this.

**Files:**

- Create: `apps/web/src/model/credential.ts`
- Test: `apps/web/test/credential.test.ts`

**Interfaces:**

- Consumes: `CredentialObservation`, `UNATTRIBUTED_CREDENTIAL` (Task 1).
- Produces:
  - `latestCredential(credentials, usageSourceId, sourceHostId): CredentialObservation | undefined`
  - `credentialModeKey(mode: string): string`
  - `countsAgainstPlan(mode: string): boolean`
  - `parseCredentialId(id: string): { unattributed: boolean; modeKey: string; fingerprint: string }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/credential.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CredentialObservation } from "@llm-usage-monitor/contracts";
import {
  countsAgainstPlan,
  credentialModeKey,
  latestCredential,
  parseCredentialId,
} from "../src/model/credential.ts";

const observation = (over: Partial<CredentialObservation> = {}): CredentialObservation => ({
  usageSourceId: "codex-local",
  sourceHostId: "host:a",
  mode: "subscription",
  fingerprint: "9a1b2c3d4e5f",
  inferred: false,
  effectiveFrom: "2026-07-10T00:00:00.000Z",
  observedAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

describe("latestCredential", () => {
  it("picks the most recent observation for the source and host", () => {
    const found = latestCredential(
      [observation(), observation({ mode: "api-key", effectiveFrom: "2026-07-20T00:00:00.000Z" })],
      "codex-local",
      "host:a",
    );
    assert.equal(found?.mode, "api-key");
  });

  it("does not borrow another source's or host's credential", () => {
    assert.equal(latestCredential([observation()], "claude-code-local", "host:a"), undefined);
    assert.equal(latestCredential([observation()], "codex-local", "host:b"), undefined);
  });

  it("reports nothing when none has been observed", () => {
    assert.equal(latestCredential([], "codex-local", "host:a"), undefined);
  });
});

describe("credentialModeKey", () => {
  it("maps each mode to a translation key segment", () => {
    assert.equal(credentialModeKey("subscription"), "subscription");
    // The mode id has a hyphen; the key must not, so it can be addressed by
    // dotted path in both locale files.
    assert.equal(credentialModeKey("api-key"), "apiKey");
    assert.equal(credentialModeKey("bedrock"), "bedrock");
    assert.equal(credentialModeKey("vertex"), "vertex");
  });

  it("falls back to the unknown key for anything unrecognised", () => {
    assert.equal(credentialModeKey("unknown"), "unknown");
    assert.equal(credentialModeKey("device-code"), "unknown");
  });
});

describe("countsAgainstPlan", () => {
  it("is true only for a subscription", () => {
    assert.equal(countsAgainstPlan("subscription"), true);
    // The distinction the whole feature exists to draw: usage on any of these
    // never touches the plan window shown above the badge.
    for (const mode of ["api-key", "bedrock", "vertex", "unknown"]) {
      assert.equal(countsAgainstPlan(mode), false, mode);
    }
  });
});

describe("parseCredentialId", () => {
  it("splits a bucket key into its mode and fingerprint", () => {
    assert.deepEqual(parseCredentialId("subscription:9a1b2c3d4e5f"), {
      unattributed: false,
      modeKey: "subscription",
      fingerprint: "9a1b2c3d4e5f",
    });
  });

  it("keeps an empty fingerprint empty", () => {
    assert.deepEqual(parseCredentialId("api-key:"), {
      unattributed: false,
      modeKey: "apiKey",
      fingerprint: "",
    });
  });

  it("recognises the unattributed bucket", () => {
    assert.equal(parseCredentialId("unattributed").unattributed, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/credential.test.ts`
Expected: FAIL — `Cannot find module '../src/model/credential.ts'`

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/model/credential.ts`:

```ts
import { UNATTRIBUTED_CREDENTIAL, type CredentialObservation } from "@llm-usage-monitor/contracts";

/**
 * Translation key segment per mode. The mode ids are contract values and one of
 * them contains a hyphen, which cannot be addressed by dotted i18n path, so the
 * view never interpolates a raw mode into a key.
 */
const MODE_KEYS: Record<string, string> = {
  subscription: "subscription",
  "api-key": "apiKey",
  bedrock: "bedrock",
  vertex: "vertex",
};

export function credentialModeKey(mode: string): string {
  return MODE_KEYS[mode] ?? "unknown";
}

/**
 * Whether usage on this credential consumes the plan window shown beside it.
 *
 * Only a subscription does. API-key, Bedrock and Vertex usage is billed
 * elsewhere entirely, which is why the panel says so instead of letting a
 * percentage sit next to spend it has nothing to do with.
 */
export function countsAgainstPlan(mode: string): boolean {
  return mode === "subscription";
}

/** The credential a source is on NOW, for the badge. */
export function latestCredential(
  credentials: CredentialObservation[],
  usageSourceId: string,
  sourceHostId: string,
): CredentialObservation | undefined {
  let latest: CredentialObservation | undefined;
  for (const credential of credentials) {
    if (credential.usageSourceId !== usageSourceId) continue;
    if (credential.sourceHostId !== sourceHostId) continue;
    if (!latest || credential.effectiveFrom > latest.effectiveFrom) latest = credential;
  }
  return latest;
}

/** Splits a `byCredential` row key back into the parts a label needs. */
export function parseCredentialId(id: string): {
  unattributed: boolean;
  modeKey: string;
  fingerprint: string;
} {
  if (id === UNATTRIBUTED_CREDENTIAL) {
    return { unattributed: true, modeKey: "unknown", fingerprint: "" };
  }
  const separator = id.lastIndexOf(":");
  const mode = separator === -1 ? id : id.slice(0, separator);
  return {
    unattributed: false,
    modeKey: credentialModeKey(mode),
    fingerprint: separator === -1 ? "" : id.slice(separator + 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/credential.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/model/credential.ts apps/web/test/credential.test.ts
git commit -m "Add the credential display model

Pure functions in model/, where this repo tests its web logic. Mode ids
are contract values and one carries a hyphen, so a translation key
segment is derived rather than interpolated."
```

---

### Task 10: Credential badge on the plan limits panel

**Files:**

- Modify: `apps/web/src/components/quota-meters.tsx`
- Modify: `apps/web/src/views/overview.tsx` (pass the new prop)
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/locales/es.json`

**Interfaces:**

- Consumes: `latestCredential`, `credentialModeKey`, `countsAgainstPlan` (Task 9); `OverviewView.credentials` (Task 7).
- Produces: `QuotaMeters` takes an additional `credentials: CredentialObservation[]` prop.

- [ ] **Step 1: Add the translation keys**

In `apps/web/src/i18n/locales/en.json`, add a new top-level `credential` object (alphabetically it sits after `common`):

```json
  "credential": {
    "mode": {
      "subscription": "Subscription",
      "apiKey": "API key",
      "bedrock": "Bedrock",
      "vertex": "Vertex",
      "unknown": "Unrecognised credential"
    },
    "inferred": "inferred",
    "notCounted": "This usage is billed separately and does not count against the window above.",
    "unattributed": "Not attributed"
  },
```

In `apps/web/src/i18n/locales/es.json`:

```json
  "credential": {
    "mode": {
      "subscription": "Suscripción",
      "apiKey": "Clave de API",
      "bedrock": "Bedrock",
      "vertex": "Vertex",
      "unknown": "Credencial no reconocida"
    },
    "inferred": "inferido",
    "notCounted": "Este uso se factura aparte y no cuenta para la ventana anterior.",
    "unattributed": "Sin atribuir"
  },
```

- [ ] **Step 2: Render the badge**

In `apps/web/src/components/quota-meters.tsx`, add to the imports:

```tsx
import type { CredentialObservation, UsageQuotaSnapshot } from "@llm-usage-monitor/contracts";
import { countsAgainstPlan, credentialModeKey, latestCredential } from "../model/credential.ts";
```

Add `credentials` to the props:

```tsx
export function QuotaMeters({
  snapshots,
  harnessLabel,
  credentials,
}: {
  snapshots: UsageQuotaSnapshot[];
  harnessLabel: (usageSourceId: string) => string;
  credentials: CredentialObservation[];
}) {
```

Inside the `map` callback, beside the existing `observedAt` line:

```tsx
const credential = latestCredential(credentials, snapshot.usageSourceId, snapshot.sourceHostId);
```

And immediately after the closing `</p>` of `quota-source`, before `snapshot.windows.map`:

```tsx
{
  credential && (
    <p className="quota-credential">
      <span className={countsAgainstPlan(credential.mode) ? "" : "off-plan"}>
        {t(`credential.mode.${credentialModeKey(credential.mode)}`)}
      </span>
      {/*
                  Codex states its mode; Claude's is deduced from an environment
                  this process may not fully see. Marking the difference is the
                  same instinct as reporting unreported rather than zero.
                */}
      {credential.inferred && <em>{t("credential.inferred")}</em>}
    </p>
  );
}
{
  credential && !countsAgainstPlan(credential.mode) && (
    // The reason this feature exists: without it a percentage sits
    // beside spend that never touched the window it describes.
    <p className="quota-note">{t("credential.notCounted")}</p>
  );
}
```

- [ ] **Step 3: Pass the observations in**

In `apps/web/src/views/overview.tsx`, the `QuotaMeters` element currently reads:

```tsx
<QuotaMeters snapshots={data.quotaSnapshots} harnessLabel={usageSourceLabel} />
```

Change it to:

```tsx
<QuotaMeters
  snapshots={data.quotaSnapshots}
  harnessLabel={usageSourceLabel}
  credentials={data.credentials}
/>
```

- [ ] **Step 4: Style it**

Append to `apps/web/src/styles.css`, after the `.quota-reset` rule:

```css
.quota-credential {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin: 0 0 7px;
  font-size: var(--size-meta);
}
.quota-credential .off-plan {
  color: var(--status-warning);
}
.quota-credential em {
  color: var(--muted);
  font-style: normal;
  font-size: 0.92em;
}
.quota-note {
  margin: 0 0 9px;
  color: var(--muted);
  font-size: var(--size-meta);
}
```

- [ ] **Step 5: Verify**

Run: `bun run typecheck && bun run lint && bun run build:web && bun run test`
Expected: all pass. Report the real output of `bun run typecheck`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/quota-meters.tsx apps/web/src/views/overview.tsx apps/web/src/styles.css apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/es.json
git commit -m "Badge each quota group with the credential in use

An API key, Bedrock or Vertex credential is called out explicitly,
because its usage never touched the window shown above it."
```

---

### Task 11: Credential breakdown row and filter chip

**Files:**

- Modify: `apps/web/src/views/breakdown.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`, `apps/web/src/i18n/locales/es.json`

**Interfaces:**

- Consumes: `parseCredentialId` (Task 9); `OverviewView.byCredential` / `.credentials` (Task 7); `UsageFilters.credentialId` (Task 1).
- Produces: `BreakdownDimension` gains `"byCredential"`.

- [ ] **Step 1: Add the translation keys**

In `apps/web/src/i18n/locales/en.json`, add `"byCredential": "Credential"` to the existing `breakdown` object, and to `filters` add:

```json
    "credential": "Credential",
    "allCredentials": "All credentials"
```

In `es.json`, add `"byCredential": "Credencial"` to `breakdown`, and to `filters`:

```json
    "credential": "Credencial",
    "allCredentials": "Todas las credenciales"
```

- [ ] **Step 2: Add the breakdown dimension**

In `apps/web/src/views/breakdown.tsx`, add `"byCredential"` to the `BreakdownDimension` union and to the `DIMENSIONS` array (after `"byHarness"`). Add the import:

```tsx
import { parseCredentialId } from "../model/credential.ts";
```

Extend the `rows` expression — it currently relabels `byHarness` and `bySourceHost`. Add a branch before the final fallback:

```tsx
      : dimension === "byCredential"
        ? data.byCredential.map((row) => {
            const parsed = parseCredentialId(row.key);
            return {
              ...row,
              // The fingerprint is what tells two accounts on the same mode
              // apart, so it is shown rather than hidden. It identifies nothing
              // on its own — it is a one-way digest.
              key: parsed.unattributed
                ? t("credential.unattributed")
                : `${t(`credential.mode.${parsed.modeKey}`)}${parsed.fingerprint ? ` · ${parsed.fingerprint}` : ""}`,
            };
          })
        : data[dimension];
```

- [ ] **Step 3: Add the filter chip**

In `apps/web/src/app.tsx`, add the import:

```tsx
import { parseCredentialId } from "./model/credential.ts";
```

and insert a `SelectChip` after the host chip, before the `SearchChip`:

```tsx
<SelectChip
  label={t("filters.credential")}
  value={filters.credentialId ?? ""}
  options={[
    { value: "", label: t("filters.allCredentials") },
    ...(overview?.byCredential ?? []).map((row) => {
      const parsed = parseCredentialId(row.key);
      return {
        value: row.key,
        label: parsed.unattributed
          ? t("credential.unattributed")
          : `${t(`credential.mode.${parsed.modeKey}`)}${parsed.fingerprint ? ` · ${parsed.fingerprint}` : ""}`,
      };
    }),
  ]}
  onChange={(value) => change("credentialId", value)}
/>
```

The options come from `byCredential` rather than from `credentials` so the unattributed bucket appears in the list — it has no observation behind it, and on an existing ledger it is the largest group.

`overview` is the `OverviewView | null` state declared at `apps/web/src/app.tsx:38`, in scope where the chips are rendered. It is nullable during the first load, hence the `?.` and the `?? []`.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bun run lint && bun run build:web && bun run test`
Expected: all pass. Report the real output of `bun run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/views/breakdown.tsx apps/web/src/app.tsx apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/es.json
git commit -m "Group and filter usage by credential

Options come from byCredential rather than the observations so the
unattributed bucket appears - on an existing ledger it is the largest
group and the reader needs to be able to select it."
```

---

### Task 12: Documentation

**Files:**

- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the domain vocabulary**

In `CONTEXT.md`, after the **Host Group** entry, add:

```markdown
**Credential**:
The means by which a Harness reaches a model provider: a subscription account,
an API key, or a cloud gateway. Identified by a non-reversible fingerprint of an
account identifier; the underlying secret is never read or stored.
_Avoid_: token, key, auth, login

**Credential Observation**:
A discovered, effective-dated fact that one Usage Source on one Source Host was
reaching its provider by a given Credential. Unlike Host Group membership it is
observed rather than declared, and it is never backdated.
_Avoid_: session auth, credential history, login event
```

- [ ] **Step 2: Add the README capability**

After the plan-limits bullet added by the previous plan, add:

```markdown
- Attributes usage to the Credential in effect when it happened — a subscription, an API key, or a cloud gateway — and groups and filters by it. Attribution begins at the first observation and is never backdated, so usage from before the monitor started watching reads as unattributed rather than being credited to a credential that may not have been in use. Codex states its credential outright; Claude Code's is inferred from the environment and is labelled as inferred.
```

The existing "never imports ... credentials" bullet stays exactly as it is and remains true: only account identifiers are read, and only as one-way fingerprints.

- [ ] **Step 3: Add the changelog entry**

In `CHANGELOG.md`, add to the existing `## Unreleased` section:

```markdown
- Usage is attributed to the Credential that paid for it — a subscription, an API key, or a cloud gateway — with a badge on each plan-limit meter, a Credential breakdown, and a Credential filter. API-key, Bedrock and Vertex usage is called out where it appears beside a plan window, because it never consumed that window.
- Attribution starts from the first time a credential was observed and is never backdated. Usage from before then reads as unattributed, which on an existing ledger is most of it at first; the proportion falls as new usage accumulates.
```

- [ ] **Step 4: Run the full verification**

Run: `bun run check`
Expected: format:check, lint, typecheck, test, and build all pass. If `format:check` objects, run `bun run format` and commit everything it changed.

- [ ] **Step 5: Commit**

```bash
git add CONTEXT.md README.md CHANGELOG.md
git commit -m "Document credential attribution"
```

---

## Completion gate

- `bun run check` passes.
- The Plan limits panel shows a credential badge per quota group, with Codex unmarked and Claude Code marked inferred.
- Breakdown offers a Credential grouping whose rows include an unattributed bucket.
- The topbar credential filter narrows the totals, including to the unattributed bucket.
- No persisted payload contains an email address, an account UUID, or any token.
- Running an import twice in a row adds exactly one credential observation per source, not two.

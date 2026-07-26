# Host Group Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a Settings screen that creates, renames, populates and retires Host Groups, and make a group's name — not its raw id — the label everywhere it appears.

**Architecture:** Host Groups are already stored, resolved and filtered; only the write path from the UI and the read path for names are missing. This plan adds `UsageLedger.hostGroups()`, fixes `setHostGroup` to keep one group per host, carries groups through `/api/catalog` into `analyzeUsage` so `byHostGroup` keys by name, and adds a tabbed Settings shell containing a new editor. Derivation logic lives in a pure `model/host-groups.ts` so it is testable without rendering components.

**Tech Stack:** TypeScript, React 19, node:sqlite via `UsageLedger`, Zod 4 contracts, `node --test` with `--experimental-strip-types`, oxlint/oxfmt, Vite.

**Spec:** `docs/superpowers/specs/2026-07-26-host-group-configuration-design.md`

## Global Constraints

- **`effectiveAt` is always `new Date().toISOString()`.** No UI control ever sets it to anything else. Backdating is out of scope.
- **Removal means retirement**, never deletion: `setHostGroup(id, name, [], now)`. No `DELETE FROM host_groups` anywhere in this plan.
- **A Source Host belongs to at most one Host Group at any instant.**
- **Never render a raw `group:<uuid>`** to the user when a name is available.
- **Never label a host with `host.hostname` directly** — always `sourceHostLabel(host, index)` from `apps/web/src/model/source-host.ts`. Some machines report a MAC address as their hostname.
- **The editor's hint text is fixed and required:** "Grouping applies to usage recorded from now on. Earlier usage keeps the grouping that applied when it happened." Without it the feature looks broken on first use.
- Run a single test file with `node --experimental-strip-types --test <path>`. Run everything with `bun run test`. Full gate is `bun run check` (format, lint, typecheck, test, build).
- Formatting is enforced. Run `bun run format` before each commit.
- End every commit message with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`, matching the spec commit `55fd91e`. The commit commands below omit it for brevity; add it.

---

### Task 1: Ledger reads Host Group names

`host_groups.name` is written by `setHostGroup` and never read by anything. This adds the reader that makes the `HostGroup` contract interface real.

**Files:**
- Modify: `packages/usage-ledger/src/index.ts` (import list at line 1-8; add method after `memberships()` which ends at line 216)
- Test: `packages/usage-ledger/test/ledger.test.ts` (add inside the existing `describe("Usage Ledger", ...)` block, after the test ending at line 76)

**Interfaces:**
- Consumes: `HostGroup` from `@llm-usage-monitor/contracts` — `{ id: string; name: string }`, already declared at `packages/contracts/src/index.ts:153-156`.
- Produces: `UsageLedger.hostGroups(): HostGroup[]`, ordered by name ascending. Used by Tasks 4.

- [ ] **Step 1: Write the failing test**

Add to `packages/usage-ledger/test/ledger.test.ts`, inside `describe("Usage Ledger", ...)`:

```ts
  it("reads back Host Group names, ordered by name", () => {
    const ledger = create();
    ledger.setHostGroup("group:two", "Workstations", [], "2026-07-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Laptops", [], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.hostGroups(), [
      { id: "group:one", name: "Laptops" },
      { id: "group:two", name: "Workstations" },
    ]);
  });

  it("renaming a group keeps its id and its memberships", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-23T12:00:00.000Z",
      },
      [],
    );
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-01-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Portables", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.hostGroups(), [{ id: "group:one", name: "Portables" }]);
    assert.equal(
      ledger.memberships().filter((membership) => membership.effectiveTo === null).length,
      1,
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: FAIL — `ledger.hostGroups is not a function`.

- [ ] **Step 3: Write the implementation**

In `packages/usage-ledger/src/index.ts`, add `HostGroup` to the existing type import from `@llm-usage-monitor/contracts` (it already imports `HostGroupMembership`, so add `HostGroup` alphabetically before it).

Then add this method immediately after `memberships()`:

```ts
  hostGroups(): HostGroup[] {
    return this.database
      .prepare("SELECT id, name FROM host_groups ORDER BY name")
      .all()
      .map((row) => ({ id: String(row.id), name: String(row.name) }));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: PASS, all tests in the file green.

- [ ] **Step 5: Commit**

```bash
bun run format
git add packages/usage-ledger/src/index.ts packages/usage-ledger/test/ledger.test.ts
git commit -m "Read Host Group names from the ledger

host_groups.name was written by setHostGroup and never read, so the
HostGroup contract interface had no implementation behind it."
```

---

### Task 2: One Host Group per Source Host

`setHostGroup` closes open memberships for the target group id only, so moving a host from group A to group B leaves two open rows. `effectiveGroup` resolves with `.find()` over rows ordered by `effective_from`, so the host silently keeps reporting group A.

**Files:**
- Modify: `packages/usage-ledger/src/index.ts:187-204` (`setHostGroup`)
- Test: `packages/usage-ledger/test/ledger.test.ts` (add inside `describe("Usage Ledger", ...)`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `setHostGroup(id, name, sourceHostIds, effectiveAt)` now guarantees at most one open membership per `sourceHostId` across all groups. Tasks 5-8 depend on this invariant.

- [ ] **Step 1: Write the failing test**

Add to `packages/usage-ledger/test/ledger.test.ts`, inside `describe("Usage Ledger", ...)`:

```ts
  it("moving a host into another group closes its previous membership", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-23T12:00:00.000Z",
      },
      [],
    );
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-01-01T00:00:00.000Z");
    ledger.setHostGroup("group:two", "Workstations", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.memberships(), [
      {
        hostGroupId: "group:one",
        sourceHostId: "host:a",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
        effectiveTo: "2026-07-01T00:00:00.000Z",
      },
      {
        hostGroupId: "group:two",
        sourceHostId: "host:a",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ]);
  });

  // Two saves landing in the same millisecond collide on the membership primary
  // key (group, host, effective_from). The close-then-insert would otherwise
  // leave the row closed and silently drop the membership the user just saved.
  it("re-saving an unchanged group at the same instant keeps the membership open", () => {
    const ledger = create();
    ledger.upsertSourceHost(
      {
        id: "host:a",
        hostname: "workstation",
        platform: "win32",
        architecture: "x64",
        firstSeenAt: "2026-01-01T00:00:00.000Z",
        lastSeenAt: "2026-07-23T12:00:00.000Z",
      },
      [],
    );
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-07-01T00:00:00.000Z");
    ledger.setHostGroup("group:one", "Laptops", ["host:a"], "2026-07-01T00:00:00.000Z");
    assert.deepEqual(ledger.memberships(), [
      {
        hostGroupId: "group:one",
        sourceHostId: "host:a",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
        effectiveTo: null,
      },
    ]);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: FAIL twice — the first because `group:one`'s membership is still open (`effectiveTo: null` where the test wants a closing timestamp), the second with a SQLite `UNIQUE constraint failed` error on the membership primary key.

- [ ] **Step 3: Write the implementation**

Replace the body of `setHostGroup` in `packages/usage-ledger/src/index.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-ledger/test/ledger.test.ts`
Expected: PASS. The pre-existing `retains effective-dated Host Group memberships` test must still pass — it covers retirement, which this change must not alter.

- [ ] **Step 5: Commit**

```bash
bun run format
git add packages/usage-ledger/src/index.ts packages/usage-ledger/test/ledger.test.ts
git commit -m "Keep one Host Group per Source Host

setHostGroup closed memberships for the target group only, so moving a
host between groups left two open rows and effectiveGroup's .find()
resolved to whichever was created first."
```

---

### Task 3: Label host-group rows by name

`byHostGroup` currently keys rows on the raw group id. This mirrors what `bySourceHost` already does with `hostNames`.

**Files:**
- Modify: `packages/usage-analysis/src/index.ts` (import list line 1-13; `AnalysisInput` line 15-29; `groupFor` line 41-42)
- Test: `packages/usage-analysis/test/analysis.test.ts` (append a new `describe` block at end of file)

**Interfaces:**
- Consumes: `UsageLedger.hostGroups()` from Task 1 (via the server, Task 4).
- Produces: `AnalysisInput.hostGroups?: HostGroup[]` — **optional**. It must be optional because sixteen existing call sites in `analysis.test.ts` construct `AnalysisInput` without it; making it required would force churn across tests unrelated to this feature. `quotaSnapshots?` sets the precedent.

- [ ] **Step 1: Write the failing test**

Append to `packages/usage-analysis/test/analysis.test.ts`:

```ts
describe("Host Group labelling", () => {
  const membership = (hostGroupId: string) => ({
    hostGroupId,
    sourceHostId: "host:a",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
  });
  const view = (
    hostGroups: Array<{ id: string; name: string }>,
    memberships: Array<ReturnType<typeof membership>>,
  ) =>
    analyzeUsage({
      records: [record("2026-07-20T09:00:00.000Z")],
      prices: [],
      sourceHosts: [],
      hostGroups,
      memberships,
      filters: { timeframe: "all" },
    });

  it("keys rows by the group's name", () => {
    assert.deepEqual(
      view([{ id: "group:one", name: "Laptops" }], [membership("group:one")]).byHostGroup.map(
        (row) => row.key,
      ),
      ["Laptops"],
    );
  });

  // A membership can outlive knowledge of its group only if the two reads
  // disagree. Dropping the row would hide real spend, so the id is shown.
  it("falls back to the group id when no group row matches", () => {
    assert.deepEqual(
      view([], [membership("group:one")]).byHostGroup.map((row) => row.key),
      ["group:one"],
    );
  });

  it("keeps Ungrouped for a host with no effective membership", () => {
    assert.deepEqual(
      view([{ id: "group:one", name: "Laptops" }], []).byHostGroup.map((row) => row.key),
      ["Ungrouped"],
    );
  });

  it("still resolves when hostGroups is omitted entirely", () => {
    assert.deepEqual(
      analyzeUsage({
        records: [record("2026-07-20T09:00:00.000Z")],
        prices: [],
        sourceHosts: [],
        memberships: [membership("group:one")],
        filters: { timeframe: "all" },
      }).byHostGroup.map((row) => row.key),
      ["group:one"],
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: FAIL — `keys rows by the group's name` gets `["group:one"]` instead of `["Laptops"]`. TypeScript will also reject the unknown `hostGroups` property; that is expected at this step.

- [ ] **Step 3: Write the implementation**

In `packages/usage-analysis/src/index.ts`, add `HostGroup` to the type import list (alphabetically, before `HostGroupMembership`).

Add to `AnalysisInput`, directly after the `sourceHosts` line:

```ts
  /**
   * Optional so the many analysis tests that predate named groups keep
   * compiling. Absent means no group has a known name, and rows fall back to
   * the raw group id rather than disappearing.
   */
  hostGroups?: HostGroup[];
```

Replace the `groupFor` definition (currently lines 41-42):

```ts
  const groupNames = new Map((input.hostGroups ?? []).map((group) => [group.id, group.name]));
  const groupFor = (record: UsageRecord) => {
    const groupId = effectiveGroup(input.memberships, record.sourceHostId, record.timestamp);
    return groupId === null ? "Ungrouped" : (groupNames.get(groupId) ?? groupId);
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --experimental-strip-types --test packages/usage-analysis/test/analysis.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
bun run format
git add packages/usage-analysis/src/index.ts packages/usage-analysis/test/analysis.test.ts
git commit -m "Label byHostGroup rows by group name

Mirrors bySourceHost, which already keys rows by resolved label. An
unknown group id is shown rather than dropped."
```

---

### Task 4: Serve Host Groups from the catalog

**Files:**
- Modify: `apps/server/src/server.ts:91-105` (`api/overview`) and `apps/server/src/server.ts:116-121` (`api/catalog`)
- Test: `apps/server/test/server.test.ts` (append a new `it` inside the existing `describe("Usage Monitor Server", ...)`)

**Interfaces:**
- Consumes: `UsageLedger.hostGroups()` (Task 1), `AnalysisInput.hostGroups` (Task 3).
- Produces: `GET /api/catalog` returns `{ prices, sourceHosts, hostGroups, memberships }`. `GET /api/overview` returns `byHostGroup` rows keyed by name. Task 6 consumes the catalog shape.

- [ ] **Step 1: Write the failing test**

Append inside `describe("Usage Monitor Server", ...)` in `apps/server/test/server.test.ts`:

```ts
  it("serves Host Groups in the catalog and names them in the overview", async () => {
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
    const [localHost] = running.ledger.sourceHosts();
    assert.ok(localHost, "the server registers its local Source Host on start");
    running.ledger.upsertRecords([
      {
        id: "record:1",
        sourceHostId: localHost.id,
        usageSourceId: "codex-local",
        harnessId: "codex",
        timestamp: "2026-07-20T09:00:00.000Z",
        taskName: "Task",
        provider: "openai",
        model: "gpt-test",
        modeFlags: { ultra: false, fast: false },
        inputTokens: 10,
        outputTokens: 2,
        totalTokens: 12,
        lastTokenUsage: null,
        source: "codex-local",
      },
    ]);
    running.ledger.setHostGroup(
      "group:one",
      "Laptops",
      [localHost.id],
      "2026-01-01T00:00:00.000Z",
    );

    const catalog = (await fetch(`${running.discovery.dashboardUrl}api/catalog`).then((response) =>
      response.json(),
    )) as { hostGroups?: Array<{ id: string; name: string }> };
    assert.deepEqual(catalog.hostGroups, [{ id: "group:one", name: "Laptops" }]);

    const overview = (await fetch(
      `${running.discovery.dashboardUrl}api/overview?timeframe=all`,
    ).then((response) => response.json())) as OverviewView;
    assert.deepEqual(
      overview.byHostGroup.map((row) => row.key),
      ["Laptops"],
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/server/test/server.test.ts`
Expected: FAIL — `catalog.hostGroups` is `undefined`, and `byHostGroup` reads `["group:one"]`.

- [ ] **Step 3: Write the implementation**

In `apps/server/src/server.ts`, inside the `api/overview` handler, add `hostGroups` to the `analyzeUsage` argument, directly after the `sourceHosts` line:

```ts
          hostGroups: ledger.hostGroups(),
```

In the `api/catalog` handler, add the same key after `sourceHosts`:

```ts
        hostGroups: ledger.hostGroups(),
```

The catalog handler becomes:

```ts
    if (request.method === "GET" && resource === "api/catalog")
      return sendJson(response, 200, {
        prices: ledger.prices(),
        sourceHosts: ledger.sourceHosts(),
        hostGroups: ledger.hostGroups(),
        memberships: ledger.memberships(),
      });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/server/test/server.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
bun run format
git add apps/server/src/server.ts apps/server/test/server.test.ts
git commit -m "Serve Host Groups from the catalog and overview"
```

---

### Task 5: Pure Host Group derivation for the web app

Everything the editor needs to compute, computed outside React so it can be tested the way `model/source-host.ts` and `model/harness.ts` are.

**Files:**
- Create: `apps/web/src/model/host-groups.ts`
- Test: `apps/web/test/host-groups.test.ts`

**Interfaces:**
- Consumes: `HostGroup`, `HostGroupMembership`, `SourceHost` from `@llm-usage-monitor/contracts`.
- Produces — Tasks 6, 7 and 8 import exactly these:
  - `interface HostGroupRow { id: string; name: string; memberHostIds: string[] }`
  - `hostGroupRows(hostGroups: HostGroup[], memberships: HostGroupMembership[]): HostGroupRow[]`
  - `currentGroupIdFor(sourceHostId: string, memberships: HostGroupMembership[]): string | null`
  - `ungroupedHostIds(sourceHosts: SourceHost[], memberships: HostGroupMembership[]): string[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/host-groups.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import {
  currentGroupIdFor,
  hostGroupRows,
  ungroupedHostIds,
} from "../src/model/host-groups.ts";

const host = (id: string): SourceHost => ({
  id,
  hostname: id,
  platform: "win32",
  architecture: "x64",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-07-20T09:00:00.000Z",
});
const open = (hostGroupId: string, sourceHostId: string): HostGroupMembership => ({
  hostGroupId,
  sourceHostId,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: null,
});
const retired = (hostGroupId: string, sourceHostId: string): HostGroupMembership => ({
  hostGroupId,
  sourceHostId,
  effectiveFrom: "2026-01-01T00:00:00.000Z",
  effectiveTo: "2026-06-01T00:00:00.000Z",
});
const groups = [
  { id: "group:one", name: "Laptops" },
  { id: "group:two", name: "Workstations" },
];

describe("Host Group rows", () => {
  it("lists only currently open memberships", () => {
    assert.deepEqual(
      hostGroupRows(groups, [open("group:one", "host:a"), retired("group:one", "host:b")]),
      [
        { id: "group:one", name: "Laptops", memberHostIds: ["host:a"] },
        { id: "group:two", name: "Workstations", memberHostIds: [] },
      ],
    );
  });

  // A group whose members have all been retired still exists and must remain
  // editable, otherwise retiring a group would delete it from the UI.
  it("keeps a group with no current members", () => {
    assert.deepEqual(hostGroupRows(groups, [retired("group:one", "host:a")]), [
      { id: "group:one", name: "Laptops", memberHostIds: [] },
      { id: "group:two", name: "Workstations", memberHostIds: [] },
    ]);
  });
});

describe("Current group for a host", () => {
  it("finds the open membership", () => {
    assert.equal(currentGroupIdFor("host:a", [open("group:two", "host:a")]), "group:two");
  });

  it("is null once the membership is retired", () => {
    assert.equal(currentGroupIdFor("host:a", [retired("group:two", "host:a")]), null);
  });

  it("is null for a host that was never grouped", () => {
    assert.equal(currentGroupIdFor("host:z", [open("group:two", "host:a")]), null);
  });
});

describe("Ungrouped hosts", () => {
  it("excludes hosts with an open membership", () => {
    assert.deepEqual(
      ungroupedHostIds([host("host:a"), host("host:b")], [open("group:one", "host:a")]),
      ["host:b"],
    );
  });

  it("re-includes a host whose membership was retired", () => {
    assert.deepEqual(
      ungroupedHostIds([host("host:a")], [retired("group:one", "host:a")]),
      ["host:a"],
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test apps/web/test/host-groups.test.ts`
Expected: FAIL — cannot resolve `../src/model/host-groups.ts`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/model/host-groups.ts`:

```ts
import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";

/**
 * A Host Group as the editor manipulates it: the group plus the hosts that
 * belong to it *right now*. Membership is effective-dated in the ledger, but
 * the editor only ever writes "as of now", so it only ever reads the open rows.
 */
export interface HostGroupRow {
  id: string;
  name: string;
  memberHostIds: string[];
}

const isOpen = (membership: HostGroupMembership) => membership.effectiveTo === null;

export function hostGroupRows(
  hostGroups: HostGroup[],
  memberships: HostGroupMembership[],
): HostGroupRow[] {
  return hostGroups.map((group) => ({
    id: group.id,
    name: group.name,
    memberHostIds: memberships
      .filter((membership) => isOpen(membership) && membership.hostGroupId === group.id)
      .map((membership) => membership.sourceHostId),
  }));
}

export function currentGroupIdFor(
  sourceHostId: string,
  memberships: HostGroupMembership[],
): string | null {
  return (
    memberships.find(
      (membership) => isOpen(membership) && membership.sourceHostId === sourceHostId,
    )?.hostGroupId ?? null
  );
}

export function ungroupedHostIds(
  sourceHosts: SourceHost[],
  memberships: HostGroupMembership[],
): string[] {
  return sourceHosts
    .filter((host) => currentGroupIdFor(host.id, memberships) === null)
    .map((host) => host.id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --experimental-strip-types --test apps/web/test/host-groups.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
bun run format
git add apps/web/src/model/host-groups.ts apps/web/test/host-groups.test.ts
git commit -m "Add pure Host Group derivation for the dashboard"
```

---

### Task 6: Tabbed Settings shell showing Host Groups read-only

Settings is currently a full-screen swap rendering only `Pricing`. This adds the tab strip and threads the catalog's new fields through, with the Host groups tab rendering a read-only list. Editing arrives in Task 7 — this task is reviewable on its own because a user can already *see* their groups and their members.

**Files:**
- Modify: `apps/web/src/api.ts:22-24` (`getCatalog` return type)
- Create: `apps/web/src/views/settings/index.tsx`
- Create: `apps/web/src/views/settings/host-groups.tsx`
- Modify: `apps/web/src/app.tsx` (imports line 1-16; state near line 47; `refresh` near line 78-79; `ViewSlot` props and body)
- Modify: `apps/web/src/styles.css` (append at end)

**Interfaces:**
- Consumes: `hostGroupRows`, `ungroupedHostIds`, `currentGroupIdFor` from Task 5; `sourceHostLabel` from `apps/web/src/model/source-host.ts`; the catalog shape from Task 4.
- Produces:
  - `Settings({ prices, hostGroups, memberships, sourceHosts, onSaved })` from `views/settings/index.tsx`.
  - `HostGroups({ hostGroups, memberships, sourceHosts, onSaved })` from `views/settings/host-groups.tsx`. Tasks 7 and 8 extend this component in place; its prop list does not change.

- [ ] **Step 1: Type the catalog response**

In `apps/web/src/api.ts`, add `HostGroup` and `HostGroupMembership` to the existing type import, and replace `getCatalog`:

```ts
export async function getCatalog(): Promise<{
  prices: ModelPrice[];
  sourceHosts: SourceHost[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
}> {
  return requestJson("./api/catalog");
}
```

- [ ] **Step 2: Write the read-only Host Groups view**

Create `apps/web/src/views/settings/host-groups.tsx`:

```tsx
import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import { hostGroupRows, ungroupedHostIds } from "../../model/host-groups.ts";
import { sourceHostLabel } from "../../model/source-host.ts";

/**
 * Membership is written "as of now" and never backdated, so a newly created
 * group explains nothing about existing history — every past record keeps
 * resolving to Ungrouped. That is correct, and it looks exactly like a save
 * that did nothing, so the hint is not decoration.
 */
const EFFECTIVE_HINT =
  "Grouping applies to usage recorded from now on. Earlier usage keeps the grouping that applied when it happened.";

export function HostGroups({
  hostGroups,
  memberships,
  sourceHosts,
}: {
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const rows = hostGroupRows(hostGroups, memberships);
  const ungrouped = ungroupedHostIds(sourceHosts, memberships);
  // Index is the positional fallback for machines whose hostname is unusable,
  // so it must come from the full host list, not a filtered subset.
  const labelFor = (sourceHostId: string) => {
    const index = sourceHosts.findIndex((host) => host.id === sourceHostId);
    const host = sourceHosts[index];
    return host ? sourceHostLabel(host, index) : sourceHostId;
  };
  return (
    <section className="settings-section" aria-labelledby="host-groups-title">
      <div className="settings-section-head">
        <h2 id="host-groups-title">Host groups</h2>
        <p>{EFFECTIVE_HINT}</p>
      </div>
      {rows.length === 0 ? (
        <p className="empty-state">No host groups yet.</p>
      ) : (
        <ul className="host-group-list">
          {rows.map((row) => (
            <li key={row.id} className="host-group-card">
              <h3>{row.name}</h3>
              <p className="host-group-members">
                {row.memberHostIds.length === 0
                  ? "No hosts"
                  : row.memberHostIds.map(labelFor).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      <p className="host-group-ungrouped">
        Ungrouped: {ungrouped.length === 0 ? "none" : ungrouped.map(labelFor).join(", ")}
      </p>
    </section>
  );
}
```

- [ ] **Step 3: Write the Settings shell**

Create `apps/web/src/views/settings/index.tsx`:

```tsx
import { useState } from "react";
import type {
  HostGroup,
  HostGroupMembership,
  ModelPrice,
  SourceHost,
} from "@llm-usage-monitor/contracts";
import { HostGroups } from "./host-groups.tsx";
import { Pricing } from "./rates.tsx";

type SettingsTab = "rates" | "host-groups";

const TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: "rates", label: "Model rates" },
  { value: "host-groups", label: "Host groups" },
];

/**
 * Owns which settings section is showing so `app.tsx` does not gain a tenth
 * piece of state for a concern that is entirely local to this screen.
 */
export function Settings({
  prices,
  hostGroups,
  memberships,
  sourceHosts,
  onSaved,
}: {
  prices: ModelPrice[];
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const [tab, setTab] = useState<SettingsTab>("rates");
  return (
    <section className="settings">
      {/* Same chip/aria-pressed idiom as Breakdown's Group-by row. */}
      <div className="group-by" role="group" aria-label="Settings sections">
        {TABS.map((item) => (
          <button
            type="button"
            key={item.value}
            className={`chip ${tab === item.value ? "on" : ""}`}
            aria-pressed={tab === item.value}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "rates" ? (
        <Pricing prices={prices} onSaved={onSaved} />
      ) : (
        <HostGroups
          hostGroups={hostGroups}
          memberships={memberships}
          sourceHosts={sourceHosts}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire it into `app.tsx`**

In `apps/web/src/app.tsx`:

Add `HostGroup` and `HostGroupMembership` to the type import from `@llm-usage-monitor/contracts`.

Replace the `Pricing` import with:

```tsx
import { Settings } from "./views/settings/index.tsx";
```

Add state beside `sourceHosts` (after line 47):

```tsx
  const [hostGroups, setHostGroups] = useState<HostGroup[]>([]);
  const [memberships, setMemberships] = useState<HostGroupMembership[]>([]);
```

In `refresh`, after `setSourceHosts(catalog.sourceHosts);`:

```tsx
      setHostGroups(catalog.hostGroups);
      setMemberships(catalog.memberships);
```

Pass them into `<ViewSlot>` alongside `prices`:

```tsx
            hostGroups={hostGroups}
            memberships={memberships}
            sourceHosts={sourceHosts}
```

In `ViewSlot`, add to the destructured params and the props type:

```tsx
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
```

and replace the settings branch:

```tsx
  if (settingsOpen)
    return (
      <Settings
        prices={prices}
        hostGroups={hostGroups}
        memberships={memberships}
        sourceHosts={sourceHosts}
        onSaved={onSaved}
      />
    );
```

- [ ] **Step 5: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.settings-section {
  overflow: clip;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
}
.settings-section-head {
  padding: 10px;
  border-bottom: 1px solid var(--line);
}
.settings-section-head h2 {
  margin: 0 0 1px;
  font-size: 14px;
}
.settings-section-head p {
  margin: 0;
  max-width: 62ch;
  color: var(--muted);
  font-size: 10px;
}
.host-group-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.host-group-card {
  padding: 10px;
  border-bottom: 1px solid var(--line);
}
.host-group-card:last-child {
  border-bottom: 0;
}
.host-group-card h3 {
  margin: 0 0 4px;
  font-size: 12px;
}
.host-group-members,
.host-group-ungrouped {
  margin: 0;
  color: var(--muted);
  font-size: var(--size-meta);
}
.host-group-ungrouped {
  padding: 10px;
  border-top: 1px solid var(--line);
}
```

- [ ] **Step 6: Verify it typechecks, builds and still passes**

Run: `bun run typecheck && bun run test && bun run build:web`
Expected: all pass. `typecheck` is the real gate here — components are not unit-tested in this codebase, so a type error is the only automated signal that the props are wired correctly.

- [ ] **Step 7: Commit**

```bash
bun run format
git add apps/web/src/api.ts apps/web/src/app.tsx apps/web/src/views/settings/index.tsx apps/web/src/views/settings/host-groups.tsx apps/web/src/styles.css
git commit -m "Add a tabbed Settings shell listing Host Groups

Settings rendered only the price table. It now has Model rates and Host
groups tabs; the groups tab is read-only until the editor lands."
```

---

### Task 7: Edit group names and membership

**Files:**
- Modify: `apps/web/src/views/settings/host-groups.tsx` (whole component)
- Modify: `apps/web/src/styles.css` (append)

**Interfaces:**
- Consumes: `currentGroupIdFor` from Task 5; `executeAction` from `apps/web/src/api.ts`; the `set-host-group` action from `packages/contracts/src/index.ts:322-331`.
- Produces: nothing new for later tasks. Task 8 adds creation and retirement to this same component.

- [ ] **Step 1: Replace the component with an editing version**

Rewrite `apps/web/src/views/settings/host-groups.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { HostGroup, HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import { executeAction } from "../../api.ts";
import {
  currentGroupIdFor,
  hostGroupRows,
  ungroupedHostIds,
  type HostGroupRow,
} from "../../model/host-groups.ts";
import { sourceHostLabel } from "../../model/source-host.ts";

/**
 * Membership is written "as of now" and never backdated, so a newly created
 * group explains nothing about existing history — every past record keeps
 * resolving to Ungrouped. That is correct, and it looks exactly like a save
 * that did nothing, so the hint is not decoration.
 */
const EFFECTIVE_HINT =
  "Grouping applies to usage recorded from now on. Earlier usage keeps the grouping that applied when it happened.";

export function HostGroups({
  hostGroups,
  memberships,
  sourceHosts,
  onSaved,
}: {
  hostGroups: HostGroup[];
  memberships: HostGroupMembership[];
  sourceHosts: SourceHost[];
  onSaved: () => Promise<void>;
}) {
  const saved = hostGroupRows(hostGroups, memberships);
  const [draft, setDraft] = useState<HostGroupRow[]>(saved);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const ungrouped = ungroupedHostIds(sourceHosts, memberships);
  /*
    Refetching replaces the props, and without this the cards would keep
    rendering pre-save values and look unsaved.

    Unsaved new-group drafts are carried across rather than dropped. `refresh()`
    in app.tsx fires on any filter change and hands back fresh array identities,
    so a plain reset would silently discard a group the user was part-way
    through naming just because they touched a topbar chip.
  */
  useEffect(() => {
    setDraft((current) => [
      ...hostGroupRows(hostGroups, memberships),
      ...current.filter((row) => !hostGroups.some((group) => group.id === row.id)),
    ]);
  }, [hostGroups, memberships]);

  const labelFor = (sourceHostId: string) => {
    const index = sourceHosts.findIndex((host) => host.id === sourceHostId);
    const host = sourceHosts[index];
    return host ? sourceHostLabel(host, index) : sourceHostId;
  };
  const savedName = (groupId: string) => hostGroups.find((group) => group.id === groupId)?.name;
  const update = (id: string, change: Partial<HostGroupRow>) =>
    setDraft((current) => current.map((row) => (row.id === id ? { ...row, ...change } : row)));
  const toggleHost = (row: HostGroupRow, sourceHostId: string) =>
    update(row.id, {
      memberHostIds: row.memberHostIds.includes(sourceHostId)
        ? row.memberHostIds.filter((id) => id !== sourceHostId)
        : [...row.memberHostIds, sourceHostId],
    });

  const save = async (row: HostGroupRow) => {
    setSavingId(row.id);
    setError("");
    try {
      await executeAction({
        version: 1,
        type: "set-host-group",
        hostGroupId: row.id,
        name: row.name.trim(),
        sourceHostIds: row.memberHostIds,
        effectiveAt: new Date().toISOString(),
      });
      await onSaved();
    } catch (reason) {
      // Without this the rejection is unhandled, onSaved never runs, and the
      // button returns to its resting state as though the save succeeded.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSavingId(null);
    }
  };

  const isDirty = (row: HostGroupRow) => {
    const original = saved.find((item) => item.id === row.id);
    return (
      !original ||
      original.name !== row.name ||
      original.memberHostIds.length !== row.memberHostIds.length ||
      original.memberHostIds.some((id) => !row.memberHostIds.includes(id))
    );
  };

  return (
    <section className="settings-section" aria-labelledby="host-groups-title">
      <div className="settings-section-head">
        <h2 id="host-groups-title">Host groups</h2>
        <p>{EFFECTIVE_HINT}</p>
      </div>
      {error && (
        <p role="alert" className="error host-group-error">
          {error}
        </p>
      )}
      {draft.length === 0 ? (
        <p className="empty-state">No host groups yet.</p>
      ) : (
        <ul className="host-group-list">
          {draft.map((row) => (
            <li key={row.id} className="host-group-card">
              <div className="host-group-card-head">
                <label className="host-group-name">
                  Group name
                  <input
                    type="text"
                    value={row.name}
                    onChange={(event) => update(row.id, { name: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="primary"
                  disabled={
                    savingId !== null || row.name.trim() === "" || !isDirty(row)
                  }
                  onClick={() => void save(row)}
                >
                  {savingId === row.id ? "Saving…" : "Save"}
                </button>
              </div>
              <fieldset className="host-group-hosts">
                <legend>Hosts in {savedName(row.id) ?? "this group"}</legend>
                {sourceHosts.map((host, index) => {
                  const elsewhere = currentGroupIdFor(host.id, memberships);
                  const moving = elsewhere !== null && elsewhere !== row.id;
                  return (
                    <label key={host.id} className="host-group-host">
                      <input
                        type="checkbox"
                        checked={row.memberHostIds.includes(host.id)}
                        onChange={() => toggleHost(row, host.id)}
                      />
                      <span>{sourceHostLabel(host, index)}</span>
                      {/* Shown before the move, not after, so the consequence
                          is visible while the choice is still reversible. */}
                      {moving && (
                        <span className="host-group-moving">
                          currently in {savedName(elsewhere) ?? elsewhere}
                        </span>
                      )}
                    </label>
                  );
                })}
              </fieldset>
            </li>
          ))}
        </ul>
      )}
      <p className="host-group-ungrouped">
        Ungrouped: {ungrouped.length === 0 ? "none" : ungrouped.map(labelFor).join(", ")}
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.host-group-card-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.host-group-name {
  flex: 1;
  max-width: 280px;
}
.host-group-hosts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
  margin: 0;
  padding: 0;
  border: 0;
}
.host-group-hosts legend {
  padding: 0;
  color: var(--muted);
  font-size: 10px;
}
.host-group-host {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ink);
  font-size: var(--size-meta);
}
.host-group-host input {
  display: inline;
  width: auto;
  height: auto;
  margin: 0;
}
.host-group-moving {
  color: var(--muted);
  font-size: 10px;
}
.host-group-error {
  margin: 0;
  padding: 8px 10px;
}
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun run test && bun run build:web`
Expected: all pass.

- [ ] **Step 4: Check it in the running app**

Run: `bun run dev`, open the dashboard URL it prints, click the gear, open **Host groups**.
Expected: no groups yet (Task 8 adds creation), the hint text is visible, and the Ungrouped line names the local machine.

- [ ] **Step 5: Commit**

```bash
bun run format
git add apps/web/src/views/settings/host-groups.tsx apps/web/src/styles.css
git commit -m "Make Host Group names and membership editable"
```

---

### Task 8: Create and retire groups

**Files:**
- Modify: `apps/web/src/views/settings/host-groups.tsx`
- Modify: `apps/web/src/styles.css` (append)

**Interfaces:**
- Consumes: everything from Task 7.
- Produces: the finished editor. No later task depends on its internals.

- [ ] **Step 1: Add creation and retirement**

In `apps/web/src/views/settings/host-groups.tsx`:

Add below the `EFFECTIVE_HINT` constant:

```tsx
/**
 * Ids are generated, never derived from the name: the name is editable and a
 * slug-derived id would change under a rename, orphaning historical
 * memberships. `crypto.randomUUID` is available because the dashboard is served
 * from 127.0.0.1, which browsers treat as a secure context.
 */
const newGroupId = () => `group:${crypto.randomUUID()}`;
```

Add to the component body, after `save`:

```tsx
  const addGroup = () =>
    setDraft((current) => [...current, { id: newGroupId(), name: "", memberHostIds: [] }]);

  /**
   * Retirement, not deletion: the group keeps its historical memberships with a
   * closed effective_to, so past totals do not move. There is deliberately no
   * way to delete a group and rewrite history.
   */
  const retire = async (row: HostGroupRow) => {
    const label = savedName(row.id) ?? row.name;
    if (
      !window.confirm(
        `Retire "${label}"? Usage recorded from now on will be ungrouped. Past usage keeps this group, so no existing totals change.`,
      )
    )
      return;
    await save({ ...row, name: label, memberHostIds: [] });
  };
```

Add a "New group" button to the section head. Replace the `settings-section-head` block:

```tsx
      <div className="settings-section-head host-group-head">
        <div>
          <h2 id="host-groups-title">Host groups</h2>
          <p>{EFFECTIVE_HINT}</p>
        </div>
        <button type="button" className="primary" onClick={addGroup}>
          New group
        </button>
      </div>
```

Add the Retire button beside Save in the card head. Replace the Save button with:

```tsx
                <div className="host-group-actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={savingId !== null || row.name.trim() === "" || !isDirty(row)}
                    onClick={() => void save(row)}
                  >
                    {savingId === row.id ? "Saving…" : "Save"}
                  </button>
                  {/* A draft that was never saved has nothing to retire; it is
                      discarded by reload, so the button would be a no-op. */}
                  {savedName(row.id) !== undefined && (
                    <button type="button" disabled={savingId !== null} onClick={() => void retire(row)}>
                      Retire
                    </button>
                  )}
                </div>
```

Update the empty state, since a draft now counts as a group:

```tsx
        <p className="empty-state">No host groups yet. Use New group to add one.</p>
```

- [ ] **Step 2: Add the styles**

Append to `apps/web/src/styles.css`:

```css
.host-group-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.host-group-actions {
  display: flex;
  gap: 6px;
}
```

- [ ] **Step 3: Verify**

Run: `bun run typecheck && bun run test && bun run build:web`
Expected: all pass.

- [ ] **Step 4: Check the whole flow in the running app**

Run: `bun run dev` and open the dashboard.

1. Gear → **Host groups** → **New group**. Name it `Laptops`, tick the local host, **Save**.
2. The Ungrouped line should now read "none".
3. **Refresh sources**, then go to **Breakdown → Host Group**. Fresh usage recorded after the save appears under `Laptops`; older usage stays under `Ungrouped`. Both are correct — this is the `effectiveAt = now` decision, and the hint text explains it.
4. Rename `Laptops` to `Portables`, Save, and confirm the Breakdown label follows the rename with no change to any number.
5. **Retire** the group and confirm past totals are unchanged.
6. Confirm no `group:<uuid>` string is ever visible.

- [ ] **Step 5: Commit**

```bash
bun run format
git add apps/web/src/views/settings/host-groups.tsx apps/web/src/styles.css
git commit -m "Create and retire Host Groups from Settings

Retirement closes memberships as of now rather than deleting the group,
so historical totals stay stable."
```

---

### Task 9: Fix the silent price-save failure, and document the feature

`Pricing.save` has `try`/`finally` with no `catch` — a failed save rejects unhandled and the button returns to reading "Prices saved". This is the same defect `refreshSources` was fixed for in `app.tsx`.

**Files:**
- Modify: `apps/web/src/views/settings/rates.tsx:26-34`
- Modify: `README.md` (the feature list around line 21-23)
- Modify: `CHANGELOG.md` (the top unreleased section)

**Interfaces:** none.

- [ ] **Step 1: Add the missing catch**

In `apps/web/src/views/settings/rates.tsx`, add `const [error, setError] = useState("");` beside the existing state, and replace `save`:

```tsx
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await executeAction({ version: 1, type: "replace-prices", prices: draft });
      await onSaved();
    } catch (reason) {
      // Without this the rejection is unhandled, onSaved never runs, and the
      // button returns to "Prices saved" as though nothing went wrong.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
```

Render it directly below the toolbar `</div>`:

```tsx
      {error && (
        <p role="alert" className="error host-group-error">
          {error}
        </p>
      )}
```

- [ ] **Step 2: Update the README feature list**

In `README.md`, add after the existing Source Host bullet (around line 22):

```markdown
- Groups Source Hosts into user-defined Host Groups from Settings, effective from the moment they are saved.
```

- [ ] **Step 3: Update the CHANGELOG**

Add under the top unreleased heading in `CHANGELOG.md`:

```markdown
- Host Groups are configurable from Settings: create, rename, populate and retire them. Grouping takes effect from the moment it is saved, so historical totals keep the grouping that applied when the usage happened.
- Fixed `setHostGroup` leaving a host in two groups at once when it was moved, which made its group resolution depend on insertion order.
- Host Group breakdown rows now show the group's name instead of its internal id.
- Fixed a failed price save reporting success.
```

- [ ] **Step 4: Run the full gate**

Run: `bun run check`
Expected: format, lint, typecheck, test and build all pass.

- [ ] **Step 5: Commit**

```bash
bun run format
git add apps/web/src/views/settings/rates.tsx README.md CHANGELOG.md
git commit -m "Surface price-save failures, document Host Group configuration"
```

---

## Verification against the spec's success criteria

Run these after Task 9. Each maps to a numbered criterion in the spec.

1. **Create → see the name.** Task 8 Step 4, items 1 and 3.
2. **Rename changes the label, not the totals.** Task 8 Step 4, item 4; Task 1's rename test pins the id and memberships.
3. **Retiring leaves history unchanged.** Task 8 Step 4, item 5; the ledger's pre-existing `retains effective-dated Host Group memberships` test.
4. **Moving a host produces exactly one open membership.** Task 2's test.
5. **No raw `group:<uuid>` shown.** Task 8 Step 4, item 6; Task 3 pins the id fallback as the only path that can show one, and it only fires when a group row is genuinely missing.

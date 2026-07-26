import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import {
  currentGroupIdFor,
  hostGroupRows,
  mergeDraft,
  rowsDiffer,
  ungroupedHostIds,
  type HostGroupRow,
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
    assert.deepEqual(ungroupedHostIds([host("host:a")], [retired("group:one", "host:a")]), [
      "host:a",
    ]);
  });
});

describe("rowsDiffer", () => {
  it("is false for identical rows", () => {
    const row: HostGroupRow = { id: "group:one", name: "Laptops", memberHostIds: ["host:a"] };
    assert.equal(rowsDiffer(row, { ...row }), false);
  });

  it("detects a name change", () => {
    const a: HostGroupRow = { id: "group:one", name: "Laptops", memberHostIds: [] };
    const b: HostGroupRow = { id: "group:one", name: "Desktops", memberHostIds: [] };
    assert.equal(rowsDiffer(a, b), true);
  });

  // A membership-only change with an unchanged name must still be detected,
  // and detected the same way regardless of the order the ids happen to be
  // stored in — order is an implementation detail of the ledger scan, not
  // part of what "changed" means.
  it("detects a membership-only change, order-insensitively", () => {
    const a: HostGroupRow = {
      id: "group:one",
      name: "Laptops",
      memberHostIds: ["host:a", "host:b"],
    };
    const bSameOrder: HostGroupRow = {
      id: "group:one",
      name: "Laptops",
      memberHostIds: ["host:a"],
    };
    assert.equal(rowsDiffer(a, bSameOrder), true);

    const bReordered: HostGroupRow = {
      id: "group:one",
      name: "Laptops",
      memberHostIds: ["host:b", "host:a"],
    };
    assert.equal(rowsDiffer(a, bReordered), false);
  });
});

describe("mergeDraft", () => {
  const previous: HostGroupRow[] = [
    { id: "group:one", name: "Laptops", memberHostIds: ["host:a"] },
    { id: "group:two", name: "Workstations", memberHostIds: [] },
  ];

  it("keeps an edited card's draft (draft differs from previous)", () => {
    const current: HostGroupRow[] = [
      { id: "group:one", name: "Laptops (renamed)", memberHostIds: ["host:a"] },
      { id: "group:two", name: "Workstations", memberHostIds: [] },
    ];
    // Server hasn't seen the rename yet; fresh still reports the old name.
    const fresh: HostGroupRow[] = [
      { id: "group:one", name: "Laptops", memberHostIds: ["host:a"] },
      { id: "group:two", name: "Workstations", memberHostIds: [] },
    ];
    const result = mergeDraft(current, fresh, previous);
    assert.deepEqual(
      result.find((row) => row.id === "group:one"),
      { id: "group:one", name: "Laptops (renamed)", memberHostIds: ["host:a"] },
    );
  });

  it("takes the fresh value for an untouched card, even when the server changed it", () => {
    const current: HostGroupRow[] = previous; // untouched: draft === previous
    // Someone else retired the group server-side; fresh now reports no members.
    const fresh: HostGroupRow[] = [
      { id: "group:one", name: "Laptops", memberHostIds: [] },
      { id: "group:two", name: "Workstations", memberHostIds: [] },
    ];
    const result = mergeDraft(current, fresh, previous);
    assert.deepEqual(
      result.find((row) => row.id === "group:one"),
      { id: "group:one", name: "Laptops", memberHostIds: [] },
    );
  });

  it("carries a not-yet-persisted row across (its id is absent from fresh)", () => {
    const current: HostGroupRow[] = [
      ...previous,
      { id: "group:new", name: "Draft group", memberHostIds: [] },
    ];
    const fresh: HostGroupRow[] = previous;
    const result = mergeDraft(current, fresh, previous);
    assert.deepEqual(
      result.find((row) => row.id === "group:new"),
      { id: "group:new", name: "Draft group", memberHostIds: [] },
    );
  });

  it("takes the fresh value for a card new to us (in fresh, absent from previous)", () => {
    const current: HostGroupRow[] = previous;
    const fresh: HostGroupRow[] = [
      ...previous,
      { id: "group:three", name: "Servers", memberHostIds: ["host:z"] },
    ];
    const result = mergeDraft(current, fresh, previous);
    assert.deepEqual(
      result.find((row) => row.id === "group:three"),
      { id: "group:three", name: "Servers", memberHostIds: ["host:z"] },
    );
  });

  // This is the test that pins the StrictMode bug (Finding 1): React
  // invokes a state updater twice against the same base state, keeping the
  // second call's result. A merge that mutates its "last seen" baseline as
  // a side effect of running would see its second invocation compare
  // against the output of the first — making every untouched card look
  // "edited" and silently discarding real server-side changes (e.g. a
  // retirement). `mergeDraft` takes `previous` as a plain argument instead
  // of reading/writing a ref, so it has no hidden state to desync: calling
  // it twice with the same arguments must return the same result both times.
  it("is idempotent: calling it twice with the same arguments returns the same result", () => {
    const current: HostGroupRow[] = previous;
    const fresh: HostGroupRow[] = [
      { id: "group:one", name: "Laptops", memberHostIds: [] }, // retired server-side
      { id: "group:two", name: "Workstations", memberHostIds: [] },
    ];
    const firstCall = mergeDraft(current, fresh, previous);
    const secondCall = mergeDraft(current, fresh, previous);
    assert.deepEqual(firstCall, secondCall);
    // And the result must reflect the retirement, not the stale draft.
    assert.deepEqual(
      secondCall.find((row) => row.id === "group:one"),
      { id: "group:one", name: "Laptops", memberHostIds: [] },
    );
  });
});

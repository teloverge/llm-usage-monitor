import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { HostGroupMembership, SourceHost } from "@llm-usage-monitor/contracts";
import { currentGroupIdFor, hostGroupRows, ungroupedHostIds } from "../src/model/host-groups.ts";

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

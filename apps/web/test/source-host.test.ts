import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceHost } from "@llm-usage-monitor/contracts";
import { sourceHostLabel } from "../src/model/source-host.ts";

const host = (hostname: string | null): SourceHost => ({
  id: "host:a",
  hostname,
  platform: "win32",
  architecture: "x64",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-07-20T09:00:00.000Z",
});

describe("Source Host labels", () => {
  it("prefers a real hostname", () => {
    assert.equal(sourceHostLabel(host("workstation"), 0), "workstation");
  });

  it("falls back when the hostname is a colon-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("a1:b2:c3:d4:e5:f6"), 0), "Source Host 1");
  });

  it("falls back when the hostname is a hyphen-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("A1-B2-C3-D4-E5-F6"), 1), "Source Host 2");
  });

  it("falls back when the hostname is a bare 12-digit hex identifier", () => {
    assert.equal(sourceHostLabel(host("a1b2c3d4e5f6"), 2), "Source Host 3");
  });

  it("falls back when the hostname is missing or blank", () => {
    assert.equal(sourceHostLabel(host(null), 0), "Source Host 1");
    assert.equal(sourceHostLabel(host("   "), 0), "Source Host 1");
  });

  it("keeps a hostname that merely contains hex characters", () => {
    assert.equal(sourceHostLabel(host("dead-beef-laptop"), 0), "dead-beef-laptop");
  });
});

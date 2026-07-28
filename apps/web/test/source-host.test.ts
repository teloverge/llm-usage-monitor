import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceHost } from "@llm-usage-monitor/contracts";
import { sourceHostLabel, sourceHostLabels } from "../src/model/source-host.ts";

const host = (hostname: string | null): SourceHost => ({
  id: "host:a",
  hostname,
  platform: "win32",
  architecture: "x64",
  firstSeenAt: "2026-01-01T00:00:00.000Z",
  lastSeenAt: "2026-07-20T09:00:00.000Z",
});

// The translated wording is injected, exactly as the component will inject it.
const FALLBACK_1 = "Source Host 1";
const FALLBACK_2 = "Source Host 2";
const FALLBACK_3 = "Source Host 3";

describe("Source Host labels", () => {
  it("prefers a real hostname", () => {
    assert.equal(sourceHostLabel(host("workstation"), FALLBACK_1), "workstation");
  });

  it("falls back when the hostname is a colon-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("a1:b2:c3:d4:e5:f6"), FALLBACK_1), "Source Host 1");
  });

  it("falls back when the hostname is a hyphen-separated MAC address", () => {
    assert.equal(sourceHostLabel(host("A1-B2-C3-D4-E5-F6"), FALLBACK_2), "Source Host 2");
  });

  it("falls back when the hostname is a bare 12-digit hex identifier", () => {
    assert.equal(sourceHostLabel(host("a1b2c3d4e5f6"), FALLBACK_3), "Source Host 3");
  });

  it("falls back when the hostname is missing or blank", () => {
    assert.equal(sourceHostLabel(host(null), FALLBACK_1), "Source Host 1");
    assert.equal(sourceHostLabel(host("   "), FALLBACK_1), "Source Host 1");
  });

  it("keeps a hostname that merely contains hex characters", () => {
    assert.equal(sourceHostLabel(host("dead-beef-laptop"), FALLBACK_1), "dead-beef-laptop");
  });

  // The caller renders the fallback via `common.sourceHostFallback`; this
  // pins that the injected wording is used verbatim, in whatever language it
  // was rendered in, rather than the model reconstructing English text.
  it("ignores English convention and renders exactly the injected wording", () => {
    assert.equal(sourceHostLabel(host(null), "Host de origen 1"), "Host de origen 1");
  });
});

describe("Source Host id resolution", () => {
  const withId = (id: string, hostname: string | null): SourceHost => ({
    ...host(hostname),
    id,
  });
  const fallback = (index: number) => `Host de origen ${index}`;

  it("resolves an id to its hostname", () => {
    const label = sourceHostLabels([withId("host:a", "workstation")], fallback);
    assert.equal(label("host:a"), "workstation");
  });

  it("numbers the positional fallback from the catalog, not from the rows shown", () => {
    // The unnamed host is third in the catalog, so it is "3" wherever it appears
    // — a panel that happens to rank only this host must not renumber it to "1".
    const label = sourceHostLabels(
      [
        withId("host:a", "workstation"),
        withId("host:b", "buildbox"),
        withId("host:c", "a1:b2:c3:d4:e5:f6"),
      ],
      fallback,
    );
    assert.equal(label("host:c"), "Host de origen 3");
  });

  it("keeps two unnamed hosts distinguishable", () => {
    const label = sourceHostLabels([withId("host:a", null), withId("host:b", null)], fallback);
    assert.notEqual(label("host:a"), label("host:b"));
  });

  /**
   * The same reasoning as `usageSourceLabel`: an id the catalog does not know
   * passes through rather than collapsing into a shared "unknown" label, so two
   * unregistered hosts stay distinguishable from each other.
   */
  it("passes an unknown id through rather than inventing a name", () => {
    const label = sourceHostLabels([withId("host:a", "workstation")], fallback);
    assert.equal(label("host:zzz"), "host:zzz");
  });
});

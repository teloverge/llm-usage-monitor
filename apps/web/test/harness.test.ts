import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { harnessLabel, isUnknownHarness, usageSourceLabel } from "../src/model/harness.ts";

// The translated wording is injected, exactly as the component will inject it.
const UNKNOWN = "Unknown harness";

describe("Harness labels", () => {
  it("names the harnesses it knows", () => {
    assert.equal(harnessLabel("codex", UNKNOWN), "Codex");
    assert.equal(harnessLabel("claude-code", UNKNOWN), "Claude Code");
  });

  // Product names are never translated, so the injected wording must not reach
  // a harness the table can name.
  it("ignores the injected wording for a known harness", () => {
    assert.equal(harnessLabel("codex", "Entorno desconocido"), "Codex");
  });

  it("renders the unknown sentinel as the caller's wording, not a raw token", () => {
    assert.equal(harnessLabel("unknown", UNKNOWN), "Unknown harness");
    assert.equal(harnessLabel("unknown", "Entorno desconocido"), "Entorno desconocido");
  });

  it("passes an unrecognised id through rather than inventing a name", () => {
    assert.equal(harnessLabel("windsurf", UNKNOWN), "windsurf");
  });

  it("flags anything it cannot name so callers can style it apart", () => {
    assert.equal(isUnknownHarness("codex"), false);
    assert.equal(isUnknownHarness("claude-code"), false);
    assert.equal(isUnknownHarness("unknown"), true);
    assert.equal(isUnknownHarness("windsurf"), true);
  });
});

describe("Usage source labels", () => {
  it("names a registered source through its harness", () => {
    assert.equal(usageSourceLabel("codex-local"), "Codex");
    assert.equal(usageSourceLabel("claude-code-local"), "Claude Code");
  });

  // `harnessForSource` maps every unregistered source to the same "unknown"
  // sentinel. Labelling by harness would render two different accounts' quota
  // meters identically while they showed different percentages.
  it("keeps unregistered sources distinguishable from each other", () => {
    assert.equal(usageSourceLabel("windsurf-local"), "windsurf-local");
    assert.equal(usageSourceLabel("aider-local"), "aider-local");
    assert.notEqual(usageSourceLabel("windsurf-local"), usageSourceLabel("aider-local"));
  });

  // It resolves only to names the table holds, so it needs no translated
  // wording and takes no such parameter.
  it("never renders an unregistered source as a named harness", () => {
    assert.notEqual(usageSourceLabel("windsurf-local"), "Unknown harness");
    assert.notEqual(usageSourceLabel("windsurf-local"), "Codex");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { harnessLabel, isUnknownHarness, usageSourceLabel } from "../src/model/harness.ts";

describe("Harness labels", () => {
  it("names the harnesses it knows", () => {
    assert.equal(harnessLabel("codex"), "Codex");
    assert.equal(harnessLabel("claude-code"), "Claude Code");
  });

  it("renders the unknown sentinel as a state, not a name", () => {
    assert.equal(harnessLabel("unknown"), "Unknown harness");
  });

  it("passes an unrecognised id through rather than inventing a name", () => {
    assert.equal(harnessLabel("windsurf"), "windsurf");
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

  it("never renders an unregistered source as a named harness", () => {
    assert.notEqual(usageSourceLabel("windsurf-local"), "Unknown harness");
    assert.notEqual(usageSourceLabel("windsurf-local"), "Codex");
  });
});

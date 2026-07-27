import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { readClaudeConfig } from "../src/claude-quota.ts";

const scratch: string[] = [];
async function temp(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), "lum-claude-"));
  scratch.push(dir);
  return dir;
}
after(async () => {
  for (const dir of scratch) await fs.rm(dir, { recursive: true, force: true });
});

describe("readClaudeConfig", () => {
  it("finds the config beside the default home directory", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    // The importer's `home` is `<dir>/.claude`; the config is its sibling.
    assert.deepEqual(await readClaudeConfig(join(dir, ".claude")), { marker: "sibling" });
  });

  it("finds the config inside a configured home directory", async () => {
    const dir = await temp();
    const home = join(dir, "cfg");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), '{"marker":"inside"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "inside" });
  });

  it("returns null when no config exists", async () => {
    const dir = await temp();
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("falls through to the sibling when the inner config is malformed", async () => {
    const dir = await temp();
    const home = join(dir, ".claude");
    await fs.mkdir(home);
    await fs.writeFile(join(home, ".claude.json"), "{ not json", "utf8");
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.deepEqual(await readClaudeConfig(home), { marker: "sibling" });
  });

  it("returns null for malformed JSON with nothing to fall through to", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "{ not json", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });

  it("skips a file larger than the size guard", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), '{"marker":"sibling"}', "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude"), 4), null);
  });

  it("rejects a top-level array", async () => {
    const dir = await temp();
    await fs.writeFile(join(dir, ".claude.json"), "[1,2,3]", "utf8");
    assert.equal(await readClaudeConfig(join(dir, ".claude")), null);
  });
});

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseOpenCodeDatabase } from "../src/opencode-importer.ts";

const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("OpenCode importer", () => {
  it("reads per-response usage without loading session titles or content tables", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-importer-"));
    cleanup.push(root);
    const file = join(root, "opencode.db");
    const database = new DatabaseSync(file);
    database.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        data TEXT NOT NULL
      );
    `);
    database
      .prepare("INSERT INTO session (id, title) VALUES (?, ?)")
      .run("ses_private", "A title that must not leave the database");
    database
      .prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?, ?, ?, ?)")
      .run(
        "msg_1",
        "ses_private",
        Date.parse("2026-08-20T10:00:00.000Z"),
        JSON.stringify({
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-test",
          mode: "build",
          path: { cwd: "/private/project" },
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 20, write: 5 } },
        }),
      );
    database.close();

    const records = await parseOpenCodeDatabase(file);
    assert.equal(records.length, 1);
    assert.deepEqual(records[0], {
      id: "opencode:v1:ses_private:msg_1",
      usageSourceId: "opencode-local",
      harnessId: "opencode",
      timestamp: "2026-08-20T10:00:00.000Z",
      taskName: "OpenCode session ses_priv",
      provider: "anthropic",
      model: "claude-test",
      modeFlags: { ultra: false, fast: false },
      inputTokens: 35,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 5,
      outputTokens: 6,
      reasoningOutputTokens: 2,
      totalTokens: 41,
      lastTokenUsage: null,
      source: "opencode-local",
      sessionId: "ses_private",
      turnId: "msg_1",
    });
    assert.equal(JSON.stringify(records).includes("private/project"), false);
    assert.equal(JSON.stringify(records).includes("title that must"), false);
  });

  it("returns no records when the database has no supported message table", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-importer-"));
    cleanup.push(root);
    const file = join(root, "opencode.db");
    const database = new DatabaseSync(file);
    database.exec("CREATE TABLE migration (id TEXT PRIMARY KEY)");
    database.close();
    assert.deepEqual(await parseOpenCodeDatabase(file), []);
  });
});

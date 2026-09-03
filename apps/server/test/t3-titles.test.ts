import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "node:test";
import { readT3ConversationTitles, t3StateDatabasePath } from "../src/t3-titles.ts";
import { writeT3Home } from "./t3-fixture.ts";

const cleanup: string[] = [];
afterEach(async () => {
  for (const directory of cleanup.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), "t3-titles-"));
  cleanup.push(root);
  return root;
}

const CODEX_SESSION = "01a017e0-4f94-71f3-aac7-51327fdbf0c6";
const CLAUDE_SESSION = "520d307a-ebc9-4d36-88f5-3854c20da2a7";

describe("T3 conversation titles", () => {
  it("keys Codex titles by the cursor's threadId and Claude titles by its resume id", async () => {
    const home = await writeT3Home(await temporaryRoot(), [
      {
        provider: "codex",
        title: "Enable Linux Development Environment",
        cursor: JSON.stringify({ threadId: CODEX_SESSION }),
      },
      {
        provider: "claudeAgent",
        title: "Verify Linux LLM Setup",
        // The real shape: threadId here is T3's own thread, not a Claude session.
        cursor: JSON.stringify({
          threadId: "4d74482b-06b8-4be9-927f-0eec892f4fc6",
          resume: CLAUDE_SESSION,
          resumeSessionAt: "2cc56400-4645-4b9c-9fcb-aa85d4f3d302",
          turnCount: 3,
        }),
      },
    ]);
    const database = join(home, "userdata", "state.sqlite");
    assert.deepEqual(
      [...(await readT3ConversationTitles("codex", database))],
      [[CODEX_SESSION, "Enable Linux Development Environment"]],
    );
    assert.deepEqual(
      [...(await readT3ConversationTitles("claudeAgent", database))],
      [[CLAUDE_SESSION, "Verify Linux LLM Setup"]],
    );
  });

  it("skips placeholder titles, blank titles, and cursors it cannot read", async () => {
    const home = await writeT3Home(await temporaryRoot(), [
      { provider: "codex", title: "New thread", cursor: JSON.stringify({ threadId: "a" }) },
      { provider: "codex", title: "   ", cursor: JSON.stringify({ threadId: "b" }) },
      { provider: "codex", title: "Broken cursor", cursor: "{not json" },
      { provider: "codex", title: "No session", cursor: JSON.stringify({ turnCount: 1 }) },
      { provider: "codex", title: "  Kept  ", cursor: JSON.stringify({ threadId: " c " }) },
    ]);
    const titles = await readT3ConversationTitles("codex", join(home, "userdata", "state.sqlite"));
    assert.deepEqual([...titles], [["c", "Kept"]]);
  });

  it("reads nothing, and does not throw, when T3 is absent or its schema differs", async () => {
    const root = await temporaryRoot();
    assert.deepEqual(
      [...(await readT3ConversationTitles("codex", join(root, "missing", "state.sqlite")))],
      [],
    );
    const unrelated = join(root, "state.sqlite");
    const database = new DatabaseSync(unrelated);
    database.exec("CREATE TABLE something_else (id TEXT PRIMARY KEY)");
    database.close();
    assert.deepEqual([...(await readT3ConversationTitles("claudeAgent", unrelated))], []);
  });

  it("locates the database under T3CODE_HOME, falling back to ~/.t3", () => {
    assert.equal(
      t3StateDatabasePath({ T3CODE_HOME: "/opt/t3" }),
      join("/opt/t3", "userdata", "state.sqlite"),
    );
    assert.match(t3StateDatabasePath({}), /[\\/]\.t3[\\/]userdata[\\/]state\.sqlite$/);
  });
});

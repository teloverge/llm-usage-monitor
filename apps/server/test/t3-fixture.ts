import { promises as fs } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface T3ThreadFixture {
  provider: string;
  title: string;
  /** Written verbatim as `resume_cursor_json`, so a test can supply a broken one. */
  cursor: string;
}

/**
 * Writes the two T3 tables the title reader joins, and nothing else — the real
 * database also holds message bodies, and the reader must not need them. Returns
 * the T3 home to set as `T3CODE_HOME`.
 */
export async function writeT3Home(root: string, threads: T3ThreadFixture[]): Promise<string> {
  const home = join(root, ".t3");
  await fs.mkdir(join(home, "userdata"), { recursive: true });
  const database = new DatabaseSync(join(home, "userdata", "state.sqlite"));
  database.exec(`
    CREATE TABLE projection_threads (thread_id TEXT PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE provider_session_runtime (
      thread_id TEXT PRIMARY KEY,
      provider_name TEXT NOT NULL,
      resume_cursor_json TEXT
    );
  `);
  threads.forEach((thread, index) => {
    const threadId = `thread-${index + 1}`;
    database
      .prepare("INSERT INTO projection_threads (thread_id, title) VALUES (?, ?)")
      .run(threadId, thread.title);
    database
      .prepare(
        "INSERT INTO provider_session_runtime (thread_id, provider_name, resume_cursor_json) VALUES (?, ?, ?)",
      )
      .run(threadId, thread.provider, thread.cursor);
  });
  database.close();
  return home;
}

/** Runs `work` with `T3CODE_HOME` pointed at `home`, restoring the previous value after. */
export async function withT3Home<T>(home: string, work: () => Promise<T>): Promise<T> {
  const previous = process.env.T3CODE_HOME;
  process.env.T3CODE_HOME = home;
  try {
    return await work();
  } finally {
    if (previous === undefined) delete process.env.T3CODE_HOME;
    else process.env.T3CODE_HOME = previous;
  }
}

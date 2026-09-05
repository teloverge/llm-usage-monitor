import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseSession, subtractTokenShapes, usageModeFlags } from "../src/codex-importer.ts";

describe("Codex importer", () => {
  it("treats malformed provider and agent metadata as missing", async () => {
    const directory = await fs.mkdtemp(join(tmpdir(), "codex-importer-"));
    try {
      const file = join(directory, "session.jsonl");
      await fs.writeFile(
        file,
        [
          {
            type: "session_meta",
            payload: {
              id: "session",
              model_provider: {},
              agent_nickname: {},
              parent_thread_id: [],
            },
          },
          {
            type: "turn_context",
            timestamp: "2026-08-22T01:01:00.000Z",
            payload: { turn_id: "turn", model: "gpt-test" },
          },
          {
            type: "event_msg",
            timestamp: "2026-08-22T01:02:00.000Z",
            payload: {
              type: "token_count",
              info: { total_token_usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
            },
          },
        ]
          .map((line) => JSON.stringify(line))
          .join("\n"),
      );
      const { records } = await parseSession(file, new Map());
      assert.equal(records.length, 1);
      assert.equal(records[0]?.provider, "openai");
      assert.equal(records[0]?.agentNickname, undefined);
      assert.equal(records[0]?.parentSessionId, undefined);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it("subtracts cumulative counters without negative reset deltas", () =>
    assert.equal(
      subtractTokenShapes(
        {
          inputTokens: 10,
          cachedInputTokens: 20,
          outputTokens: 2,
          reasoningOutputTokens: 1,
          totalTokens: 12,
        },
        {
          inputTokens: 100,
          cachedInputTokens: 50,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          totalTokens: 120,
        },
      ).cachedInputTokens,
      10,
    ));
  it("records ultra reasoning and priority service as explicit mode flags", () =>
    assert.deepEqual(usageModeFlags({ service_tier: "priority" }, "ultrathink"), {
      ultra: true,
      fast: true,
    }));

  it("continues a turn whose context is re-emitted mid-turn rather than opening a second one", async () => {
    // The real shape after a context compaction: same turn id, same model, the
    // cumulative counter carrying straight on. One record, the whole delta.
    const directory = await fs.mkdtemp(join(tmpdir(), "codex-importer-"));
    const file = join(
      directory,
      "rollout-2026-08-22T01-00-00-01a00000-0000-7000-8000-000000000001.jsonl",
    );
    const count = (total: number) =>
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-08-22T01:02:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total },
          },
        },
      });
    const context = JSON.stringify({
      type: "turn_context",
      timestamp: "2026-08-22T01:01:00.000Z",
      payload: { turn_id: "01a00000-0001-7000-8000-000000000001", model: "gpt-test" },
    });
    await fs.writeFile(file, [context, count(1_000), context, count(3_000), ""].join("\n"), "utf8");
    const { records } = await parseSession(file, new Map());
    assert.equal(records.length, 1);
    assert.equal(records[0]?.totalTokens, 3_000);
    await fs.rm(directory, { recursive: true, force: true });
  });
});

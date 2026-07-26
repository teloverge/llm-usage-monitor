import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseClaudeSession } from "../src/claude-importer.ts";

const SESSION = "25f76325-0502-4193-bdf6-3717172e3db1";

function assistant(overrides: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    sessionId: SESSION,
    timestamp: "2026-07-25T17:58:37.658Z",
    effort: "high",
    requestId: "req_1",
    ...overrides,
    message: {
      id: "msg_1",
      model: "claude-opus-5",
      ...(overrides.message as Record<string, unknown>),
      usage: {
        input_tokens: 2,
        cache_read_input_tokens: 18_062,
        cache_creation_input_tokens: 9_638,
        output_tokens: 103,
        service_tier: "standard",
        ...usage,
      },
    },
  };
}

async function parseLines(lines: unknown[]) {
  const file = join(await fs.mkdtemp(join(tmpdir(), "claude-importer-")), `${SESSION}.jsonl`);
  // A raw string is written verbatim so a test can feed genuinely malformed JSON;
  // stringifying it would produce a valid JSON string and test nothing.
  const body = lines
    .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
    .join("\n");
  await fs.writeFile(file, body, "utf8");
  return parseClaudeSession(file);
}

describe("Claude importer", () => {
  it("counts one billed request once when its blocks span several lines", async () => {
    // The real transcript shape: identical message.id and identical usage, split
    // into a text line and a tool_use line. Summing them would double the turn.
    const records = await parseLines([
      assistant({ message: { content: [{ type: "text" }] } }),
      assistant({ message: { content: [{ type: "tool_use" }] } }),
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.outputTokens, 103);
  });

  it("folds the disjoint Anthropic figures into an inclusive input total", async () => {
    const [record] = await parseLines([assistant()]);
    assert.equal(record?.inputTokens, 2 + 18_062 + 9_638);
    assert.equal(record?.cachedInputTokens, 18_062);
    assert.equal(record?.cacheCreationInputTokens, 9_638);
    assert.equal(record?.totalTokens, 2 + 18_062 + 9_638 + 103);
  });

  it("leaves reasoning output unreported rather than zero", async () => {
    const [record] = await parseLines([assistant()]);
    assert.equal(record?.reasoningOutputTokens, undefined);
  });

  it("skips synthetic placeholders, which were never billed requests", async () => {
    const records = await parseLines([
      assistant({ message: { id: "msg_synthetic", model: "<synthetic>" } }),
    ]);
    assert.deepEqual(records, []);
  });

  it("titles the task from ai-title even when it trails the usage lines", async () => {
    const [record] = await parseLines([
      assistant(),
      { type: "ai-title", sessionId: SESSION, aiTitle: "Continue with SLICE-2-HANDOFF.md" },
    ]);
    assert.equal(record?.taskName, "Continue with SLICE-2-HANDOFF.md");
  });

  it("falls back to a session-derived task name when no title was written", async () => {
    const [record] = await parseLines([assistant()]);
    assert.equal(record?.taskName, `Claude session ${SESSION.slice(0, 8)}`);
  });

  it("stamps the Claude Code identity and Anthropic provider", async () => {
    const [record] = await parseLines([assistant()]);
    assert.equal(record?.usageSourceId, "claude-code-local");
    assert.equal(record?.harnessId, "claude-code");
    assert.equal(record?.provider, "anthropic");
    assert.equal(record?.reasoningLevel, "high");
    assert.equal(record?.id, `claude:${SESSION}:msg_1`);
  });

  it("reads fast mode from the usage speed field", async () => {
    const [record] = await parseLines([assistant({}, { speed: "fast" })]);
    assert.deepEqual(record?.modeFlags, { ultra: false, fast: true });
  });

  it("ignores malformed lines instead of failing the whole session", async () => {
    const records = await parseLines([assistant(), "{ not json"]);
    assert.equal(records.length, 1);
  });
});

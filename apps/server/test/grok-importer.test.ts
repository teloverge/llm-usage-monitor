import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { usageQuotaSnapshotSchema, usageRecordSchema } from "@llm-usage-monitor/contracts";
import { GrokSessionProvider } from "../src/grok-importer.ts";

const SESSION = "019fc3c2-7990-7161-b373-4458c52db233";

async function grokHome(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), "grok-importer-"));
}

/** One `shell.turn.inference_done` line as Grok Build 0.2.118 writes it. */
function inferenceLine(
  ts: string,
  tokens: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
) {
  return {
    ts,
    src: "shell",
    pid: 29264,
    ver: "0.2.118",
    lvl: "info",
    sid: SESSION,
    msg: "shell.turn.inference_done",
    ctx: {
      loop_index: 1,
      model_elapsed_ms: 9825,
      ttft_ms: 7889,
      attempts: 1,
      prompt_tokens: 14_787,
      cached_prompt_tokens: 3712,
      completion_tokens: 450,
      reasoning_tokens: 382,
      tokens_per_sec: 232.4,
      ...tokens,
    },
    ...overrides,
  };
}

/** One `billing: fetched credits config` line as Grok Build 0.2.118 writes it. */
function billingLine(ts: string, options: { cap: number; used: number; tier: string }) {
  return {
    ts,
    src: "shell",
    pid: 29264,
    ver: "0.2.118",
    lvl: "info",
    msg: "billing: fetched credits config",
    ctx: {
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-08-01T00:00:00+00:00",
          end: "2026-08-08T00:00:00+00:00",
        },
        onDemandCap: { val: options.cap },
        onDemandUsed: { val: options.used },
        prepaidBalance: { val: 0 },
        isUnifiedBillingUser: true,
        billingPeriodStart: "2026-08-01T00:00:00+00:00",
        billingPeriodEnd: "2026-08-08T00:00:00+00:00",
        historyLen: 0,
      },
      onDemandEnabled: null,
      subscriptionTier: options.tier,
    },
  };
}

function turnStarted(ts: string, modelId: string, turnNumber = 1, sessionId = SESSION) {
  return {
    ts,
    type: "turn_started",
    session_id: sessionId,
    turn_number: turnNumber,
    model_id: modelId,
    yolo_mode: false,
    session_relationship: "primary",
    schema_version: "1.0",
  };
}

async function writeHome(options: {
  unified?: unknown[];
  sessions?: Array<{
    id?: string;
    events?: unknown[];
    summary?: Record<string, unknown> | null;
  }>;
}): Promise<string> {
  const home = await grokHome();
  if (options.unified) {
    await fs.mkdir(join(home, "logs"), { recursive: true });
    const body = options.unified
      .map((line) => (typeof line === "string" ? line : JSON.stringify(line)))
      .join("\n");
    await fs.writeFile(join(home, "logs", "unified.jsonl"), body, "utf8");
  }
  for (const session of options.sessions ?? []) {
    const id = session.id ?? SESSION;
    const directory = join(home, "sessions", "C%3A%5Cdev%5Cproject", id);
    await fs.mkdir(directory, { recursive: true });
    if (session.events) {
      const body = session.events.map((line) => JSON.stringify(line)).join("\n");
      await fs.writeFile(join(directory, "events.jsonl"), body, "utf8");
    }
    if (session.summary !== null) {
      const summary = {
        info: { id, cwd: "C:\\dev\\project" },
        created_at: "2026-08-02T18:35:30.086809800Z",
        current_model_id: "grok-4.5",
        generated_title: "Refactor the widget factory",
        ...session.summary,
      };
      await fs.writeFile(join(directory, "summary.json"), JSON.stringify(summary), "utf8");
    }
  }
  return home;
}

async function collect(home: string, previousState: unknown = {}) {
  return new GrokSessionProvider().collect("host-1", home, previousState);
}

describe("Grok importer", () => {
  it("reports nothing from a home where Grok Build never ran", async () => {
    const home = await grokHome();
    const result = await new GrokSessionProvider().collect("host-1", home, {});
    assert.deepEqual(result.records, []);
    assert.deepEqual(result.quotaSnapshots, []);
    assert.equal(result.stats.home, home);
  });

  it("joins tokens from the unified log with the model from the turn timeline", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
      sessions: [{ events: [turnStarted("2026-08-02T18:35:40.000Z", "grok-4.5")] }],
    });
    const { records } = await collect(home);
    assert.equal(records.length, 1);
    const record = records[0]!;
    assert.equal(record.id, `grok:${SESSION}:2026-08-02T18:36:02.784Z:1`);
    assert.equal(record.usageSourceId, "grok-build-local");
    assert.equal(record.harnessId, "grok-build");
    assert.equal(record.source, "grok-build-local");
    assert.equal(record.sourceHostId, "host-1");
    assert.equal(record.provider, "xai");
    assert.equal(record.model, "grok-4.5");
    assert.equal(record.timestamp, "2026-08-02T18:36:02.784Z");
    assert.equal(record.sessionId, SESSION);
    assert.equal(record.inputTokens, 14_787);
    assert.equal(record.cachedInputTokens, 3712);
    assert.equal(record.outputTokens, 450);
    assert.equal(record.reasoningOutputTokens, 382);
    assert.equal(record.totalTokens, 14_787 + 450);
    // Cache writes are unobservable in this source: unavailable, never zero.
    assert.equal(record.cacheCreationInputTokens, undefined);
    assert.equal(record.reasoningLevel, undefined);
  });

  it("attributes each inference to the model in effect at its timestamp", async () => {
    const home = await writeHome({
      unified: [
        inferenceLine("2026-08-02T18:36:02.784Z"),
        inferenceLine("2026-08-02T18:40:10.000Z", {}, {}),
      ],
      sessions: [
        {
          events: [
            turnStarted("2026-08-02T18:35:40.000Z", "grok-4.5", 1),
            turnStarted("2026-08-02T18:39:00.000Z", "grok-4.3-mini", 2),
          ],
        },
      ],
    });
    const { records } = await collect(home);
    assert.deepEqual(
      records.map((record) => record.model),
      ["grok-4.5", "grok-4.3-mini"],
    );
  });

  it("joins on instants, not string shapes, when timestamp precision differs", async () => {
    // A turn stamped at a whole second must still precede an inference later in
    // that same second: lexicographically "…00Z" > "…00.500Z", so a string join
    // would hand this inference to the previous turn's model.
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T19:00:00.500Z")],
      sessions: [
        {
          events: [
            turnStarted("2026-08-02T18:00:00Z", "grok-4.3-mini", 1),
            turnStarted("2026-08-02T19:00:00Z", "grok-4.5", 2),
          ],
        },
      ],
    });
    const { records } = await collect(home);
    assert.equal(records[0]!.model, "grok-4.5");
  });

  it("falls back to the summary's current model when the timeline is missing", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
      sessions: [{ summary: { current_model_id: "grok-4.5" } }],
    });
    const { records } = await collect(home);
    assert.equal(records[0]!.model, "grok-4.5");
  });

  it("records the model as unknown rather than guessing when no session metadata survives", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
    });
    const { records } = await collect(home);
    assert.equal(records[0]!.model, "unknown");
  });

  it("names the task from the session's generated title", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
      sessions: [{ summary: { generated_title: "Refactor the widget factory" } }],
    });
    const { records } = await collect(home);
    assert.equal(records[0]!.taskName, "Refactor the widget factory");
  });

  it("labels an untitled session by its short session id", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
    });
    const { records } = await collect(home);
    assert.equal(records[0]!.taskName, "Grok session 019fc3c2");
  });

  it("counts a replayed inference line once", async () => {
    const home = await writeHome({
      unified: [
        inferenceLine("2026-08-02T18:36:02.784Z"),
        inferenceLine("2026-08-02T18:36:02.784Z"),
      ],
    });
    const { records } = await collect(home);
    assert.equal(records.length, 1);
  });

  it("keeps importing past malformed and irrelevant log lines", async () => {
    const home = await writeHome({
      unified: [
        "{not json",
        { ts: "2026-08-02T18:35:00.000Z", msg: "auth started" },
        { ts: "2026-08-02T18:35:01.000Z", msg: "shell.turn.inference_done" },
        inferenceLine("2026-08-02T18:36:02.784Z"),
      ],
    });
    const { records } = await collect(home);
    assert.equal(records.length, 1);
  });

  it("emits records the strict contract accepts", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
      sessions: [{ events: [turnStarted("2026-08-02T18:35:40.000Z", "grok-4.5")] }],
    });
    const { records } = await collect(home);
    assert.doesNotThrow(() => usageRecordSchema.parse(records[0]));
  });

  it("observes the plan without inventing a meter when the free tier caps nothing", async () => {
    const home = await writeHome({
      unified: [billingLine("2026-08-02T18:35:33.700Z", { cap: 0, used: 0, tier: "Free" })],
    });
    const { quotaSnapshots } = await collect(home);
    assert.equal(quotaSnapshots.length, 1);
    const snapshot = quotaSnapshots[0]!;
    assert.equal(snapshot.usageSourceId, "grok-build-local");
    assert.equal(snapshot.sourceHostId, "host-1");
    assert.equal(snapshot.plan, "Free");
    assert.equal(snapshot.observedAt, "2026-08-02T18:35:33.700Z");
    assert.deepEqual(snapshot.windows, []);
    assert.doesNotThrow(() => usageQuotaSnapshotSchema.parse(snapshot));
  });

  it("meters the weekly on-demand window when a positive cap exists", async () => {
    const home = await writeHome({
      unified: [billingLine("2026-08-02T18:35:33.700Z", { cap: 400, used: 100, tier: "Pro" })],
    });
    const { quotaSnapshots } = await collect(home);
    const window = quotaSnapshots[0]!.windows[0]!;
    assert.equal(window.id, "on-demand");
    assert.equal(window.kind, "weekly");
    assert.equal(window.label, "Weekly window");
    assert.equal(window.usedPercent, 25);
    assert.equal(window.windowMinutes, 10_080);
    assert.equal(window.resetsAt, "2026-08-08T00:00:00.000Z");
    assert.doesNotThrow(() => usageQuotaSnapshotSchema.parse(quotaSnapshots[0]));
  });

  it("keeps only the freshest billing observation", async () => {
    const home = await writeHome({
      unified: [
        billingLine("2026-08-02T10:00:00.000Z", { cap: 0, used: 0, tier: "Free" }),
        billingLine("2026-08-02T18:35:33.700Z", { cap: 0, used: 0, tier: "Pro" }),
      ],
    });
    const { quotaSnapshots } = await collect(home);
    assert.equal(quotaSnapshots.length, 1);
    assert.equal(quotaSnapshots[0]!.plan, "Pro");
  });

  it("serves an unchanged home from cache without re-reading the log", async () => {
    const home = await writeHome({
      unified: [
        inferenceLine("2026-08-02T18:36:02.784Z"),
        billingLine("2026-08-02T18:35:33.700Z", { cap: 0, used: 0, tier: "Free" }),
      ],
      sessions: [{ events: [turnStarted("2026-08-02T18:35:40.000Z", "grok-4.5")] }],
    });
    const first = await collect(home);
    assert.equal(first.stats.parsedLog, true);
    const second = await collect(home, first.state);
    assert.equal(second.stats.parsedLog, false);
    assert.deepEqual(second.records, first.records);
    assert.deepEqual(second.quotaSnapshots, first.quotaSnapshots);
  });

  it("re-reads when the log grows and imports the new inference", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
    });
    const first = await collect(home);
    await fs.appendFile(
      join(home, "logs", "unified.jsonl"),
      `\n${JSON.stringify(inferenceLine("2026-08-02T18:41:00.000Z", {}, {}))}`,
      "utf8",
    );
    const second = await collect(home, first.state);
    assert.equal(second.stats.parsedLog, true);
    assert.equal(second.records.length, 2);
  });

  it("re-reads when a session's metadata changes, not only the log", async () => {
    const home = await writeHome({
      unified: [inferenceLine("2026-08-02T18:36:02.784Z")],
      sessions: [{ summary: { generated_title: "First title" } }],
    });
    const first = await collect(home);
    assert.equal(first.records[0]!.taskName, "First title");
    const directory = join(home, "sessions", "C%3A%5Cdev%5Cproject", SESSION);
    const summary = JSON.parse(await fs.readFile(join(directory, "summary.json"), "utf8"));
    summary.generated_title = "A better, much longer title";
    await fs.writeFile(join(directory, "summary.json"), JSON.stringify(summary), "utf8");
    const second = await collect(home, first.state);
    assert.equal(second.records[0]!.taskName, "A better, much longer title");
  });
});

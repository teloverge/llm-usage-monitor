import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelPrice, UsageRecord } from "@llm-usage-monitor/contracts";
import { analyzeHistory } from "@llm-usage-monitor/usage-analysis";
import { mergeDefaultPrices } from "../src/default-prices.ts";

describe("default prices", () => {
  it("adds new catalog models without overwriting a configured price", () => {
    const configured: ModelPrice = {
      provider: "openai",
      model: "gpt-5.4",
      input: 99,
      cachedInput: 9,
      output: 999,
      source: "user",
      effectiveDate: "2026-07-23",
    };
    const merged = mergeDefaultPrices([configured]);
    assert.deepEqual(
      merged.find((price) => price.model === "gpt-5.4"),
      configured,
    );
    assert.deepEqual(
      merged.find((price) => price.model === "codex-auto-review"),
      {
        provider: "openai",
        model: "codex-auto-review",
        input: 2.5,
        cachedInput: 0.25,
        output: 15,
        source:
          "https://www.getmaxim.ai/bifrost/llm-cost-calculator/provider/openai/model/codex-auto-review",
        effectiveDate: "2026-07-22",
      },
    );
  });

  it("adds the Claude models Claude Code reports that the first Claude catalog lacked", () => {
    const existing: ModelPrice = {
      provider: "anthropic",
      model: "claude-opus-5",
      input: 5,
      cachedInput: 0.5,
      cacheWrite: 6.25,
      output: 25,
      source: "user",
      effectiveDate: "2026-07-26",
    };
    const merged = mergeDefaultPrices([existing]);
    assert.deepEqual(
      merged.find((price) => price.model === "claude-fable-5-1"),
      {
        provider: "anthropic",
        model: "claude-fable-5-1",
        input: 10,
        cachedInput: 0.25,
        cacheWrite: 12.5,
        output: 50,
        source: "https://openrouter.ai/api/v1/models",
        effectiveDate: "2026-09-02",
      },
    );
    assert.equal(merged.find((price) => price.model === "claude-haiku-4-5")?.output, 5);
  });

  it("reaches an existing catalog with a newly supported provider's rates", () => {
    // Without this an install predating Claude support imports Claude records and
    // prices every one of them at zero, because it already has configured prices.
    const merged = mergeDefaultPrices([
      {
        provider: "openai",
        model: "gpt-5.4",
        input: 99,
        cachedInput: 9,
        output: 999,
        source: "user",
        effectiveDate: "2026-07-23",
      },
    ]);
    assert.deepEqual(
      merged.find((price) => price.model === "claude-opus-5"),
      {
        provider: "anthropic",
        model: "claude-opus-5",
        input: 5,
        cachedInput: 0.5,
        cacheWrite: 6.25,
        output: 25,
        source: "https://openrouter.ai/api/v1/models",
        effectiveDate: "2026-07-26",
      },
    );
  });

  it("reaches an existing catalog with xAI's rates", () => {
    // Same reasoning as the Claude case: an install predating Grok Build support
    // must not price every grok record at zero.
    const merged = mergeDefaultPrices([
      {
        provider: "openai",
        model: "gpt-5.4",
        input: 99,
        cachedInput: 9,
        output: 999,
        source: "user",
        effectiveDate: "2026-07-23",
      },
    ]);
    assert.deepEqual(
      merged.find((price) => price.provider === "xai"),
      {
        provider: "xai",
        model: "grok-4.5",
        input: 2,
        cachedInput: 0.5,
        output: 6,
        source: "https://openrouter.ai/x-ai/grok-4.5",
        effectiveDate: "2026-08-02",
      },
    );
  });

  it("does not resurrect a default the user edited away from", () => {
    const edited: ModelPrice = {
      provider: "anthropic",
      model: "claude-opus-5",
      input: 1,
      cachedInput: 0.1,
      cacheWrite: 1.25,
      output: 5,
      source: "user",
      effectiveDate: "2026-07-26",
    };
    const merged = mergeDefaultPrices([edited]);
    assert.deepEqual(
      merged.filter((price) => price.model === "claude-opus-5"),
      [edited],
    );
  });

  it("keeps the OpenAI catalog out of the additive path", () => {
    const merged = mergeDefaultPrices([
      {
        provider: "openai",
        model: "gpt-5.4",
        input: 99,
        cachedInput: 9,
        output: 999,
        source: "user",
        effectiveDate: "2026-07-23",
      },
    ]);
    assert.equal(
      merged.some((price) => price.model === "gpt-5"),
      false,
    );
  });
});

describe("GPT-6 Astra pricing", () => {
  const existing: ModelPrice = {
    provider: "openai",
    model: "gpt-5.4",
    input: 2.5,
    cachedInput: 0.25,
    output: 15,
    source: "user",
    effectiveDate: "2026-07-10",
  };
  const astra: UsageRecord = {
    id: "astra:1",
    usageSourceId: "codex-local",
    harnessId: "codex",
    sourceHostId: "host:test",
    sessionId: "session:astra",
    timestamp: "2026-09-04T12:00:00Z",
    taskName: "Astra task",
    provider: "openai",
    model: "gpt-6-astra",
    modeFlags: { ultra: false, fast: false },
    inputTokens: 1500,
    cachedInputTokens: 1000,
    cacheCreationInputTokens: 100,
    outputTokens: 100,
    totalTokens: 1600,
    lastTokenUsage: null,
    source: "test",
  };

  it("prices Astra history on fresh and existing installs at OpenRouter's standard rates", () => {
    for (const configured of [[], [existing]]) {
      const prices = mergeDefaultPrices(configured);
      const group = analyzeHistory([astra], prices).groups[0];
      assert.equal(group?.estimatedCost, 0.01125);
      assert.equal(group?.sessions[0]?.estimatedCost, 0.01125);
      assert.deepEqual(
        prices.find((price) => price.model === "gpt-6-astra"),
        {
          provider: "openai",
          model: "gpt-6-astra",
          input: 10,
          cachedInput: 1,
          cacheWrite: 12.5,
          output: 50,
          source: "https://openrouter.ai/api/v1/models",
          effectiveDate: "2026-09-04",
        },
      );
    }
  });

  it("preserves custom Astra rates and does not duplicate them on restart", () => {
    const custom: ModelPrice = { ...existing, model: "gpt-6-astra", input: 99 };
    const prices = mergeDefaultPrices([custom]);
    assert.deepEqual(
      prices.filter((price) => price.model === "gpt-6-astra"),
      [custom],
    );
    assert.deepEqual(mergeDefaultPrices(prices), prices);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelPrice } from "@llm-usage-monitor/contracts";
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

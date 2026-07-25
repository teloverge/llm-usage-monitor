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
});

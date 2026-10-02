import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ModelPrice, UsageRecord } from "@llm-usage-monitor/contracts";
import { createMissingPriceDownloader } from "../src/download-missing-prices.ts";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

const record = (provider: string, model: string): UsageRecord => ({
  id: `${provider}:${model}`,
  sourceHostId: "local",
  usageSourceId: "test",
  harnessId: "test",
  timestamp: "2026-09-26T00:00:00.000Z",
  taskName: "test",
  provider,
  model,
  modeFlags: { ultra: false, fast: false },
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  lastTokenUsage: null,
  source: "test",
});

function ledger(records: UsageRecord[], initial: ModelPrice[] = []) {
  let prices = initial;
  return {
    records: () => records,
    prices: () => prices,
    replacePrices: (next: ModelPrice[]) => {
      prices = next;
    },
  };
}

/** A fake catalog endpoint that counts its calls. */
function catalog(data: unknown[]) {
  const calls: string[] = [];
  const fetchCatalog = (async (url: string) => {
    calls.push(url);
    return Response.json({ data });
  }) as typeof fetch;
  return { calls, fetchCatalog };
}

const configured: ModelPrice = {
  provider: "openai",
  model: "gpt-known",
  input: 99,
  cachedInput: 9,
  output: 999,
  source: "user",
  effectiveDate: "2026-01-01",
};

describe("missing-price downloader", () => {
  it("prices newly observed models and leaves configured prices alone", async () => {
    const store = ledger(
      [
        record("openai", "gpt-known"),
        record("openai", "gpt-new-20260922"),
        record("anthropic", "claude-new-4-5"),
        record("xai", "grok-new"),
      ],
      [configured],
    );
    const { calls, fetchCatalog } = catalog([
      {
        id: "openai/gpt-new",
        pricing: {
          prompt: "0.000002",
          completion: "0.000010",
          input_cache_read: "0.0000002",
          input_cache_write: "0.0000025",
        },
      },
      { id: "anthropic/claude-new-4.5", pricing: { prompt: "0.000003", completion: "0.000015" } },
      { id: "x-ai/grok-new", pricing: { prompt: "0.000001", completion: "0.000005" } },
      // A configured model's catalog rate must not override the user's card.
      { id: "openai/gpt-known", pricing: { prompt: "0.000001", completion: "0.000001" } },
    ]);
    const downloader = createMissingPriceDownloader({ fetchCatalog, now: () => 0 });

    assert.equal(await downloader.run(store), 3);
    assert.deepEqual(calls, [CATALOG_URL]);
    const [kept, ...added] = store.prices();
    assert.deepEqual(kept, configured);
    assert.deepEqual(
      added.map(({ provider, model, input, cachedInput, cacheWrite, output, source }) => ({
        provider,
        model,
        input,
        cachedInput,
        cacheWrite,
        output,
        source,
      })),
      [
        {
          provider: "openai",
          model: "gpt-new-20260922",
          input: 2,
          cachedInput: 0.2,
          cacheWrite: 2.5,
          output: 10,
          source: CATALOG_URL,
        },
        {
          provider: "anthropic",
          model: "claude-new-4-5",
          input: 3,
          // No cache-read rate listed: cached input is charged at the base rate.
          cachedInput: 3,
          cacheWrite: undefined,
          output: 15,
          source: CATALOG_URL,
        },
        {
          provider: "xai",
          model: "grok-new",
          input: 1,
          cachedInput: 1,
          cacheWrite: undefined,
          output: 5,
          source: CATALOG_URL,
        },
      ],
    );

    // Everything is priced now, so the next run makes no request.
    assert.equal(await downloader.run(store), 0);
    assert.equal(calls.length, 1);
  });

  it("makes no request when every model is priced", async () => {
    const { calls, fetchCatalog } = catalog([]);
    const downloader = createMissingPriceDownloader({ fetchCatalog });
    assert.equal(await downloader.run(ledger([record("openai", "gpt-known")], [configured])), 0);
    assert.equal(calls.length, 0);
  });

  it("matches providers the way pricing does, so a Codex alias is looked up as OpenAI", async () => {
    const store = ledger([record("codex", "gpt-new")]);
    const { fetchCatalog } = catalog([
      { id: "openai/gpt-new", pricing: { prompt: "0.000002", completion: "0.00001" } },
    ]);
    assert.equal(await createMissingPriceDownloader({ fetchCatalog }).run(store), 1);
  });

  it("never looks up local runtimes or a model named unknown", async () => {
    const store = ledger([
      record("ollama", "gemma4:e4b"),
      record("lemonade", "Qwen3.8-27B"),
      record("xai", "unknown"),
    ]);
    const { calls, fetchCatalog } = catalog([]);
    assert.equal(await createMissingPriceDownloader({ fetchCatalog }).run(store), 0);
    assert.equal(calls.length, 0);
  });

  it("waits an hour before looking up a model the catalog could not price", async () => {
    const store = ledger([record("openai", "gpt-unlisted")]);
    const { calls, fetchCatalog } = catalog([
      // Only a routing variant is listed, which is not the model's own rate.
      { id: "openai/gpt-unlisted:free", pricing: { prompt: "0", completion: "0" } },
    ]);
    let clock = 0;
    const downloader = createMissingPriceDownloader({ fetchCatalog, now: () => clock });

    assert.equal(await downloader.run(store), 0);
    clock += 30 * 60 * 1_000;
    assert.equal(await downloader.run(store), 0);
    assert.equal(calls.length, 1, "no second request within the hour");
    clock += 31 * 60 * 1_000;
    assert.equal(await downloader.run(store), 0);
    assert.equal(calls.length, 2, "looked up again once the hour has passed");
    assert.deepEqual(store.prices(), []);
  });

  it("retries on the next run after a failed download", async () => {
    const store = ledger([record("openai", "gpt-new")]);
    let calls = 0;
    const fetchCatalog = (async () => {
      calls++;
      return new Response(null, { status: 503 });
    }) as typeof fetch;
    const downloader = createMissingPriceDownloader({ fetchCatalog, now: () => 0 });
    await assert.rejects(downloader.run(store), /503/);
    await assert.rejects(downloader.run(store), /503/);
    assert.equal(calls, 2, "a failure proves nothing about the model, so it stays due");
    assert.deepEqual(store.prices(), []);
  });

  it("shares one download between overlapping runs", async () => {
    const store = ledger([record("openai", "gpt-new")]);
    const { calls, fetchCatalog } = catalog([
      { id: "openai/gpt-new", pricing: { prompt: "0.000002", completion: "0.00001" } },
    ]);
    const downloader = createMissingPriceDownloader({ fetchCatalog });
    const [first, second] = await Promise.all([downloader.run(store), downloader.run(store)]);
    assert.equal(calls.length, 1);
    assert.equal(first, 1);
    assert.equal(second, 1);
    assert.equal(store.prices().length, 1);
  });

  it("keeps a price saved while the download was in flight", async () => {
    const store = ledger([record("openai", "gpt-new"), record("openai", "gpt-other")]);
    const saved: ModelPrice = { ...configured, model: "gpt-new", input: 7, source: "user" };
    const fetchCatalog = (async () => {
      // The user prices gpt-new in Settings while the catalog is downloading.
      store.replacePrices([saved]);
      return Response.json({
        data: [
          { id: "openai/gpt-new", pricing: { prompt: "0.000002", completion: "0.00001" } },
          { id: "openai/gpt-other", pricing: { prompt: "0.000003", completion: "0.00002" } },
        ],
      });
    }) as typeof fetch;
    assert.equal(await createMissingPriceDownloader({ fetchCatalog }).run(store), 1);
    assert.deepEqual(
      store.prices().map((price) => [price.model, price.input]),
      [
        ["gpt-new", 7],
        ["gpt-other", 3],
      ],
    );
  });
});

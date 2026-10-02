import type { ModelPrice, UsageRecord } from "@llm-usage-monitor/contracts";
import {
  calculateCost,
  normalizeModel,
  normalizeProvider,
} from "@llm-usage-monitor/usage-analysis";

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

/**
 * Ledger provider (as `normalizeProvider` returns it) → OpenRouter's author
 * slug, the part of a catalog id before the slash. A provider not listed here
 * is never looked up: local runtimes such as `ollama` and `lemonade` serve
 * models OpenRouter does not sell, and guessing an author would attach some
 * other vendor's rate to them.
 */
const AUTHORS: Record<string, string> = {
  openai: "openai",
  anthropic: "anthropic",
  xai: "x-ai",
  google: "google",
  deepseek: "deepseek",
  mistral: "mistralai",
};

/**
 * Model ids that name no model. Grok Build records a turn whose model it can
 * no longer determine as `unknown`; no catalog entry could ever price it, and
 * counting it as missing would refetch the catalog on every refresh.
 */
const UNNAMED_MODELS = new Set(["unknown", ""]);

/** How long a model the catalog could not price waits before it is looked up again. */
const RETRY_AFTER_MS = 60 * 60 * 1_000;

export interface PriceLedger {
  records(): UsageRecord[];
  prices(): ModelPrice[];
  replacePrices(prices: ModelPrice[]): void;
}

interface CatalogModel {
  id?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
    input_cache_read?: unknown;
    input_cache_write?: unknown;
  };
}

/**
 * Prices models the ledger has usage for but no rate card, from OpenRouter's
 * public catalog — so a model released after the defaults were written (a new
 * GPT or Claude version) is priced on the next refresh instead of reading
 * "Unpriced" until someone types its rates into Settings.
 *
 * Only ever ADDS cards. A configured price, including one the user edited, is
 * never replaced: the catalog is consulted for models with no card at all.
 *
 * The returned `run` is safe to call after every import:
 * - Concurrent calls share one in-flight run, so two imports finishing
 *   together download the catalog once.
 * - A model the catalog could not price is not looked up again for an hour,
 *   so an unlisted model does not cost a download on every refresh.
 * - Nothing to price means no request at all.
 */
export function createMissingPriceDownloader(
  options: {
    fetchCatalog?: typeof fetch;
    now?: () => number;
    retryAfterMs?: number;
  } = {},
) {
  const fetchCatalog = options.fetchCatalog ?? fetch;
  const now = options.now ?? Date.now;
  const retryAfterMs = options.retryAfterMs ?? RETRY_AFTER_MS;
  const lastLookup = new Map<string, number>();
  let inFlight: Promise<number> | null = null;

  async function download(ledger: PriceLedger): Promise<number> {
    const missing = missingModels(ledger.records(), ledger.prices());
    const due = [...missing].filter(([key]) => {
      const last = lastLookup.get(key);
      return last === undefined || now() - last >= retryAfterMs;
    });
    if (due.length === 0) return 0;

    const response = await fetchCatalog(CATALOG_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Model price download failed (${response.status}).`);
    const catalog: unknown = await response.json();
    if (!isCatalog(catalog)) throw new Error("Model price download returned an invalid catalog.");
    // Stamped only once the catalog was actually read: a failed download
    // proves nothing about the models, so they stay due for the next refresh.
    for (const [key] of due) lastLookup.set(key, now());

    const models = catalogIndex(catalog.data);
    const effectiveDate = new Date(now()).toISOString().slice(0, 10);
    const found: ModelPrice[] = [];
    for (const [key, record] of due) {
      const price = priceFrom(models.get(key), record, effectiveDate);
      if (price) found.push(price);
    }
    if (!found.length) return 0;

    // Re-read rather than reuse the list from before the download: a price
    // saved in Settings while the request was in flight must survive, and a
    // model priced meanwhile must not gain a second card.
    const current = ledger.prices();
    const added = found.filter((price) => calculateCost(sample(price), current) === null);
    if (added.length) ledger.replacePrices([...current, ...added]);
    return added.length;
  }

  return {
    run(ledger: PriceLedger): Promise<number> {
      if (!inFlight) {
        inFlight = download(ledger).finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}

/** One record per catalog key, for every unpriced record whose model could be on OpenRouter. */
function missingModels(records: UsageRecord[], prices: ModelPrice[]): Map<string, UsageRecord> {
  const missing = new Map<string, UsageRecord>();
  const checked = new Set<string>();
  for (const record of records) {
    const author = AUTHORS[normalizeProvider(record.provider)];
    if (!author || UNNAMED_MODELS.has(record.model.trim().toLowerCase())) continue;
    const key = `${author}/${normalizeModel(record.model)}`;
    // Pricing is decided per model, not per record, so each model is costed
    // once rather than once for every one of its thousands of records.
    if (checked.has(key)) continue;
    checked.add(key);
    if (calculateCost(record, prices) === null) missing.set(key, record);
  }
  return missing;
}

function catalogIndex(data: CatalogModel[]): Map<string, CatalogModel> {
  const models = new Map<string, CatalogModel>();
  for (const model of data) {
    // `:free`, `:beta` and similar suffixes are routing variants with their
    // own (often zero) price, not the model's list rate.
    if (typeof model?.id !== "string" || model.id.includes(":")) continue;
    const slash = model.id.indexOf("/");
    if (slash < 0) continue;
    const key = `${model.id.slice(0, slash)}/${normalizeModel(model.id.slice(slash + 1))}`;
    // Prefer the bare slug when the catalog also lists a dated version.
    if (!models.has(key) || model.id.toLowerCase() === key) models.set(key, model);
  }
  return models;
}

function priceFrom(
  model: CatalogModel | undefined,
  record: UsageRecord,
  effectiveDate: string,
): ModelPrice | null {
  const pricing = model?.pricing;
  const input = rate(pricing?.prompt);
  const output = rate(pricing?.completion);
  if (input === null || output === null) return null;
  const cachedInput = rate(pricing?.input_cache_read);
  const cacheWrite = rate(pricing?.input_cache_write);
  return {
    // The record's own spelling, so the card reads the way the dashboard
    // shows the model; matching is normalized either way.
    provider: record.provider,
    model: record.model,
    input,
    // A catalog entry with no cache-read rate does not discount cached input,
    // so it is charged at the base rate rather than treated as free.
    cachedInput: cachedInput ?? input,
    ...(cacheWrite === null ? {} : { cacheWrite }),
    output,
    source: CATALOG_URL,
    effectiveDate,
  };
}

/** A minimal record carrying only what `calculateCost` matches on. */
function sample(price: ModelPrice): UsageRecord {
  return {
    id: "",
    sourceHostId: "",
    usageSourceId: "",
    harnessId: "",
    timestamp: "",
    taskName: "",
    provider: price.provider,
    model: price.model,
    modeFlags: { ultra: false, fast: false },
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    lastTokenUsage: null,
    source: "",
  };
}

/** OpenRouter quotes USD per token as a string; cards are USD per million tokens. */
function rate(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = Number(value) * 1_000_000;
  return Number.isFinite(amount) && amount >= 0 ? Number(amount.toPrecision(12)) : null;
}

function isCatalog(value: unknown): value is { data: CatalogModel[] } {
  return (
    typeof value === "object" && value !== null && "data" in value && Array.isArray(value.data)
  );
}

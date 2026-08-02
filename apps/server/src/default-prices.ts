import type { ModelPrice } from "@llm-usage-monitor/contracts";

const OPENAI_DEFAULT_PRICES: ModelPrice[] = [
  ["gpt-5.6-sol", 5, 0.5, 30],
  ["gpt-5.6-terra", 2.5, 0.25, 15],
  ["gpt-5.6-luna", 1, 0.1, 6],
  ["gpt-5.5", 5, 0.5, 30],
  ["gpt-5.4", 2.5, 0.25, 15],
  ["gpt-5.4-mini", 0.75, 0.075, 4.5],
  ["gpt-5.2", 1.75, 0.175, 14],
  ["gpt-5.1", 1.25, 0.125, 10],
  ["gpt-5", 1.25, 0.125, 10],
  ["gpt-5-mini", 0.25, 0.025, 2],
  ["gpt-4.1", 2, 0.5, 8],
  ["gpt-4o", 2.5, 1.25, 10],
  ["o3", 2, 0.5, 8],
  ["o4-mini", 1.1, 0.275, 4.4],
].map(([model, input, cachedInput, output]) => ({
  provider: "openai",
  model: String(model),
  input: Number(input),
  cachedInput: Number(cachedInput),
  output: Number(output),
  source: "https://platform.openai.com/docs/pricing",
  effectiveDate: "2026-07-10",
}));

/**
 * OpenRouter's cheapest listed rate per model, which for these is the standard
 * (non-"fast") variant. Claude Code reports a bare model id like "claude-opus-5",
 * so the "anthropic/" routing prefix is dropped here to match.
 *
 * The four columns are genuinely four different rates: a cache read costs a tenth
 * of base input, a cache write costs a quarter more than it. Collapsing the two
 * cache figures into one would misprice a Claude record by a wide margin in
 * whichever direction the session happened to lean.
 */
const ANTHROPIC_DEFAULT_PRICES: ModelPrice[] = [
  ["claude-opus-5", 5, 0.5, 6.25, 25],
  ["claude-opus-5-fast", 10, 1, 12.5, 50],
  ["claude-sonnet-5", 2, 0.2, 2.5, 10],
  ["claude-opus-4.8", 5, 0.5, 6.25, 25],
  ["claude-opus-4.8-fast", 10, 1, 12.5, 50],
  ["claude-fable-5", 10, 1, 12.5, 50],
].map(([model, input, cachedInput, cacheWrite, output]) => ({
  provider: "anthropic",
  model: String(model),
  input: Number(input),
  cachedInput: Number(cachedInput),
  cacheWrite: Number(cacheWrite),
  output: Number(output),
  source: "https://openrouter.ai/api/v1/models",
  effectiveDate: "2026-07-26",
}));

/**
 * OpenRouter's published rate for the model Grok Build ships with, per the
 * Grok Build spec (issue #8): the user chose OpenRouter as the rate source.
 * Cached input is the listed 75%-discount cache-read rate; Grok Build's local
 * metadata never reports cache writes, so no write rate is configured.
 */
const XAI_DEFAULT_PRICES: ModelPrice[] = [["grok-4.5", 2, 0.5, 6]].map(
  ([model, input, cachedInput, output]) => ({
    provider: "xai",
    model: String(model),
    input: Number(input),
    cachedInput: Number(cachedInput),
    output: Number(output),
    source: "https://openrouter.ai/x-ai/grok-4.5",
    effectiveDate: "2026-08-02",
  }),
);

export const DEFAULT_PRICES: ModelPrice[] = [
  ...OPENAI_DEFAULT_PRICES,
  ...ANTHROPIC_DEFAULT_PRICES,
  ...XAI_DEFAULT_PRICES,
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
];

/**
 * Defaults that may land in a catalog that already exists.
 *
 * The rest of DEFAULT_PRICES is deliberately NOT additive: an install that has
 * configured prices has already seen those models, so re-adding one would
 * resurrect a row the user chose to delete. These are the entries that shipped
 * after the initial catalog, which no existing install can have decided about.
 * A whole new provider is the clearest case — without this, every install that
 * predates Claude support would import Claude records and price them all at zero.
 */
function isAdditiveDefault(price: ModelPrice): boolean {
  return (
    price.provider === "anthropic" ||
    price.provider === "xai" ||
    price.model === "codex-auto-review"
  );
}

export function mergeDefaultPrices(configured: ModelPrice[]): ModelPrice[] {
  if (configured.length === 0) return [...DEFAULT_PRICES];
  const configuredKeys = new Set(configured.map(priceKey));
  return [
    ...configured,
    ...DEFAULT_PRICES.filter(
      (price) => isAdditiveDefault(price) && !configuredKeys.has(priceKey(price)),
    ),
  ];
}

function priceKey(price: ModelPrice): string {
  return `${price.provider.trim().toLocaleLowerCase()}\u0000${price.model.trim().toLocaleLowerCase()}`;
}

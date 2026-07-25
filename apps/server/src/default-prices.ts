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

export const DEFAULT_PRICES: ModelPrice[] = [
  ...OPENAI_DEFAULT_PRICES,
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

export function mergeDefaultPrices(configured: ModelPrice[]): ModelPrice[] {
  if (configured.length === 0) return [...DEFAULT_PRICES];
  const configuredKeys = new Set(configured.map(priceKey));
  const additiveDefaults = DEFAULT_PRICES.filter((price) => price.model === "codex-auto-review");
  return [
    ...configured,
    ...additiveDefaults.filter((price) => !configuredKeys.has(priceKey(price))),
  ];
}

function priceKey(price: ModelPrice): string {
  return `${price.provider.trim().toLocaleLowerCase()}\u0000${price.model.trim().toLocaleLowerCase()}`;
}

'use strict';

const DEFAULT_PRICES = [
  { provider: 'openai', model: 'gpt-5.6-sol', input: 5, cachedInput: 0.5, output: 30, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.6-terra', input: 2.5, cachedInput: 0.25, output: 15, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.6-luna', input: 1, cachedInput: 0.1, output: 6, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.5', input: 5, cachedInput: 0.5, output: 30, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.4', input: 2.5, cachedInput: 0.25, output: 15, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.4-mini', input: 0.75, cachedInput: 0.075, output: 4.5, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.2', input: 1.75, cachedInput: 0.175, output: 14, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5.1', input: 1.25, cachedInput: 0.125, output: 10, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5', input: 1.25, cachedInput: 0.125, output: 10, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-5-mini', input: 0.25, cachedInput: 0.025, output: 2, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-4.1', input: 2, cachedInput: 0.5, output: 8, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'gpt-4o', input: 2.5, cachedInput: 1.25, output: 10, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'o3', input: 2, cachedInput: 0.5, output: 8, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' },
  { provider: 'openai', model: 'o4-mini', input: 1.1, cachedInput: 0.275, output: 4.4, source: 'https://platform.openai.com/docs/pricing', effectiveDate: '2026-07-10' }
];

function normalizeModel(model) {
  return String(model || 'unknown').trim().toLowerCase();
}

function normalizeProvider(provider) {
  const value = String(provider || 'unknown').trim().toLowerCase();
  return value === 'openai-api' || value === 'codex' ? 'openai' : value;
}

function findPrice(prices, provider, model) {
  const p = normalizeProvider(provider);
  const m = normalizeModel(model);
  return prices.find((price) => normalizeProvider(price.provider) === p && normalizeModel(price.model) === m);
}

function calculateCost(record, prices) {
  const price = findPrice(prices, record.provider, record.model);
  if (!price) return { cost: null, price: null };
  const input = Math.max(0, Number(record.inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(record.cachedInputTokens) || 0));
  const output = Math.max(0, Number(record.outputTokens) || 0);
  const cost = ((input - cached) * price.input + cached * price.cachedInput + output * price.output) / 1_000_000;
  return { cost, price };
}

module.exports = { DEFAULT_PRICES, calculateCost, findPrice, normalizeModel, normalizeProvider };

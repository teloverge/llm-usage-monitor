'use strict';

const { DEFAULT_PRICES, calculateCost } = require('./pricing');

const RECORDS_KEY = 'usageRecords.v1';
const PRICES_KEY = 'modelPrices.v1';
const IMPORT_STATE_KEY = 'providerImportState.v1';

class UsageStore {
  constructor(context, getRetentionDays) {
    this.context = context;
    this.getRetentionDays = getRetentionDays;
  }

  getRecords() {
    return this.context.globalState.get(RECORDS_KEY, []);
  }

  getPrices() {
    return this.context.globalState.get(PRICES_KEY, DEFAULT_PRICES);
  }

  getImportState() {
    return this.context.globalState.get(IMPORT_STATE_KEY, {});
  }

  async setImportState(state) {
    await this.context.globalState.update(IMPORT_STATE_KEY, state);
  }

  async upsert(records) {
    const byId = new Map(this.getRecords().map((record) => [record.id, record]));
    for (const record of records) {
      if (!record || !record.id || !record.timestamp) continue;
      byId.set(record.id, sanitizeRecord(record));
    }
    const retained = retainAndSort([...byId.values()], this.getRetentionDays());
    await this.context.globalState.update(RECORDS_KEY, retained);
    return retained;
  }

  async replacePrices(prices) {
    const clean = Array.isArray(prices) ? prices.map(sanitizePrice).filter(Boolean) : DEFAULT_PRICES;
    await this.context.globalState.update(PRICES_KEY, clean);
    return clean;
  }

  async prune() {
    const retained = retainAndSort(this.getRecords(), this.getRetentionDays());
    await this.context.globalState.update(RECORDS_KEY, retained);
    return retained;
  }

  async clear() {
    await this.context.globalState.update(RECORDS_KEY, []);
    await this.context.globalState.update(IMPORT_STATE_KEY, {});
  }

  getSnapshot() {
    const prices = this.getPrices();
    const records = this.getRecords().map((record) => {
      const { cost, price } = calculateCost(record, prices);
      return { ...record, estimatedCost: cost, priceEffectiveDate: price?.effectiveDate || null };
    });
    return { records, prices };
  }
}

function sanitizeRecord(record) {
  const nonnegative = (value) => Math.max(0, Math.round(Number(value) || 0));
  const tokens = (value) => ({
    inputTokens: nonnegative(value?.inputTokens),
    cachedInputTokens: nonnegative(value?.cachedInputTokens),
    outputTokens: nonnegative(value?.outputTokens),
    reasoningOutputTokens: nonnegative(value?.reasoningOutputTokens),
    totalTokens: nonnegative(value?.totalTokens)
  });
  return {
    id: String(record.id),
    timestamp: new Date(record.timestamp).toISOString(),
    taskName: String(record.taskName || 'Untitled task').slice(0, 500),
    provider: String(record.provider || 'unknown').toLowerCase(),
    model: String(record.model || 'unknown'),
    reasoningLevel: String(record.reasoningLevel || 'unknown'),
    inputTokens: nonnegative(record.inputTokens),
    cachedInputTokens: nonnegative(record.cachedInputTokens),
    outputTokens: nonnegative(record.outputTokens),
    reasoningOutputTokens: nonnegative(record.reasoningOutputTokens),
    totalTokens: nonnegative(record.totalTokens),
    lastTokenUsage: record.lastTokenUsage && typeof record.lastTokenUsage === 'object' ? tokens(record.lastTokenUsage) : null,
    modelContextWindowTokens: nonnegative(record.modelContextWindowTokens),
    rateLimits: sanitizeRateLimits(record.rateLimits),
    source: String(record.source || 'import'),
    sessionId: record.sessionId ? String(record.sessionId) : undefined,
    turnId: record.turnId ? String(record.turnId) : undefined
  };
}

function sanitizeRateLimits(value) {
  if (!value || typeof value !== 'object') return null;
  const text = (item) => item === null || item === undefined ? '' : String(item).slice(0, 200);
  const number = (item) => Math.max(0, Number(item) || 0);
  const integer = (item) => Math.round(number(item));
  const window = (item) => item && typeof item === 'object' ? {
    usedPercent: number(item.usedPercent),
    windowMinutes: integer(item.windowMinutes),
    resetsAt: integer(item.resetsAt)
  } : null;
  return {
    limitId: text(value.limitId),
    limitName: text(value.limitName),
    planType: text(value.planType),
    rateLimitReachedType: text(value.rateLimitReachedType),
    primary: window(value.primary),
    secondary: window(value.secondary),
    credits: value.credits && typeof value.credits === 'object' ? {
      hasCredits: Boolean(value.credits.hasCredits),
      unlimited: Boolean(value.credits.unlimited),
      balance: number(value.credits.balance)
    } : null,
    individualLimit: value.individualLimit && typeof value.individualLimit === 'object' ? {
      limitId: text(value.individualLimit.limitId),
      limitName: text(value.individualLimit.limitName),
      usedPercent: number(value.individualLimit.usedPercent),
      windowMinutes: integer(value.individualLimit.windowMinutes),
      resetsAt: integer(value.individualLimit.resetsAt)
    } : null
  };
}

function sanitizePrice(price) {
  if (!price || !price.provider || !price.model) return null;
  const rate = (value) => Math.max(0, Number(value) || 0);
  return {
    provider: String(price.provider).toLowerCase(),
    model: String(price.model),
    input: rate(price.input),
    cachedInput: rate(price.cachedInput),
    output: rate(price.output),
    source: String(price.source || 'Custom'),
    effectiveDate: String(price.effectiveDate || new Date().toISOString().slice(0, 10))
  };
}

function retainAndSort(records, durationDays) {
  const cutoff = Date.now() - Math.max(1, Number(durationDays) || 90) * 86_400_000;
  return records
    .filter((record) => Date.parse(record.timestamp) >= cutoff)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

module.exports = { UsageStore, sanitizeRecord, sanitizeRateLimits, retainAndSort };

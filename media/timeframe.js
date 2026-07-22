'use strict';

(function exposeTimeframe(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UsageTimeframe = api;
}(typeof globalThis === 'object' ? globalThis : this, function createTimeframeApi() {
  function resetWindowStart(records, windowKey, options = {}) {
    const now = Number(options.now) || Date.now();
    const fallbackMinutes = Math.max(1, Number(options.fallbackMinutes) || 1);
    const relevant = records.filter((record) =>
      (!options.provider || record.provider === options.provider) &&
      (!options.model || record.model === options.model) &&
      (!options.reasoningLevel || record.reasoningLevel === options.reasoningLevel)
    ).sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
    const snapshot = relevant.find((record) => Number(record.rateLimits?.[windowKey]?.windowMinutes) > 0)?.rateLimits?.[windowKey];
    const windowMinutes = Number(snapshot?.windowMinutes) || fallbackMinutes;
    const duration = windowMinutes * 60_000;
    let nextReset = Number(snapshot?.resetsAt) * 1000;
    if (!Number.isFinite(nextReset) || nextReset <= 0) return { timestamp: now - duration, windowMinutes, inferred: true };
    if (nextReset <= now) nextReset += (Math.floor((now - nextReset) / duration) + 1) * duration;
    return { timestamp: nextReset - duration, windowMinutes, inferred: false };
  }

  return { resetWindowStart };
}));

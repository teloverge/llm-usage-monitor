'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReport, filterRecords } = require('../src/report');

const records = [{ id: '1', timestamp: '2026-07-10T12:00:00Z', taskName: '<script>alert(1)</script>', provider: 'openai', model: 'gpt-5.5', reasoningLevel: 'high', inputTokens: 100, cachedInputTokens: 50, outputTokens: 10, reasoningOutputTokens: 5, totalTokens: 110, lastTokenUsage: { inputTokens: 90, cachedInputTokens: 45, outputTokens: 10, reasoningOutputTokens: 5, totalTokens: 100 }, modelContextWindowTokens: 400000, rateLimits: { limitId: 'codex', planType: 'pro', primary: { usedPercent: 25, windowMinutes: 300, resetsAt: 1783738955 } }, estimatedCost: 0.001 }];

test('report is standalone, printable, and escapes task names', () => {
  const html = buildReport({ records, prices: [] }, {});
  assert.match(html, /<!doctype html>/);
  assert.match(html, /window\.print/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(html, /Reasoning output/);
  assert.match(html, /400,000 · 0\.0% used/);
  assert.match(html, /codex/);
  assert.match(html, /25\.0%/);
});

test('filters records by date and dimensions', () => {
  assert.equal(filterRecords(records, { from: '2026-07-10', provider: 'openai', query: 'script' }).length, 1);
  assert.equal(filterRecords(records, { to: '2026-07-09' }).length, 0);
});

test('filters records with timestamp-precise reset boundaries', () => {
  const result = filterRecords([
    { ...records[0], id: 'before', timestamp: '2026-07-10T09:59:59Z' },
    { ...records[0], id: 'after', timestamp: '2026-07-10T10:00:00Z' }
  ], { fromTimestamp: '2026-07-10T10:00:00Z', toTimestamp: '2026-07-10T12:00:00Z' });
  assert.deepEqual(result.map((record) => record.id), ['after']);
});

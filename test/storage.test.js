'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeRecord } = require('../src/storage');

test('sanitizes and retains extended LLM statistics', () => {
  const record = sanitizeRecord({
    id: 'record', timestamp: '2026-07-10T12:00:00Z',
    lastTokenUsage: { inputTokens: 10.4, cachedInputTokens: -2, outputTokens: 5, reasoningOutputTokens: 2, totalTokens: 15 },
    modelContextWindowTokens: 353400,
    rateLimits: {
      limitId: 'codex', planType: 'pro', rateLimitReachedType: 'primary',
      primary: { usedPercent: 24.5, windowMinutes: 300, resetsAt: 1783738955 },
      credits: { hasCredits: true, unlimited: false, balance: 12.5 }
    }
  });
  assert.equal(record.lastTokenUsage.inputTokens, 10);
  assert.equal(record.lastTokenUsage.cachedInputTokens, 0);
  assert.equal(record.modelContextWindowTokens, 353400);
  assert.equal(record.rateLimits.primary.usedPercent, 24.5);
  assert.equal(record.rateLimits.credits.balance, 12.5);
  assert.equal(record.rateLimits.rateLimitReachedType, 'primary');
});

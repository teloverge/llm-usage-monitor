'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCost } = require('../src/pricing');

test('calculates uncached, cached, and output cost without double billing reasoning', () => {
  const prices = [{ provider: 'openai', model: 'example', input: 2, cachedInput: 0.5, output: 10 }];
  const result = calculateCost({ provider: 'openai', model: 'example', inputTokens: 1_000_000, cachedInputTokens: 600_000, outputTokens: 100_000, reasoningOutputTokens: 80_000 }, prices);
  assert.equal(result.cost, 2.1);
});

test('returns null cost when no published rate is configured', () => {
  assert.equal(calculateCost({ provider: 'openai', model: 'internal-router' }, []).cost, null);
});

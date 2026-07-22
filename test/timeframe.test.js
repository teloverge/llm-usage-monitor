'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resetWindowStart } = require('../media/timeframe');

const hour = 60 * 60 * 1000;

test('derives primary and weekly window starts from the latest matching reset snapshot', () => {
  const now = Date.parse('2026-07-10T12:00:00Z');
  const records = [{
    timestamp: '2026-07-10T11:00:00Z', provider: 'openai', model: 'gpt', reasoningLevel: 'high',
    rateLimits: {
      primary: { windowMinutes: 300, resetsAt: Date.parse('2026-07-10T15:00:00Z') / 1000 },
      secondary: { windowMinutes: 10080, resetsAt: Date.parse('2026-07-13T00:00:00Z') / 1000 }
    }
  }];
  assert.equal(resetWindowStart(records, 'primary', { now, fallbackMinutes: 300 }).timestamp, Date.parse('2026-07-10T10:00:00Z'));
  assert.equal(resetWindowStart(records, 'secondary', { now, fallbackMinutes: 10080 }).timestamp, Date.parse('2026-07-06T00:00:00Z'));
});

test('advances stale reset cadence and falls back to a rolling window without snapshots', () => {
  const now = Date.parse('2026-07-10T12:00:00Z');
  const stale = [{ timestamp: '2026-07-09T00:00:00Z', rateLimits: { primary: { windowMinutes: 300, resetsAt: Date.parse('2026-07-09T05:00:00Z') / 1000 } } }];
  assert.equal(resetWindowStart(stale, 'primary', { now, fallbackMinutes: 300 }).timestamp, Date.parse('2026-07-10T11:00:00Z'));
  assert.equal(resetWindowStart([], 'primary', { now, fallbackMinutes: 300 }).timestamp, now - 5 * hour);
});

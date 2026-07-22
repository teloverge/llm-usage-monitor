'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseSession, subtractTokenShapes } = require('../src/codexImporter');

test('subtracts cumulative counters and protects against counter reset', () => {
  assert.deepEqual(
    subtractTokenShapes(
      { inputTokens: 200, cachedInputTokens: 80, outputTokens: 40, reasoningOutputTokens: 10, totalTokens: 240 },
      { inputTokens: 150, cachedInputTokens: 60, outputTokens: 30, reasoningOutputTokens: 8, totalTokens: 180 }
    ),
    { inputTokens: 50, cachedInputTokens: 20, outputTokens: 10, reasoningOutputTokens: 2, totalTokens: 60 }
  );
  assert.equal(subtractTokenShapes(
    { inputTokens: 10, cachedInputTokens: 20, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 12 },
    { inputTokens: 100, cachedInputTokens: 50, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 }
  ).cachedInputTokens, 10);
});

test('parses metadata-only Codex turns into stable delta records', async (t) => {
  const tempRoot = process.platform === 'linux' ? '/tmp' : os.tmpdir();
  const dir = await fs.mkdtemp(path.join(tempRoot, 'usage-monitor-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const id = '11111111-1111-1111-1111-111111111111';
  const file = path.join(dir, `rollout-${id}.jsonl`);
  const events = [
    { timestamp: '2026-07-10T10:00:00Z', type: 'session_meta', payload: { id, model_provider: 'openai' } },
    { timestamp: '2026-07-10T10:01:00Z', type: 'turn_context', payload: { turn_id: 'a', model: 'gpt-5.5', effort: 'high' } },
    { timestamp: '2026-07-10T10:02:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 20, reasoning_output_tokens: 10, total_tokens: 120 } } } },
    { timestamp: '2026-07-10T10:03:00Z', type: 'turn_context', payload: { turn_id: 'b', model: 'gpt-5.6-luna', effort: 'low' } },
    { timestamp: '2026-07-10T10:04:00Z', type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 180, cached_input_tokens: 100, output_tokens: 35, reasoning_output_tokens: 15, total_tokens: 215 }, last_token_usage: { input_tokens: 80, cached_input_tokens: 40, output_tokens: 15, reasoning_output_tokens: 5, total_tokens: 95 }, model_context_window: 353400 }, rate_limits: { limit_id: 'codex', plan_type: 'pro', primary: { used_percent: 24, window_minutes: 300, resets_at: 1783738955 }, secondary: { used_percent: 4, window_minutes: 10080, resets_at: 1784300000 }, rate_limit_reached_type: null } } }
  ];
  await fs.writeFile(file, events.map(JSON.stringify).join('\n'));
  const records = await parseSession(file, new Map([[id, 'Named task']]));
  assert.equal(records.length, 2);
  assert.equal(records[0].taskName, 'Named task');
  assert.equal(records[1].inputTokens, 80);
  assert.equal(records[1].outputTokens, 15);
  assert.equal(records[1].reasoningLevel, 'low');
  assert.equal(records[1].lastTokenUsage.cachedInputTokens, 40);
  assert.equal(records[1].modelContextWindowTokens, 353400);
  assert.equal(records[1].rateLimits.primary.usedPercent, 24);
  assert.equal(records[1].rateLimits.secondary.windowMinutes, 10080);
  assert.equal(records[1].rateLimits.planType, 'pro');
});

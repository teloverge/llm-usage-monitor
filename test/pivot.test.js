'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPivot, buildNestedPivot, compareReasoningLevels } = require('../media/pivot');

const records = [
  { provider: 'openai', model: 'alpha', totalTokens: 10, estimatedCost: 1 },
  { provider: 'openai', model: 'alpha', totalTokens: 20, estimatedCost: 2 },
  { provider: 'other', model: 'alpha', totalTokens: 5, estimatedCost: null },
  { provider: 'openai', model: 'beta', totalTokens: 15, estimatedCost: 3 }
];

test('builds row and column groups with sums and totals', () => {
  const pivot = buildPivot(records, {
    rowValue: (record) => record.model,
    columnValue: (record) => record.provider,
    value: (record) => record.totalTokens,
    calculation: 'sum'
  });
  assert.deepEqual(pivot.columns, ['openai', 'other']);
  assert.deepEqual(pivot.rows[0], { key: 'alpha', values: { openai: 30, other: 5 }, total: 35 });
  assert.deepEqual(pivot.totals, { openai: 45, other: 5 });
  assert.equal(pivot.grandTotal, 50);
});

test('supports average and count calculations while ignoring non-numeric values', () => {
  const average = buildPivot(records, {
    rowValue: (record) => record.provider,
    value: (record) => record.estimatedCost,
    calculation: 'average'
  });
  assert.equal(average.rows.find((row) => row.key === 'openai').total, 2);
  assert.equal(average.rows.find((row) => row.key === 'other').total, null);

  const count = buildPivot(records, {
    rowValue: (record) => record.model,
    value: () => 1,
    calculation: 'count'
  });
  assert.equal(count.grandTotal, 4);

  const pricedCount = buildPivot(records, {
    rowValue: (record) => record.model,
    value: (record) => record.estimatedCost,
    calculation: 'count'
  });
  assert.equal(pricedCount.grandTotal, 3);
});

test('builds child rows beneath each parent group', () => {
  const nestedRecords = [
    { provider: 'openai', model: 'alpha', reasoningLevel: 'low', estimatedCost: 1 },
    { provider: 'openai', model: 'alpha', reasoningLevel: 'high', estimatedCost: 2 },
    { provider: 'other', model: 'alpha', reasoningLevel: 'high', estimatedCost: 3 },
    { provider: 'openai', model: 'alpha', reasoningLevel: 'xhigh', estimatedCost: 5 },
    { provider: 'openai', model: 'alpha', reasoningLevel: 'medium', estimatedCost: 4 },
    { provider: 'openai', model: 'beta', reasoningLevel: '', estimatedCost: 4 }
  ];
  const pivot = buildNestedPivot(nestedRecords, {
    rowValue: (record) => record.model,
    childValue: (record) => record.reasoningLevel,
    childCompare: compareReasoningLevels,
    columnValue: (record) => record.provider,
    value: (record) => record.estimatedCost,
    calculation: 'sum'
  });

  assert.deepEqual(pivot.rows[0].children, [
    { key: 'xhigh', values: { openai: 5, other: null }, total: 5 },
    { key: 'high', values: { openai: 2, other: 3 }, total: 5 },
    { key: 'medium', values: { openai: 4, other: null }, total: 4 },
    { key: 'low', values: { openai: 1, other: null }, total: 1 }
  ]);
  assert.equal(pivot.rows[1].children[0].key, '(blank)');
  assert.equal(pivot.rows[1].children[0].total, 4);
});

test('sorts reasoning levels from highest effort to lowest', () => {
  const levels = ['low', '(blank)', 'xhigh', 'minimal', 'high', 'none', 'medium'];
  assert.deepEqual(levels.sort(compareReasoningLevels), ['xhigh', 'high', 'medium', 'low', 'minimal', 'none', '(blank)']);
});

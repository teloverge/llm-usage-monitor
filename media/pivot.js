'use strict';

(function exposePivot(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UsagePivot = api;
}(typeof globalThis === 'object' ? globalThis : this, function createPivotApi() {
  const TOTAL = 'Grand total';

  function buildPivot(records, options) {
    const rows = new Map();
    const columns = [];
    const seenColumns = new Set();
    const all = [];

    records.forEach((record) => {
      const rowKey = label(options.rowValue(record));
      const columnKey = options.columnValue ? label(options.columnValue(record)) : 'Value';
      if (!seenColumns.has(columnKey)) { seenColumns.add(columnKey); columns.push(columnKey); }
      if (!rows.has(rowKey)) rows.set(rowKey, new Map());
      if (!rows.get(rowKey).has(columnKey)) rows.get(rowKey).set(columnKey, []);
      const rawValue = options.value(record);
      const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== '';
      const value = options.calculation === 'count' ? 1 : Number(rawValue);
      if (hasValue && Number.isFinite(value)) {
        rows.get(rowKey).get(columnKey).push(value);
        all.push(value);
      }
    });

    columns.sort(compareLabels);
    const rowCompare = options.rowCompare || compareLabels;
    const resultRows = [...rows.entries()].sort((a, b) => rowCompare(a[0], b[0])).map(([key, groups]) => {
      const values = Object.fromEntries(columns.map((column) => [column, calculate(groups.get(column) || [], options.calculation)]));
      const rowValues = [...groups.values()].flat();
      return { key, values, total: calculate(rowValues, options.calculation) };
    });
    const totals = Object.fromEntries(columns.map((column) => {
      const values = [...rows.values()].flatMap((groups) => groups.get(column) || []);
      return [column, calculate(values, options.calculation)];
    }));
    return { columns, rows: resultRows, totals, grandTotal: calculate(all, options.calculation), totalLabel: TOTAL };
  }

  function buildNestedPivot(records, options) {
    const result = buildPivot(records, options);
    if (!options.childValue) return result;
    result.rows.forEach((row) => {
      const childRecords = records.filter((record) => label(options.rowValue(record)) === row.key);
      row.children = buildPivot(childRecords, { ...options, rowValue: options.childValue, rowCompare: options.childCompare, childValue: undefined }).rows;
    });
    return result;
  }

  function calculate(values, calculation) {
    if (calculation === 'count') return values.length;
    if (!values.length) return null;
    if (calculation === 'average') return values.reduce((sum, value) => sum + value, 0) / values.length;
    if (calculation === 'min') return Math.min(...values);
    if (calculation === 'max') return Math.max(...values);
    return values.reduce((sum, value) => sum + value, 0);
  }

  function label(value) {
    if (value === null || value === undefined || value === '') return '(blank)';
    return String(value);
  }

  function compareLabels(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }); }

  function compareReasoningLevels(a, b) {
    const order = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none', 'unknown', '(blank)'];
    const aRank = order.indexOf(String(a).toLowerCase());
    const bRank = order.indexOf(String(b).toLowerCase());
    if (aRank !== -1 || bRank !== -1) return (aRank === -1 ? order.length : aRank) - (bRank === -1 ? order.length : bRank);
    return compareLabels(a, b);
  }

  return { buildPivot, buildNestedPivot, calculate, compareReasoningLevels };
}));

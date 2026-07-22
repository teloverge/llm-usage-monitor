'use strict';

const vscode = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : createBrowserApi();
const state = { records: [], prices: [], settings: {}, filtered: [], view: 'overview', historySort: { key: 'timestamp', direction: 'desc' }, expandedAnalysisModels: new Set() };
const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat();
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 });
const pivotDimensions = {
  provider: { label: 'Provider', value: (record) => record.provider },
  model: { label: 'Model', value: (record) => record.model },
  taskName: { label: 'Task name', value: (record) => record.taskName },
  reasoningLevel: { label: 'Reasoning level', value: (record) => record.reasoningLevel },
  date: { label: 'Date', value: (record) => localIsoDate(new Date(record.timestamp)) },
  planType: { label: 'Plan type', value: (record) => record.rateLimits?.planType }
};
const pivotValues = {
  estimatedCost: { label: 'Estimated cost', value: (record) => record.estimatedCost, format: (value) => money.format(value) },
  totalTokens: { label: 'Total tokens', value: (record) => record.totalTokens, format: formatPivotNumber },
  inputTokens: { label: 'Input tokens', value: (record) => record.inputTokens, format: formatPivotNumber },
  cachedInputTokens: { label: 'Cached input tokens', value: (record) => record.cachedInputTokens, format: formatPivotNumber },
  outputTokens: { label: 'Output tokens', value: (record) => record.outputTokens, format: formatPivotNumber },
  reasoningOutputTokens: { label: 'Reasoning output tokens', value: (record) => record.reasoningOutputTokens, format: formatPivotNumber },
  records: { label: 'Usage records', value: () => 1, format: formatPivotNumber }
};

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
['timeframe', 'fromDate', 'toDate', 'providerFilter', 'modelFilter', 'reasoningFilter', 'taskSearch'].forEach((id) => $(id).addEventListener('input', applyFilters));
$('timeframe').addEventListener('change', () => document.querySelectorAll('.custom-date').forEach((node) => node.classList.toggle('hidden', $('timeframe').value !== 'custom')));
$('importButton').addEventListener('click', () => vscode.postMessage({ type: 'importCodex' }));
$('exportButton').addEventListener('click', () => vscode.postMessage({ type: 'exportReport', filters: currentFilters() }));
$('importFileButton').addEventListener('click', () => vscode.postMessage({ type: 'importFile' }));
$('saveSettingsButton').addEventListener('click', saveSettings);
$('savePricesButton').addEventListener('click', savePrices);
$('resetPricesButton').addEventListener('click', () => vscode.postMessage({ type: 'resetPrices' }));
$('clearButton').addEventListener('click', () => vscode.postMessage({ type: 'clearData' }));
$('addPriceButton').addEventListener('click', () => { state.prices.push({ provider: '', model: '', input: 0, cachedInput: 0, output: 0, effectiveDate: new Date().toISOString().slice(0, 10), source: 'Custom' }); renderPrices(); });
document.querySelectorAll('.usage-table th[data-sort]').forEach((header) => header.addEventListener('click', () => setHistorySort(header.dataset.sort)));
['pivotRows', 'pivotColumns', 'pivotValues', 'pivotCalculation'].forEach((id) => $(id).addEventListener('change', () => {
  if (id === 'pivotRows') state.expandedAnalysisModels.clear();
  renderAnalysis();
}));
$('pivotBody').addEventListener('click', (event) => {
  const toggle = event.target.closest('.pivot-row-toggle');
  if (!toggle) return;
  const model = toggle.dataset.model;
  if (state.expandedAnalysisModels.has(model)) state.expandedAnalysisModels.delete(model);
  else state.expandedAnalysisModels.add(model);
  renderAnalysis();
});
populatePivotControls();

window.addEventListener('message', (event) => {
  if (event.data?.type !== 'snapshot') return;
  state.records = event.data.snapshot.records || [];
  state.prices = (event.data.snapshot.prices || []).map((price) => ({ ...price }));
  state.settings = event.data.settings || {};
  populateOptions();
  populateSettings();
  renderPrices();
  updateImportStatus(event.data.lastImport);
  applyFilters();
});

function createBrowserApi() {
  let loading = false;
  const loadSnapshot = async () => {
    if (loading) return;
    loading = true;
    try {
      const response = await fetch('./api/snapshot', { cache: 'no-store' });
      if (!response.ok) throw new Error(`Snapshot request failed (${response.status}).`);
      window.dispatchEvent(new MessageEvent('message', { data: await response.json() }));
    } catch (error) {
      console.error('LLM Usage Monitor:', error);
    } finally {
      loading = false;
    }
  };
  setInterval(loadSnapshot, 5000);
  return {
    async postMessage(message) {
      try {
        if (message.type !== 'ready' && message.type !== 'refresh') {
          const response = await fetch('./api/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(message)
          });
          if (!response.ok) throw new Error(`Dashboard action failed (${response.status}).`);
        }
        await loadSnapshot();
      } catch (error) {
        console.error('LLM Usage Monitor:', error);
        window.alert('The dashboard action could not be completed. Check VS Code for details.');
      }
    }
  };
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === view));
  document.querySelectorAll('.view').forEach((item) => item.classList.toggle('active', item.id === `${view}View`));
  $('filterBar').classList.toggle('hidden', view === 'pricing' || view === 'settings');
  const copy = {
    overview: ['Your model spend, in focus.', 'Token and API-equivalent cost estimates, grouped around the work that created them.'],
    history: ['Every turn, accounted for.', 'Filter the local usage ledger by task, model, provider, and reasoning level.'],
    analysis: ['Shape the data your way.', 'Build a pivot-style summary from the usage records that match your filters.'],
    pricing: ['Pricing you can audit.', 'Published token rates stay editable, dated, and linked to their source.'],
    settings: ['Keep the monitor yours.', 'Control retention, automatic imports, and local display behavior.']
  }[view];
  $('viewTitle').textContent = copy[0];
  $('viewSubtitle').textContent = copy[1];
}

function populateOptions() {
  fillSelect('providerFilter', unique(state.records.map((r) => r.provider)));
  fillSelect('modelFilter', unique(state.records.map((r) => r.model)));
  fillSelect('reasoningFilter', unique(state.records.map((r) => r.reasoningLevel)));
}

function fillSelect(id, values) {
  const select = $(id); const selected = select.value;
  while (select.options.length > 1) select.remove(1);
  values.forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); });
  if (values.includes(selected)) select.value = selected;
}

function currentFilters() {
  let from = ''; let to = ''; let fromTimestamp = ''; let toTimestamp = '';
  const timeframe = $('timeframe').value;
  if (timeframe === 'custom') { from = $('fromDate').value; to = $('toDate').value; }
  else if (timeframe === 'today') { from = localIsoDate(new Date()); to = from; }
  else if (timeframe === 'reset' || timeframe === 'weekly') {
    const boundary = UsageTimeframe.resetWindowStart(state.records, timeframe === 'reset' ? 'primary' : 'secondary', {
      provider: $('providerFilter').value,
      model: $('modelFilter').value,
      reasoningLevel: $('reasoningFilter').value,
      fallbackMinutes: timeframe === 'reset' ? 300 : 10080
    });
    fromTimestamp = new Date(boundary.timestamp).toISOString(); toTimestamp = new Date().toISOString();
    from = localIsoDate(new Date(boundary.timestamp)); to = localIsoDate(new Date());
  } else if (timeframe !== 'all') { const date = new Date(); date.setDate(date.getDate() - Number(timeframe) + 1); from = localIsoDate(date); to = localIsoDate(new Date()); }
  return { from, to, fromTimestamp, toTimestamp, provider: $('providerFilter').value, model: $('modelFilter').value, reasoningLevel: $('reasoningFilter').value, query: $('taskSearch').value.trim() };
}

function applyFilters() {
  const f = currentFilters();
  const from = f.fromTimestamp ? Date.parse(f.fromTimestamp) : f.from ? Date.parse(`${f.from}T00:00:00`) : -Infinity;
  const to = f.toTimestamp ? Date.parse(f.toTimestamp) : f.to ? Date.parse(`${f.to}T23:59:59.999`) : Infinity;
  const query = f.query.toLowerCase();
  state.filtered = state.records.filter((record) => {
    const time = Date.parse(record.timestamp);
    return time >= from && time <= to && (!f.provider || record.provider === f.provider) && (!f.model || record.model === f.model) && (!f.reasoningLevel || record.reasoningLevel === f.reasoningLevel) && (!query || record.taskName.toLowerCase().includes(query));
  });
  renderOverview();
  renderHistory();
  renderAnalysis();
  $('footerStats').textContent = `${nf.format(state.records.length)} records retained`;
}

function renderOverview() {
  const s = summarize(state.filtered);
  const tasks = new Set(state.filtered.map((r) => r.taskName));
  const models = new Set(state.filtered.map((r) => `${r.provider}:${r.model}`));
  $('costMetric').textContent = money.format(s.cost);
  $('tokensMetric').textContent = compact(s.totalTokens);
  $('cacheMetric').textContent = s.inputTokens ? `${Math.round(s.cachedInputTokens / s.inputTokens * 100)}%` : '0%';
  $('tasksMetric').textContent = nf.format(tasks.size);
  $('recordsMetric').textContent = `${nf.format(state.filtered.length)} usage records`;
  $('modelsMetric').textContent = `${nf.format(models.size)} models`;
  renderTimeline();
  renderBreakdown('modelBreakdown', groupBy(state.filtered, (r) => `${r.provider} · ${r.model}`), 'model');
  renderBreakdown('taskBreakdown', groupBy(state.filtered, (r) => r.taskName), 'rank');
  renderComposition(s);
}

function renderTimeline() {
  const root = $('timelineChart'); root.replaceChildren();
  const grouped = new Map();
  state.filtered.forEach((record) => { const key = localIsoDate(new Date(record.timestamp)); const value = grouped.get(key) || { cost: 0, tokens: 0 }; value.cost += record.estimatedCost || 0; value.tokens += record.totalTokens; grouped.set(key, value); });
  const filters = currentFilters();
  let dates = dateRange(filters.from, filters.to);
  if (!dates.length) dates = [...grouped.keys()].sort().slice(-31);
  if (dates.length > 45) dates = dates.slice(-45);
  if (!dates.length) { setEmpty(root, 'Import Codex history to see a timeline.'); return; }
  root.className = 'timeline';
  const maxCost = Math.max(...dates.map((date) => grouped.get(date)?.cost || 0), .000001);
  const maxTokens = Math.max(...dates.map((date) => grouped.get(date)?.tokens || 0), 1);
  dates.forEach((date, index) => {
    const value = grouped.get(date) || { cost: 0, tokens: 0 };
    const day = el('div', 'day'); day.dataset.tip = `${date} · ${money.format(value.cost)} · ${nf.format(value.tokens)} tokens`;
    const bars = el('div', 'day-bars');
    const cost = el('i', 'day-bar cost'); cost.style.height = `${Math.max(value.cost ? 2 : 0, value.cost / maxCost * 100)}%`;
    const tokens = el('i', 'day-bar tokens'); tokens.style.height = `${Math.max(value.tokens ? 2 : 0, value.tokens / maxTokens * 100)}%`;
    bars.append(cost, tokens); day.append(bars);
    const label = el('span', 'day-label', index % Math.max(1, Math.ceil(dates.length / 8)) === 0 ? date.slice(5) : ''); day.append(label); root.append(day);
  });
}

function renderBreakdown(id, rows, mode) {
  const root = $(id); root.replaceChildren();
  const values = rows.slice(0, mode === 'rank' ? 6 : 8);
  if (!values.length) { setEmpty(root, mode === 'rank' ? 'No task usage yet.' : 'No usage in this timeframe.'); return; }
  root.className = mode === 'rank' ? 'rank-list' : 'breakdown';
  const useCost = values.some((row) => row.cost > 0);
  const max = Math.max(...values.map((row) => useCost ? row.cost : row.totalTokens), 1);
  values.forEach((row, index) => {
    if (mode === 'rank') {
      const item = el('div', 'rank-row'); item.append(el('span', 'rank-number', String(index + 1).padStart(2, '0')));
      const copy = el('div', 'rank-copy'); copy.append(el('strong', '', row.key), el('small', '', `${nf.format(row.totalTokens)} tokens · ${nf.format(row.records)} turns`)); item.append(copy);
      item.append(el('strong', 'rank-value', row.pricedRecords ? money.format(row.cost) : '—')); root.append(item);
    } else {
      const item = el('div', 'breakdown-row'); item.append(el('strong', 'breakdown-name', row.key));
      const meta = el('div', 'breakdown-meta'); meta.append(el('small', '', `${nf.format(row.totalTokens)} tokens`), el('strong', '', row.pricedRecords ? money.format(row.cost) : '—')); item.append(meta);
      const track = el('div', 'track'); const fill = el('i'); fill.style.width = `${(useCost ? row.cost : row.totalTokens) / max * 100}%`; track.append(fill); item.append(track);
      root.append(item);
    }
  });
}

function renderComposition(summary) {
  const root = $('tokenComposition'); root.replaceChildren();
  const values = [
    { label: 'Uncached input', value: Math.max(0, summary.inputTokens - summary.cachedInputTokens), color: '#15b88a' },
    { label: 'Cached input', value: summary.cachedInputTokens, color: '#638cff' },
    { label: 'Visible output', value: Math.max(0, summary.outputTokens - summary.reasoningOutputTokens), color: '#e5a443' },
    { label: 'Reasoning output', value: summary.reasoningOutputTokens, color: '#db6a7b' }
  ];
  const total = values.reduce((sum, item) => sum + item.value, 0);
  if (!total) { setEmpty(root, 'No token usage yet.'); return; }
  root.className = 'composition';
  let cursor = 0; const segments = values.map((item) => { const start = cursor; cursor += item.value / total * 100; return `${item.color} ${start}% ${cursor}%`; });
  const donut = el('div', 'donut'); donut.style.background = `conic-gradient(${segments.join(',')})`;
  const legend = el('div', 'composition-legend'); values.forEach((item) => { const row = el('div', 'composition-row'); const key = el('i'); key.style.background = item.color; row.append(key, el('span', '', item.label), el('strong', '', `${compact(item.value)} · ${Math.round(item.value / total * 100)}%`)); legend.append(row); });
  root.append(donut, legend);
}

function renderHistory() {
  const body = $('historyBody'); body.replaceChildren();
  $('historyCount').textContent = `${nf.format(state.filtered.length)} records${state.filtered.length > 500 ? ' · showing newest 500' : ''}`;
  updateSortHeaders();
  sortedHistory().slice(0, 500).forEach((record) => {
    const row = document.createElement('tr');
    const last = record.lastTokenUsage || {};
    const limits = record.rateLimits || {};
    row.append(
      cell(new Date(record.timestamp).toLocaleString()), cell(record.taskName, 'task-cell'), cell(record.provider, 'pill-cell'), cell(record.model), cell(record.reasoningLevel),
      tokenCell(record.inputTokens), tokenCell(record.cachedInputTokens), tokenCell(record.outputTokens), tokenCell(record.reasoningOutputTokens), tokenCell(record.totalTokens),
      optionalTokenCell(last.inputTokens), optionalTokenCell(last.cachedInputTokens), optionalTokenCell(last.outputTokens), optionalTokenCell(last.reasoningOutputTokens), optionalTokenCell(last.totalTokens),
      optionalNumberCell(record.modelContextWindowTokens), cell(formatContextUsed(record), 'number'),
      cell(formatLimitIdentity(limits)), cell(limits.planType || '—'), cell(formatLimitWindow(limits.primary), 'number'), cell(formatLimitWindow(limits.secondary), 'number'), cell(formatCredits(limits.credits)), cell(formatIndividualLimit(limits.individualLimit)), cell(limits.rateLimitReachedType || '—'),
      cell(record.estimatedCost === null ? '—' : money.format(record.estimatedCost), `number ${record.estimatedCost === null ? 'unknown-cost' : ''}`)
    );
    const providerCell = row.children[2]; const providerText = providerCell.textContent; providerCell.textContent = ''; providerCell.append(el('span', 'pill', providerText));
    body.append(row);
  });
  if (!state.filtered.length) { const row = document.createElement('tr'); const empty = cell('No usage matches these filters.'); empty.colSpan = 25; empty.className = 'empty-state'; row.append(empty); body.append(row); }
}

function populatePivotControls() {
  Object.entries(pivotDimensions).forEach(([key, definition]) => {
    $('pivotRows').append(selectOption(key, definition.label));
    $('pivotColumns').append(selectOption(key, definition.label));
  });
  $('pivotColumns').prepend(selectOption('', 'None'));
  Object.entries(pivotValues).forEach(([key, definition]) => $('pivotValues').append(selectOption(key, definition.label)));
  $('pivotRows').value = 'model';
  $('pivotColumns').value = 'provider';
  $('pivotValues').value = 'estimatedCost';
}

function renderAnalysis() {
  const rowDefinition = pivotDimensions[$('pivotRows').value];
  const columnDefinition = pivotDimensions[$('pivotColumns').value];
  const valueDefinition = pivotValues[$('pivotValues').value];
  const calculation = $('pivotCalculation').value;
  if (!rowDefinition || !valueDefinition) return;
  const hasReasoningChildren = $('pivotRows').value === 'model';
  const result = UsagePivot.buildNestedPivot(state.filtered, {
    rowValue: rowDefinition.value,
    childValue: hasReasoningChildren ? pivotDimensions.reasoningLevel.value : undefined,
    childCompare: hasReasoningChildren ? UsagePivot.compareReasoningLevels : undefined,
    columnValue: columnDefinition?.value,
    value: valueDefinition.value,
    calculation
  });
  const format = calculation === 'count' ? formatPivotNumber : valueDefinition.format;
  const head = $('pivotHead'); const body = $('pivotBody'); const foot = $('pivotFoot');
  head.replaceChildren(); body.replaceChildren(); foot.replaceChildren();
  const headerRow = document.createElement('tr');
  headerRow.append(el('th', '', hasReasoningChildren ? `${rowDefinition.label} / Reasoning level` : rowDefinition.label));
  result.columns.forEach((column) => headerRow.append(el('th', 'number', columnDefinition ? column : valueDefinition.label)));
  if (columnDefinition) headerRow.append(el('th', 'number', 'Grand total'));
  head.append(headerRow);
  result.rows.forEach((pivotRow) => {
    const row = document.createElement('tr');
    if (hasReasoningChildren) {
      const labelCell = cell('', 'pivot-model-cell');
      const toggle = el('button', 'pivot-row-toggle');
      const expanded = state.expandedAnalysisModels.has(pivotRow.key);
      toggle.type = 'button'; toggle.dataset.model = pivotRow.key; toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${pivotRow.key}`);
      toggle.append(el('span', 'pivot-chevron', ''), el('span', '', pivotRow.key));
      labelCell.append(toggle); row.append(labelCell);
    } else row.append(cell(pivotRow.key));
    result.columns.forEach((column) => row.append(cell(formatPivotValue(pivotRow.values[column], format), 'number')));
    if (columnDefinition) row.append(cell(formatPivotValue(pivotRow.total, format), 'number pivot-total'));
    body.append(row);
    if (hasReasoningChildren && state.expandedAnalysisModels.has(pivotRow.key)) {
      pivotRow.children.forEach((childRow) => {
        const child = document.createElement('tr'); child.className = 'pivot-child-row';
        child.append(cell(childRow.key, 'pivot-child-label'));
        result.columns.forEach((column) => child.append(cell(formatPivotValue(childRow.values[column], format), 'number')));
        if (columnDefinition) child.append(cell(formatPivotValue(childRow.total, format), 'number pivot-total'));
        body.append(child);
      });
    }
  });
  if (!result.rows.length) {
    const row = document.createElement('tr'); const empty = cell('No usage matches these filters.');
    empty.colSpan = result.columns.length + (columnDefinition ? 2 : 1); empty.className = 'empty-state'; row.append(empty); body.append(row);
  } else {
    const totalRow = document.createElement('tr'); totalRow.append(el('th', '', result.totalLabel));
    result.columns.forEach((column) => totalRow.append(cell(formatPivotValue(result.totals[column], format), 'number')));
    if (columnDefinition) totalRow.append(cell(formatPivotValue(result.grandTotal, format), 'number'));
    foot.append(totalRow);
  }
  const calculationLabel = $('pivotCalculation').selectedOptions[0].textContent;
  $('pivotTitle').textContent = `${calculationLabel} of ${valueDefinition.label}`;
  $('pivotCount').textContent = `${nf.format(state.filtered.length)} source records`;
  renderPivotChart(result, {
    rowLabel: rowDefinition.label,
    columnLabel: columnDefinition?.label,
    valueLabel: valueDefinition.label,
    calculationLabel,
    format
  });
}

function renderPivotChart(result, options) {
  const chart = $('pivotChart'); const legend = $('pivotChartLegend');
  chart.replaceChildren(); legend.replaceChildren();
  $('pivotChartTitle').textContent = `${options.calculationLabel} of ${options.valueLabel}`;
  $('pivotChartSubtitle').textContent = options.columnLabel
    ? `${options.rowLabel} grouped by ${options.columnLabel}`
    : `Compared by ${options.rowLabel}`;
  chart.setAttribute('aria-label', `${options.calculationLabel} of ${options.valueLabel} by ${options.rowLabel}${options.columnLabel ? ` and ${options.columnLabel}` : ''}`);
  if (!result.rows.length) {
    chart.className = 'pivot-chart empty-state';
    chart.textContent = 'No usage matches these filters.';
    return;
  }

  chart.className = 'pivot-chart';
  const series = result.columns.map((column, index) => ({
    key: column,
    label: options.columnLabel ? column : options.valueLabel,
    color: index % 6
  }));
  series.forEach((item) => {
    const key = el('i', `pivot-color-${item.color}`);
    const label = el('span', '', item.label); label.prepend(key); legend.append(label);
  });
  const values = result.rows.flatMap((row) => series.map((item) => row.values[item.key])).filter(Number.isFinite);
  const maximum = Math.max(0, ...values);
  result.rows.forEach((pivotRow) => {
    const row = el('div', 'pivot-chart-row');
    row.append(el('strong', 'pivot-chart-label', pivotRow.key));
    const bars = el('div', 'pivot-chart-bars');
    series.forEach((item) => {
      const value = pivotRow.values[item.key];
      const line = el('div', 'pivot-chart-line');
      const track = el('div', 'pivot-chart-track');
      if (Number.isFinite(value)) {
        const bar = el('i', `pivot-chart-bar pivot-color-${item.color}`);
        bar.style.width = maximum > 0 ? `${Math.max(0, value) / maximum * 100}%` : '0%';
        const formatted = formatPivotValue(value, options.format);
        bar.title = `${pivotRow.key} — ${item.label}: ${formatted}`;
        track.append(bar);
        line.append(track, el('span', 'pivot-chart-value', formatted));
      } else {
        line.append(track, el('span', 'pivot-chart-value', '—'));
      }
      bars.append(line);
    });
    row.append(bars); chart.append(row);
  });
}

function selectOption(value, label) { const option = document.createElement('option'); option.value = value; option.textContent = label; return option; }
function formatPivotNumber(value) { return nf.format(value); }
function formatPivotValue(value, formatter) { return value === null ? '—' : formatter(value); }

function setHistorySort(key) {
  state.historySort = state.historySort.key === key
    ? { key, direction: state.historySort.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: key === 'timestamp' ? 'desc' : 'asc' };
  renderHistory();
}

function sortedHistory() {
  const { key, direction } = state.historySort;
  const multiplier = direction === 'asc' ? 1 : -1;
  return state.filtered.map((record, index) => ({ record, index })).sort((a, b) => {
    const left = historySortValue(a.record, key); const right = historySortValue(b.record, key);
    if (left === right) return a.index - b.index;
    if (left === null || left === undefined || left === '') return 1;
    if (right === null || right === undefined || right === '') return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * multiplier;
    return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * multiplier;
  }).map(({ record }) => record);
}

function historySortValue(record, key) {
  const last = record.lastTokenUsage || {}; const limits = record.rateLimits || {};
  const values = {
    timestamp: Date.parse(record.timestamp), lastInputTokens: last.inputTokens, lastCachedInputTokens: last.cachedInputTokens,
    lastOutputTokens: last.outputTokens, lastReasoningOutputTokens: last.reasoningOutputTokens, lastTotalTokens: last.totalTokens,
    contextUsedPercent: contextUsedPercent(record), limitName: limits.limitName || limits.limitId, planType: limits.planType,
    primaryUsedPercent: limits.primary?.usedPercent, secondaryUsedPercent: limits.secondary?.usedPercent,
    creditsBalance: limits.credits?.unlimited ? Infinity : limits.credits?.balance,
    individualLimitUsedPercent: limits.individualLimit?.usedPercent, rateLimitReachedType: limits.rateLimitReachedType
  };
  return Object.hasOwn(values, key) ? values[key] : record[key];
}

function updateSortHeaders() {
  document.querySelectorAll('.usage-table th[data-sort]').forEach((header) => {
    const active = header.dataset.sort === state.historySort.key;
    header.classList.toggle('sorted', active);
    header.dataset.direction = active ? state.historySort.direction : '';
    header.setAttribute('aria-sort', active ? (state.historySort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    header.tabIndex = 0;
    header.onkeydown = (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setHistorySort(header.dataset.sort); } };
  });
}

function contextUsedPercent(record) {
  const input = record.lastTokenUsage?.inputTokens || 0;
  return record.modelContextWindowTokens ? input / record.modelContextWindowTokens * 100 : null;
}

function formatContextUsed(record) { const value = contextUsedPercent(record); return value === null ? '—' : `${value.toFixed(1)}%`; }
function formatLimitIdentity(value) { if (!value?.limitName) return value?.limitId || '—'; return value.limitId && value.limitId !== value.limitName ? `${value.limitName} (${value.limitId})` : value.limitName; }
function formatLimitWindow(value) { return value ? `${value.usedPercent.toFixed(1)}% · ${formatDuration(value.windowMinutes)} · ${formatReset(value.resetsAt)}` : '—'; }
function formatDuration(minutes) { if (!minutes) return 'window —'; if (minutes % 1440 === 0) return `${minutes / 1440}d`; if (minutes % 60 === 0) return `${minutes / 60}h`; return `${minutes}m`; }
function formatReset(value) { return value ? `resets ${new Date(value * 1000).toLocaleString()}` : 'reset —'; }
function formatCredits(value) { if (!value) return '—'; return `${value.unlimited ? 'Unlimited' : value.hasCredits ? 'Available' : 'Unavailable'} · balance ${nf.format(value.balance)}`; }
function formatIndividualLimit(value) { return value ? `${formatLimitIdentity(value)} · ${value.usedPercent.toFixed(1)}% · ${formatDuration(value.windowMinutes)} · ${formatReset(value.resetsAt)}` : '—'; }
function tokenCell(value) { return cell(nf.format(Number(value) || 0), 'number'); }
function optionalTokenCell(value) { return cell(value === null || value === undefined ? '—' : nf.format(Number(value) || 0), 'number'); }
function optionalNumberCell(value) { return cell(value ? nf.format(value) : '—', 'number'); }

function renderPrices() {
  const body = $('priceBody'); body.replaceChildren();
  state.prices.forEach((price, index) => {
    const row = document.createElement('tr');
    row.append(priceProvider(index, price), priceInput(index, 'model', price.model), priceInput(index, 'input', price.input, 'number', 'currency'), priceInput(index, 'cachedInput', price.cachedInput, 'number', 'currency'), priceInput(index, 'output', price.output, 'number', 'currency'), priceInput(index, 'effectiveDate', price.effectiveDate, 'date'));
    const action = document.createElement('td'); const remove = el('button', 'remove-price', '×'); remove.title = 'Remove price'; remove.addEventListener('click', () => { state.prices.splice(index, 1); renderPrices(); }); action.append(remove); row.append(action); body.append(row);
  });
}

function priceProvider(index, price) {
  const td = el('td', 'provider-price');
  if (!price.provider) { td.append(priceEditor(index, 'provider', '', 'text')); return td; }
  const sourceIsLink = /^https:\/\//i.test(price.source || '');
  const provider = sourceIsLink ? el('a', 'provider-source', price.provider) : el('span', 'provider-name', price.provider);
  if (sourceIsLink) { provider.href = price.source; provider.target = '_blank'; provider.rel = 'noreferrer'; provider.title = `Open pricing source for ${price.provider}`; }
  const edit = el('button', 'edit-provider', 'Edit'); edit.type = 'button'; edit.title = 'Edit provider name';
  edit.addEventListener('click', () => { td.replaceChildren(priceEditor(index, 'provider', price.provider, 'text', true)); });
  td.append(provider, edit); return td;
}

function priceInput(index, key, value, type = 'text', className = '') {
  const td = document.createElement('td'); if (type === 'number') td.className = 'number'; else if (type === 'date') td.className = 'date-column';
  const input = priceEditor(index, key, value, type);
  if (className === 'currency') { const wrapper = el('span', 'currency-input'); wrapper.append(el('span', '', '$'), input); td.append(wrapper); }
  else td.append(input);
  return td;
}

function priceEditor(index, key, value, type = 'text', focus = false) {
  const input = document.createElement('input'); input.type = type; input.value = value ?? '';
  if (type === 'number') { input.min = '0'; input.step = '0.001'; }
  input.addEventListener('input', () => { state.prices[index][key] = type === 'number' ? Number(input.value) : input.value; });
  if (focus) queueMicrotask(() => { input.focus(); input.select(); });
  return input;
}

function savePrices() { vscode.postMessage({ type: 'savePrices', prices: state.prices.filter((price) => price.provider && price.model) }); }
function populateSettings() { $('historyDays').value = state.settings.historyDurationDays ?? 90; $('codexHome').value = state.settings.codexHome || ''; $('autoImport').checked = state.settings.autoImport !== false; $('importInterval').value = state.settings.autoImportIntervalMinutes ?? 5; $('showStatusBar').checked = state.settings.showStatusBar !== false; }
function saveSettings() { vscode.postMessage({ type: 'saveSettings', settings: { historyDurationDays: Number($('historyDays').value), codexHome: $('codexHome').value, autoImport: $('autoImport').checked, autoImportIntervalMinutes: Number($('importInterval').value), showStatusBar: $('showStatusBar').checked } }); }
function updateImportStatus(value) { $('importStatus').replaceChildren(el('span', 'dot'), document.createTextNode(value?.at ? `Imported ${nf.format(value.records || 0)} records · ${new Date(value.at).toLocaleString()}` : 'Waiting for local import')); }

function summarize(records) { return records.reduce((s, r) => ({ inputTokens: s.inputTokens + r.inputTokens, cachedInputTokens: s.cachedInputTokens + r.cachedInputTokens, outputTokens: s.outputTokens + r.outputTokens, reasoningOutputTokens: s.reasoningOutputTokens + r.reasoningOutputTokens, totalTokens: s.totalTokens + r.totalTokens, cost: s.cost + (r.estimatedCost || 0), pricedRecords: s.pricedRecords + (r.estimatedCost === null ? 0 : 1), records: s.records + 1 }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, cost: 0, pricedRecords: 0, records: 0 }); }
function groupBy(records, keyFn) { const map = new Map(); records.forEach((record) => { const key = keyFn(record) || 'unknown'; const values = map.get(key) || []; values.push(record); map.set(key, values); }); return [...map].map(([key, values]) => ({ key, ...summarize(values) })).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens); }
function unique(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b)); }
function compact(value) { return new Intl.NumberFormat(undefined, { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value || 0); }
function localIsoDate(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 10); }
function dateRange(from, to) { if (!from || !to) return []; const dates = []; const current = new Date(`${from}T12:00:00`); const end = new Date(`${to}T12:00:00`); while (current <= end && dates.length < 3700) { dates.push(localIsoDate(current)); current.setDate(current.getDate() + 1); } return dates; }
function setEmpty(root, text) { root.className = 'empty-state'; root.textContent = text; }
function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text !== '') node.textContent = text; return node; }
function cell(text, className = '') { return el('td', className, text); }

vscode.postMessage({ type: 'ready' });

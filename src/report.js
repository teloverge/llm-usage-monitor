'use strict';

function buildReport(snapshot, filters = {}) {
  const generatedAt = new Date();
  const records = filterRecords(snapshot.records, filters);
  const total = summarize(records);
  const byTask = group(records, (record) => record.taskName);
  const byModel = group(records, (record) => `${record.provider} · ${record.model}`);
  const byReasoning = group(records, (record) => record.reasoningLevel);
  const unknown = records.filter((record) => record.estimatedCost === null).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LLM Usage Report · ${escapeHtml(generatedAt.toLocaleDateString())}</title>
<style>${reportCss()}</style></head><body>
<main><header><div><div class="eyebrow">LLM USAGE MONITOR</div><h1>Usage report</h1><p>${escapeHtml(periodLabel(filters))} · Generated ${escapeHtml(generatedAt.toLocaleString())}</p></div><button onclick="window.print()">Print / Save PDF</button></header>
<section class="notice"><strong>Estimate:</strong> Dollar totals use published standard API token rates. ChatGPT-plan Codex usage may instead consume included allowance or credits and may not represent an amount billed. ${unknown ? `${unknown} record(s) use models without a configured price and are excluded from cost totals.` : ''}</section>
<section class="metrics">
${metric('Estimated cost', money(total.cost))}${metric('Total tokens', number(total.totalTokens))}${metric('Input tokens', number(total.inputTokens))}${metric('Cached input', number(total.cachedInputTokens))}${metric('Output tokens', number(total.outputTokens))}${metric('Reasoning output', number(total.reasoningOutputTokens))}${metric('Tasks', number(new Set(records.map((r) => r.taskName)).size))}
</section>
${tableSection('By task', byTask)}${tableSection('By provider and model', byModel)}${tableSection('By reasoning level', byReasoning)}
<section><h2>Detailed usage</h2><div class="table-wrap"><table><thead><tr><th>Date</th><th>Task</th><th>Provider</th><th>Model</th><th>Reasoning</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning output</th><th>Total</th><th>Last call</th><th>Context</th><th>Limit</th><th>Plan</th><th>Primary</th><th>Secondary</th><th>Credits</th><th>Individual</th><th>Reached</th><th>Est. cost</th></tr></thead><tbody>
${records.map(detailRow).join('')}
</tbody></table></div></section>
<footer>Generated locally by LLM Usage Monitor. Pricing sources and effective dates are stored with the extension's price catalog.</footer></main></body></html>`;
}

function filterRecords(records, filters) {
  const from = filters.fromTimestamp ? Date.parse(filters.fromTimestamp) : filters.from ? Date.parse(`${filters.from}T00:00:00`) : -Infinity;
  const to = filters.toTimestamp ? Date.parse(filters.toTimestamp) : filters.to ? Date.parse(`${filters.to}T23:59:59.999`) : Infinity;
  return records.filter((record) => {
    const time = Date.parse(record.timestamp);
    return time >= from && time <= to
      && (!filters.provider || record.provider === filters.provider)
      && (!filters.model || record.model === filters.model)
      && (!filters.reasoningLevel || record.reasoningLevel === filters.reasoningLevel)
      && (!filters.query || record.taskName.toLowerCase().includes(String(filters.query).toLowerCase()));
  });
}

function summarize(records) {
  return records.reduce((sum, record) => ({
    inputTokens: sum.inputTokens + record.inputTokens,
    cachedInputTokens: sum.cachedInputTokens + record.cachedInputTokens,
    outputTokens: sum.outputTokens + record.outputTokens,
    reasoningOutputTokens: sum.reasoningOutputTokens + record.reasoningOutputTokens,
    totalTokens: sum.totalTokens + record.totalTokens,
    cost: sum.cost + (record.estimatedCost || 0),
    records: sum.records + 1
  }), { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, cost: 0, records: 0 });
}

function group(records, keyFn) {
  const values = new Map();
  for (const record of records) {
    const key = keyFn(record) || 'unknown';
    const items = values.get(key) || [];
    items.push(record);
    values.set(key, items);
  }
  return [...values.entries()].map(([key, items]) => ({ key, ...summarize(items) })).sort((a, b) => b.cost - a.cost || b.totalTokens - a.totalTokens);
}

function metric(label, value) { return `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`; }
function tableSection(title, rows) {
  return `<section><h2>${escapeHtml(title)}</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>Input</th><th>Cached</th><th>Output</th><th>Reasoning output</th><th>Total</th><th>Est. cost</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.key)}</td><td>${number(row.inputTokens)}</td><td>${number(row.cachedInputTokens)}</td><td>${number(row.outputTokens)}</td><td>${number(row.reasoningOutputTokens)}</td><td>${number(row.totalTokens)}</td><td>${money(row.cost)}</td></tr>`).join('')}</tbody></table></div></section>`;
}
function detailRow(record) {
  const last = record.lastTokenUsage || {};
  const limits = record.rateLimits || {};
  const contextPercent = record.modelContextWindowTokens ? (Number(last.inputTokens) || 0) / record.modelContextWindowTokens * 100 : null;
  return `<tr><td>${escapeHtml(new Date(record.timestamp).toLocaleString())}</td><td>${escapeHtml(record.taskName)}</td><td>${escapeHtml(record.provider)}</td><td>${escapeHtml(record.model)}</td><td>${escapeHtml(record.reasoningLevel)}</td><td>${number(record.inputTokens)}</td><td>${number(record.cachedInputTokens)}</td><td>${number(record.outputTokens)}</td><td>${number(record.reasoningOutputTokens)}</td><td>${number(record.totalTokens)}</td><td>${escapeHtml(tokenSummary(last))}</td><td>${record.modelContextWindowTokens ? `${number(record.modelContextWindowTokens)} · ${contextPercent.toFixed(1)}% used` : '—'}</td><td>${escapeHtml(limitIdentity(limits))}</td><td>${escapeHtml(limits.planType || '—')}</td><td>${escapeHtml(limitSummary(limits.primary))}</td><td>${escapeHtml(limitSummary(limits.secondary))}</td><td>${escapeHtml(creditSummary(limits.credits))}</td><td>${escapeHtml(individualLimitSummary(limits.individualLimit))}</td><td>${escapeHtml(limits.rateLimitReachedType || '—')}</td><td>${record.estimatedCost === null ? '—' : money(record.estimatedCost)}</td></tr>`;
}
function tokenSummary(value) { return value ? `in ${number(value.inputTokens)}, cached ${number(value.cachedInputTokens)}, out ${number(value.outputTokens)}, reasoning ${number(value.reasoningOutputTokens)}, total ${number(value.totalTokens)}` : '—'; }
function limitIdentity(value) { if (!value?.limitName) return value?.limitId || '—'; return value.limitId && value.limitId !== value.limitName ? `${value.limitName} (${value.limitId})` : value.limitName; }
function limitSummary(value) { return value ? `${value.usedPercent.toFixed(1)}% · ${number(value.windowMinutes)} min · ${value.resetsAt ? new Date(value.resetsAt * 1000).toLocaleString() : 'no reset'}` : '—'; }
function creditSummary(value) { return value ? `${value.unlimited ? 'Unlimited' : value.hasCredits ? 'Available' : 'Unavailable'} · balance ${number(value.balance)}` : '—'; }
function individualLimitSummary(value) { return value ? `${limitIdentity(value)} · ${limitSummary(value)}` : '—'; }
function periodLabel(filters) {
  if (filters.fromTimestamp || filters.toTimestamp) return `${filters.fromTimestamp ? new Date(filters.fromTimestamp).toLocaleString() : 'Beginning'} to ${filters.toTimestamp ? new Date(filters.toTimestamp).toLocaleString() : 'Now'}`;
  return filters.from || filters.to ? `${filters.from || 'Beginning'} to ${filters.to || 'Today'}` : 'All retained history';
}
function number(value) { return new Intl.NumberFormat().format(value || 0); }
function money(value) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value || 0); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function reportCss() { return `:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17201d;background:#edf1ec}*{box-sizing:border-box}body{margin:0}main{max-width:1400px;margin:auto;background:#fff;min-height:100vh;padding:48px}header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:1px solid #d9e0da;padding-bottom:28px}h1{font-size:42px;letter-spacing:-.04em;margin:6px 0}h2{font-size:20px;margin:36px 0 12px}.eyebrow{color:#08755c;font-weight:800;letter-spacing:.14em;font-size:11px}p,footer{color:#68736e}button{border:0;border-radius:8px;background:#08755c;color:#fff;padding:11px 16px;font-weight:700}.notice{background:#f1f7f4;border-left:4px solid #13a37f;padding:14px 16px;margin:24px 0;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}.metrics article{border:1px solid #dfe5e0;border-radius:10px;padding:16px}.metrics span{display:block;color:#68736e;font-size:12px}.metrics strong{display:block;margin-top:8px;font-size:22px}.table-wrap{overflow:auto;border:1px solid #dfe5e0;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:12px}th{text-align:left;color:#68736e;background:#f6f8f6}th,td{padding:10px 12px;border-bottom:1px solid #e9ede9;white-space:nowrap}tr:last-child td{border:0}footer{margin-top:44px;padding-top:18px;border-top:1px solid #dfe5e0;font-size:11px}@media(max-width:800px){main{padding:24px}.metrics{grid-template-columns:1fr 1fr}}@media print{body,main{background:#fff}main{padding:0}button{display:none}.table-wrap{overflow:visible}section{break-inside:avoid}}`; }

module.exports = { buildReport, filterRecords, group, summarize };

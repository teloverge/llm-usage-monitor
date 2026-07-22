'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { normalizeProvider } = require('./pricing');

const CACHE_SCHEMA_VERSION = 2;

class CodexSessionProvider {
  constructor(options = {}) {
    this.id = 'codex-local';
    this.label = 'Codex local sessions';
    this.getConfiguredHome = options.getConfiguredHome || (() => '');
  }

  getHome() {
    const configured = this.getConfiguredHome().trim();
    return expandHome(configured || process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
  }

  async collect(previousState = {}, onProgress = () => {}) {
    const home = this.getHome();
    const taskNames = await readTaskIndex(path.join(home, 'session_index.jsonl'));
    const files = [
      ...(await walkJsonl(path.join(home, 'sessions'))),
      ...(await walkJsonl(path.join(home, 'archived_sessions')))
    ];
    const nextFiles = {};
    const records = [];
    let parsedFiles = 0;
    let skippedFiles = 0;

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      let stat;
      try { stat = await fs.promises.stat(file); } catch { continue; }
      const fingerprint = `${stat.size}:${stat.mtimeMs}`;
      const prior = previousState.schemaVersion === CACHE_SCHEMA_VERSION ? previousState.files?.[file] : null;
      if (prior?.fingerprint === fingerprint && Array.isArray(prior.records)) {
        records.push(...prior.records.map((record) => applyLatestTaskName(record, taskNames)));
        nextFiles[file] = prior;
        skippedFiles += 1;
      } else {
        try {
          const parsed = await parseSession(file, taskNames);
          records.push(...parsed);
          nextFiles[file] = { fingerprint, records: parsed };
          parsedFiles += 1;
        } catch (error) {
          nextFiles[file] = { fingerprint, records: [], error: String(error.message || error) };
        }
      }
      if (index % 20 === 0 || index === files.length - 1) {
        onProgress({ current: index + 1, total: files.length });
      }
    }

    return {
      records,
      state: { schemaVersion: CACHE_SCHEMA_VERSION, files: nextFiles, lastScan: new Date().toISOString(), home },
      stats: { discoveredFiles: files.length, parsedFiles, skippedFiles, records: records.length, home }
    };
  }
}

async function parseSession(file, taskNames) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let sessionId = sessionIdFromFilename(file);
  let provider = 'openai';
  let sessionTimestamp = null;
  let currentTurn = null;
  let latestRateLimits = null;
  const turns = [];

  for await (const line of lines) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const payload = event?.payload || {};
    if (event.type === 'session_meta') {
      sessionId = String(payload.id || sessionId);
      provider = normalizeProvider(payload.model_provider || 'openai');
      sessionTimestamp = payload.timestamp || event.timestamp || sessionTimestamp;
    } else if (event.type === 'turn_context') {
      currentTurn = {
        turnId: String(payload.turn_id || `turn-${turns.length + 1}`),
        model: String(payload.model || 'unknown'),
        reasoningLevel: String(payload.effort || 'unknown'),
        timestamp: event.timestamp || sessionTimestamp || new Date().toISOString(),
        total: null,
        last: null,
        modelContextWindowTokens: 0,
        rateLimits: latestRateLimits
      };
      turns.push(currentTurn);
    } else if (payload.type === 'token_count') {
      if (payload.rate_limits) latestRateLimits = rateLimitShape(payload.rate_limits);
      if (currentTurn && latestRateLimits) currentTurn.rateLimits = latestRateLimits;
      if (payload.info?.total_token_usage && currentTurn) {
        currentTurn.total = tokenShape(payload.info.total_token_usage);
        currentTurn.last = payload.info.last_token_usage ? tokenShape(payload.info.last_token_usage) : null;
        currentTurn.modelContextWindowTokens = nonnegativeInteger(payload.info.model_context_window);
        currentTurn.timestamp = event.timestamp || currentTurn.timestamp;
      }
    }
  }

  const taskName = taskNames.get(sessionId) || fallbackTaskName(sessionId, file);
  let previous = tokenShape({});
  const records = [];
  for (const turn of turns) {
    if (!turn.total) continue;
    const delta = subtractTokenShapes(turn.total, previous);
    previous = turn.total;
    if (delta.totalTokens <= 0 && delta.inputTokens <= 0 && delta.outputTokens <= 0) continue;
    records.push({
      id: `codex:${sessionId}:${turn.turnId}`,
      timestamp: turn.timestamp,
      taskName,
      provider,
      model: turn.model,
      reasoningLevel: turn.reasoningLevel,
      ...delta,
      lastTokenUsage: turn.last,
      modelContextWindowTokens: turn.modelContextWindowTokens,
      rateLimits: turn.rateLimits,
      source: 'codex-local',
      sessionId,
      turnId: turn.turnId
    });
  }
  return records;
}

function tokenShape(value) {
  const n = (key) => nonnegativeInteger(value?.[key]);
  return {
    inputTokens: n('input_tokens'),
    cachedInputTokens: n('cached_input_tokens'),
    outputTokens: n('output_tokens'),
    reasoningOutputTokens: n('reasoning_output_tokens'),
    totalTokens: n('total_tokens')
  };
}

function rateLimitShape(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    limitId: safeText(value.limit_id),
    limitName: safeText(value.limit_name),
    planType: safeText(value.plan_type),
    rateLimitReachedType: safeText(value.rate_limit_reached_type),
    primary: rateLimitWindowShape(value.primary),
    secondary: rateLimitWindowShape(value.secondary),
    credits: creditShape(value.credits),
    individualLimit: individualLimitShape(value.individual_limit)
  };
}

function rateLimitWindowShape(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    usedPercent: nonnegativeNumber(value.used_percent),
    windowMinutes: nonnegativeInteger(value.window_minutes),
    resetsAt: nonnegativeInteger(value.resets_at)
  };
}

function creditShape(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    hasCredits: Boolean(value.has_credits),
    unlimited: Boolean(value.unlimited),
    balance: nonnegativeNumber(value.balance)
  };
}

function individualLimitShape(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    limitId: safeText(value.limit_id),
    limitName: safeText(value.limit_name),
    usedPercent: nonnegativeNumber(value.used_percent),
    windowMinutes: nonnegativeInteger(value.window_minutes),
    resetsAt: nonnegativeInteger(value.resets_at)
  };
}

function nonnegativeInteger(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function nonnegativeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function safeText(value) {
  return value === null || value === undefined ? '' : String(value).slice(0, 200);
}

function subtractTokenShapes(current, previous) {
  const result = {};
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens']) {
    const delta = current[key] - previous[key];
    result[key] = delta >= 0 ? delta : current[key];
  }
  result.cachedInputTokens = Math.min(result.inputTokens, result.cachedInputTokens);
  return result;
}

async function readTaskIndex(file) {
  const names = new Map();
  if (!(await exists(file))) return names;
  const lines = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.id && item.thread_name) names.set(String(item.id), String(item.thread_name));
    } catch { /* A damaged index line should not block usage import. */ }
  }
  return names;
}

async function walkJsonl(root) {
  if (!(await exists(root))) return [];
  const result = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    let entries = [];
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) result.push(full);
    }
  }
  return result.sort();
}

function applyLatestTaskName(record, names) {
  const taskName = names.get(record.sessionId);
  return taskName ? { ...record, taskName } : record;
}

function fallbackTaskName(sessionId, file) {
  const day = path.basename(path.dirname(file));
  return `Codex session ${day} · ${String(sessionId).slice(0, 8)}`;
}

function sessionIdFromFilename(file) {
  const match = path.basename(file).match(/([0-9a-f]{8}-[0-9a-f-]{27})\.jsonl$/i);
  return match?.[1] || path.basename(file, '.jsonl');
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

async function exists(value) {
  try { await fs.promises.access(value); return true; } catch { return false; }
}

module.exports = {
  CodexSessionProvider,
  parseSession,
  readTaskIndex,
  rateLimitShape,
  subtractTokenShapes,
  tokenShape,
  walkJsonl
};

'use strict';

const vscode = require('vscode');
const path = require('path');
const { UsageStore } = require('./storage');
const { CodexSessionProvider } = require('./codexImporter');
const { buildReport } = require('./report');
const { openInDefaultBrowser } = require('./browserLauncher');
const { createDashboardServer } = require('./dashboardServer');

function activate(context) {
  const configuration = () => vscode.workspace.getConfiguration('llmUsageMonitor');
  const store = new UsageStore(context, () => configuration().get('historyDurationDays', 90));
  const providers = new Map();
  const codexProvider = new CodexSessionProvider({ getConfiguredHome: () => configuration().get('codexHome', '') });
  providers.set(codexProvider.id, codexProvider);
  let lastImport = null;
  let importing = null;
  let timer = null;

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.name = 'LLM Usage Monitor';
  status.command = 'llmUsageMonitor.openDashboard';
  context.subscriptions.push(status);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('llmUsageMonitor.home', {
    getTreeItem: (item) => item,
    getChildren: () => []
  }));

  const refreshStatus = () => {
    if (!configuration().get('showStatusBar', true)) { status.hide(); return; }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const records = store.getSnapshot().records.filter((record) => Date.parse(record.timestamp) >= today.getTime());
    const cost = records.reduce((sum, record) => sum + (record.estimatedCost || 0), 0);
    const tokens = records.reduce((sum, record) => sum + record.totalTokens, 0);
    status.text = `$(pulse) LLM ${formatMoney(cost)}`;
    status.tooltip = `${tokens.toLocaleString()} tokens today · API-equivalent estimate`;
    status.show();
  };

  const getDashboardSnapshot = () => ({
    type: 'snapshot',
    snapshot: store.getSnapshot(),
    settings: readSettings(configuration()),
    lastImport
  });

  const importProvider = async (providerId, showProgress = true) => {
    if (importing) return importing;
    const provider = providers.get(providerId);
    if (!provider) throw new Error(`Unknown usage provider: ${providerId}`);
    const run = async (progress) => {
      const state = store.getImportState();
      const result = await provider.collect(state[providerId] || {}, ({ current, total }) => {
        progress?.report({ message: `${current.toLocaleString()} / ${total.toLocaleString()} session files` });
      });
      await store.upsert(result.records || []);
      await store.setImportState({ ...state, [providerId]: result.state || {} });
      lastImport = { providerId, at: new Date().toISOString(), ...result.stats };
      refreshStatus();
      return result;
    };
    importing = showProgress
      ? vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Importing ${provider.label || providerId}`, cancellable: false }, run)
      : run(null);
    try { return await importing; } finally { importing = null; }
  };

  const importCodex = async (showProgress = true) => {
    try {
      const result = await importProvider('codex-local', showProgress);
      if (showProgress) vscode.window.showInformationMessage(`Imported ${result.records.length.toLocaleString()} Codex usage records from ${result.stats.discoveredFiles.toLocaleString()} sessions.`);
      return result;
    } catch (error) {
      vscode.window.showErrorMessage(`Codex usage import failed: ${error.message || error}`);
      return null;
    }
  };

  const handleDashboardMessage = async (message) => {
    try {
      if (message.type === 'ready' || message.type === 'refresh') return;
      if (message.type === 'importCodex') await importCodex(true);
      else if (message.type === 'exportReport') await exportReport(store, message.filters || {});
      else if (message.type === 'importFile') await importUsageFile(store, refreshStatus);
      else if (message.type === 'saveSettings') await saveSettings(message.settings, store, configuration, refreshStatus);
      else if (message.type === 'savePrices') { await store.replacePrices(message.prices); refreshStatus(); }
      else if (message.type === 'resetPrices') { await store.replacePrices(require('./pricing').DEFAULT_PRICES); refreshStatus(); }
      else if (message.type === 'clearData') await confirmClear(store, refreshStatus);
      else if (message.type === 'openUrl' && /^https:\/\//.test(message.url)) await openInDefaultBrowser(message.url);
      else throw new Error('Unsupported dashboard action.');
    } catch (error) {
      vscode.window.showErrorMessage(`LLM Usage Monitor: ${error.message || error}`);
      throw error;
    }
  };

  const dashboardServer = createDashboardServer({
    mediaPath: path.join(context.extensionUri.fsPath, 'media'),
    assetPath: path.join(context.extensionUri.fsPath, 'assets'),
    getSnapshot: getDashboardSnapshot,
    handleMessage: handleDashboardMessage
  });
  const openDashboard = async () => openInDefaultBrowser(await dashboardServer.start());

  const scheduleAutoImport = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (!configuration().get('autoImport', true)) return;
    const minutes = Math.max(1, configuration().get('autoImportIntervalMinutes', 5));
    timer = setInterval(() => importCodex(false), minutes * 60_000);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('llmUsageMonitor.openDashboard', openDashboard),
    vscode.commands.registerCommand('llmUsageMonitor.importCodexHistory', () => importCodex(true)),
    vscode.commands.registerCommand('llmUsageMonitor.importUsageFile', () => importUsageFile(store, refreshStatus)),
    vscode.commands.registerCommand('llmUsageMonitor.exportReport', () => exportReport(store, {})),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (!event.affectsConfiguration('llmUsageMonitor')) return;
      await store.prune();
      scheduleAutoImport();
      refreshStatus();
    }),
    dashboardServer,
    { dispose: () => timer && clearInterval(timer) }
  );

  scheduleAutoImport();
  refreshStatus();
  if (configuration().get('autoImport', true)) setTimeout(() => importCodex(false), 2500);

  return {
    registerProvider(provider) {
      if (!provider?.id || typeof provider.collect !== 'function') throw new TypeError('A provider requires an id and collect(state, onProgress) function.');
      providers.set(provider.id, provider);
      return { dispose: () => providers.delete(provider.id) };
    },
    addUsageRecords: async (records) => { const value = await store.upsert(records); refreshStatus(); return value; }
  };
}

async function exportReport(store, filters) {
  const target = await vscode.window.showSaveDialog({
    title: 'Export LLM usage report',
    defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(), `llm-usage-report-${new Date().toISOString().slice(0, 10)}.html`)),
    filters: { 'Single-file HTML report': ['html'] }
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, Buffer.from(buildReport(store.getSnapshot(), filters), 'utf8'));
  const choice = await vscode.window.showInformationMessage('Usage report exported. Open it to view or print to PDF.', 'Open report');
  if (choice === 'Open report') {
    if (target.scheme !== 'file') throw new Error('The report must be saved locally before it can open in the system browser.');
    await openInDefaultBrowser(target.fsPath);
  }
}

async function importUsageFile(store, refreshStatus) {
  const selected = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Usage JSON': ['json'] }, title: 'Import usage records' });
  if (!selected?.[0]) return;
  const parsed = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(selected[0])).toString('utf8'));
  const records = Array.isArray(parsed) ? parsed : parsed.records;
  if (!Array.isArray(records)) throw new Error('Expected a JSON array or an object with a records array.');
  await store.upsert(records);
  if (Array.isArray(parsed.prices)) await store.replacePrices(parsed.prices);
  refreshStatus();
  vscode.window.showInformationMessage(`Imported ${records.length.toLocaleString()} usage records.`);
}

async function saveSettings(settings, store, configuration, refreshStatus) {
  const config = configuration();
  await config.update('historyDurationDays', Math.max(1, Number(settings.historyDurationDays) || 90), vscode.ConfigurationTarget.Global);
  await config.update('autoImport', Boolean(settings.autoImport), vscode.ConfigurationTarget.Global);
  await config.update('autoImportIntervalMinutes', Math.max(1, Number(settings.autoImportIntervalMinutes) || 5), vscode.ConfigurationTarget.Global);
  await config.update('codexHome', String(settings.codexHome || ''), vscode.ConfigurationTarget.Global);
  await config.update('showStatusBar', Boolean(settings.showStatusBar), vscode.ConfigurationTarget.Global);
  await store.prune();
  refreshStatus();
}

async function confirmClear(store, refreshStatus) {
  const answer = await vscode.window.showWarningMessage('Delete all locally stored usage records and import cache?', { modal: true }, 'Delete');
  if (answer !== 'Delete') return;
  await store.clear();
  refreshStatus();
}

function readSettings(config) {
  return {
    historyDurationDays: config.get('historyDurationDays', 90),
    codexHome: config.get('codexHome', ''),
    autoImport: config.get('autoImport', true),
    autoImportIntervalMinutes: config.get('autoImportIntervalMinutes', 5),
    showStatusBar: config.get('showStatusBar', true)
  };
}

function formatMoney(value) {
  if (value > 0 && value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function deactivate() {}

module.exports = { activate, deactivate };

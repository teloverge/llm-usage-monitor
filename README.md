<p align="center">
  <img src="assets/Teloverge-lum-logo.png" width="144" alt="Teloverge LLM Usage Monitor logo">
</p>

<h1 align="center">Teloverge LLM Usage Monitor for VS Code</h1>

<p align="center"><strong>Local token intelligence, forged for focused development.</strong></p>

Teloverge LLM Usage Monitor is a local-first VS Code extension that turns Codex session metadata into a task-keyed token and cost ledger. It tracks every statistic exposed by Codex token-count events, estimates cost using a dated price catalog, keeps configurable history, and exports a standalone HTML report that can be printed to PDF.

## What it does

- Imports existing and new Codex sessions from `CODEX_HOME` or `~/.codex`.
- Reads only session IDs, task names, timestamps, provider/model/reasoning metadata, token/context counters, and rate-limit/credit status.
- Never imports prompts, model responses, reasoning text, tool calls, file contents, or credentials.
- Groups usage by task name, timeframe, provider, model, and reasoning level.
- Records per-turn and final-call token counters, context-window utilization, rate-limit windows and resets, plan/credit status, individual limits, and limit-reached state when Codex provides them.
- Makes every column in the usage ledger sortable by clicking its heading or focusing it and pressing Enter/Space.
- Shows daily cost/token trends, cache efficiency, token composition, and top tasks.
- Stores records in VS Code's local `globalState` and enforces a configurable retention window.
- Exports the current filters as one self-contained `.html` file with a **Print / Save PDF** action.
- Accepts canonical usage JSON for Anthropic, OpenRouter, or any future source.
- Exposes a small extension API so another extension can register a live provider adapter.

## Important cost semantics

The dollar figure is an **API-equivalent estimate**, calculated from standard published per-token API rates. If Codex is authenticated through a ChatGPT plan, usage normally consumes included limits or credits and the estimate may not be an amount actually billed. Models without a configured price remain in token totals and display `—` for cost.

The bundled OpenAI rates were checked against [official API pricing](https://platform.openai.com/docs/pricing) on July 10, 2026. Prices are deliberately editable because model catalogs and provider rates change.

## Install and run

Prerequisites for development/package creation: Node.js 20+ and VS Code 1.95+.

1. Open this folder in VS Code.
2. Press `F5` and choose **Run Extension** if prompted.
3. In the Extension Development Host, run **LLM Usage Monitor: Open Dashboard** from the Command Palette.

After installation, select the **LLM Usage Monitor** chart icon in the Activity Bar and choose **Open Dashboard**. The status-bar estimate and Command Palette command open the same interactive dashboard in your default system browser. The dashboard is served only on the local loopback interface while VS Code is running.

To create an installable VSIX:

```bash
bun install
bun run check
bun test
bun run package
```

The package command fingerprints the extension's runtime source files and automatically increments the patch version once when those sources change. Repackaging unchanged sources keeps the same version. Then install the generated `.vsix` with **Extensions: Install from VSIX...**.

No production dependencies are used. Node is needed only for checks, tests, and VSIX packaging; VS Code supplies the extension-host runtime after installation.

## Codex historical import

Run **LLM Usage Monitor: Import Codex History**, or leave automatic import enabled. The adapter reads:

- `~/.codex/session_index.jsonl` for task names;
- `~/.codex/sessions/**/*.jsonl` for active session metadata;
- `~/.codex/archived_sessions/*.jsonl` for archived session metadata.

Codex token-count events are cumulative within a session. The importer takes the final cumulative counter for each turn and subtracts the preceding turn, producing one stable, deduplicated record per `session ID + turn ID`. Changed session files are re-read; unchanged files use an import cache.

Set `llmUsageMonitor.codexHome` if the extension host's home directory differs from the Codex home. This is common when switching between local Windows, WSL, containers, and SSH hosts—the setting applies where the VS Code extension host runs.

## Import format for other providers

Use **LLM Usage Monitor: Import Usage JSON** with either an array of records or an object containing `records` and optionally `prices`:

```json
{
  "records": [
    {
      "id": "openrouter:req_01J...",
      "timestamp": "2026-07-10T18:30:00.000Z",
      "taskName": "Refactor authentication middleware",
      "provider": "openrouter",
      "model": "provider/model-name",
      "reasoningLevel": "high",
      "inputTokens": 12000,
      "cachedInputTokens": 8000,
      "outputTokens": 1800,
      "reasoningOutputTokens": 900,
      "totalTokens": 13800,
      "lastTokenUsage": {
        "inputTokens": 12000,
        "cachedInputTokens": 8000,
        "outputTokens": 1800,
        "reasoningOutputTokens": 900,
        "totalTokens": 13800
      },
      "modelContextWindowTokens": 400000,
      "rateLimits": {
        "limitId": "provider-limit",
        "planType": "example-plan",
        "primary": { "usedPercent": 24, "windowMinutes": 300, "resetsAt": 1783738955 },
        "secondary": null,
        "credits": null,
        "individualLimit": null,
        "rateLimitReachedType": ""
      },
      "source": "openrouter-export"
    }
  ],
  "prices": [
    {
      "provider": "openrouter",
      "model": "provider/model-name",
      "input": 1.5,
      "cachedInput": 0.15,
      "output": 8,
      "effectiveDate": "2026-07-10",
      "source": "https://openrouter.ai/models"
    }
  ]
}
```

Rates are USD per one million tokens. `reasoningOutputTokens` is treated as a subset of `outputTokens`, matching Codex metadata, so it is not billed twice.

## Extension API

The activated extension returns:

```js
const api = await vscode.extensions
  .getExtension('local.llm-usage-monitor')
  .activate();

const disposable = api.registerProvider({
  id: 'anthropic-local',
  label: 'Anthropic local export',
  async collect(previousState, onProgress) {
    return {
      records: [], // canonical records shown above
      state: previousState,
      stats: { records: 0 }
    };
  }
});

await api.addUsageRecords(records);
```

Provider adapters own source-specific authentication and parsing. The monitor owns normalization, retention, pricing, presentation, and reporting.

## Commands

- **LLM Usage Monitor: Open Dashboard**
- **LLM Usage Monitor: Import Codex History**
- **LLM Usage Monitor: Import Usage JSON**
- **LLM Usage Monitor: Export HTML Report**

## Data and limitations

- VS Code does not provide a public cross-extension API for intercepting token usage from the Codex extension. This project therefore consumes Codex's local session metadata format, which may change in future Codex releases.
- Task names come from Codex's local session index. Sessions missing from that index receive a stable fallback name.
- The bundled catalog uses standard API rates, not Batch, Flex, Priority, regional uplift, tool-call charges, subscription fees, or plan-specific credit rates.
- `codex-auto-review` is retained as its reported model name but has no bundled dollar rate because it is an internal routing label rather than a published billable model ID.
- HTML export is the portable source of truth. Use the report's print button to save a PDF with the browser/OS print engine.

## Development

The extension is plain CommonJS JavaScript with no runtime packages:

```text
src/extension.js       VS Code lifecycle, commands, provider registry
src/dashboardServer.js loopback-only browser dashboard host
src/codexImporter.js   metadata-only Codex adapter
src/storage.js         normalization, deduplication, retention
src/pricing.js         price catalog and cost calculation
src/report.js          standalone HTML report generator
media/                 dashboard webview
test/                  Node built-in tests
```

# Portable Usage Host architecture

## Runtime topology

The Usage Monitor Server is the authoritative process. It owns the Usage Ledger, imports local provider history, performs Usage Analysis, executes Dashboard Actions, and serves the built browser app. Browser tabs and the VS Code extension are clients of that same per-user server.

```text
local Codex history
        |
        v
Usage Monitor Server ---> SQLite Usage Ledger
        |                       |
        |                       v
        +----------------> Usage Analysis
        |                       |
        +---- React browser <---+
        |
        +---- VS Code extension
```

The extension discovers an existing healthy server before starting one. This keeps ownership independent of whichever client opened first and permits the browser app to run without VS Code.

## Module boundaries

- `contracts` owns strict, versioned data shapes. Transport input is parsed at the boundary and unknown Dashboard Action fields are rejected.
- `usage-ledger` hides SQLite schema, migrations, parameterized statements, idempotency, and atomic provider imports.
- `usage-analysis` is the single source for filter semantics, API-equivalent costing, totals, timelines, and rankings. Graphs consume these projections rather than recalculating totals in React.
- `dashboard-actions` is the single mutation seam. Queries remain dedicated read endpoints.
- `server` composes these modules and owns loopback HTTP security and process discovery.
- `web` renders opinionated cost-first defaults and keeps configuration in an Advanced view.
- `vscode-extension` owns only VS Code commands, lifecycle, discovery/startup, and legacy migration.

## Source Hosts and fleet evolution

Every Usage Record belongs to a stable generated Source Host ID. A Source Host stores a preferred hostname plus bounded hostname and IP-address observations. IP addresses inform identification but are not stable identity keys.

Host Group membership is effective-dated so historical fleet totals retain the grouping that applied when usage occurred. With one machine, the local Source Host is the entire Fleet. The schema and analysis already support multiple hosts and groups without enabling network ingestion.

Future secondary machines run a Source Host Agent at per-user login. The agent will normalize local provider metadata and send only canonical Usage Records and Source Host observations to the primary server. Raw provider history files never leave the source machine.

Remote enrollment and upload remain disabled until the following boundary exists:

- explicit authenticated enrollment and revocation;
- encrypted transport and primary-server identity verification;
- replay-resistant, idempotent batches;
- bounded queues, retries, and storage;
- per-host authorization and audit outcomes.

## Process and data locations

The server uses a per-user application-data directory:

- Windows: `%LOCALAPPDATA%\Teloverge\LLM Usage Monitor`
- macOS: `~/Library/Application Support/Teloverge LLM Usage Monitor`
- Linux: `$XDG_STATE_HOME/teloverge-llm-usage-monitor`, falling back to `~/.local/state`

`LLM_USAGE_MONITOR_HOME` overrides the location for development and isolated testing. The directory contains the SQLite ledger, stable local Source Host identity, and a replaceable server discovery record.

## Native shell decision

The portable core is TypeScript on Node.js rather than Tauri or an all-Rust rewrite. Node keeps the server, importer, contracts, extension adapter, and React tooling in one language while remaining portable. Tauri can later be added as an optional desktop shell; it should connect to the same server contract instead of becoming a second authoritative backend.

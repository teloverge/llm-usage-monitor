# Portable Usage Host architecture

## Runtime topology

The Usage Monitor Server is the authoritative process. It owns the Usage Ledger, imports local provider history, performs Usage Analysis, executes Dashboard Actions, and serves the built browser app. Browser tabs and the VS Code extension are clients of that same per-user server.

```text
local provider stores -------------------+
                                          |
COMPUTE.md -> SSH -> remote inspector ----+--> Usage Monitor Server
                                                |          |
                                                v          v
                                         SQLite ledger  Usage Analysis
                                                |          |
                                                +---- React browser
                                                +---- VS Code launcher
```

The extension discovers an existing healthy server before starting one. This keeps ownership independent of whichever client opened first and permits the browser app to run without VS Code.

## Module boundaries

- `contracts` owns strict, versioned data shapes. Transport input is parsed at the boundary and unknown Dashboard Action fields are rejected.
- `usage-ledger` hides SQLite schema, migrations, parameterized statements, idempotency, and atomic provider imports.
- `usage-analysis` is the single source for filter semantics, API-equivalent costing, totals, timelines, and rankings. Graphs consume these projections rather than recalculating totals in React.
- `dashboard-actions` is the single mutation seam. Queries remain dedicated read endpoints.
- `server` composes these modules and owns loopback HTTP security and process discovery.
- The machine-inspection module hides provider detection and collection behind one result containing four explicit source statuses. The SSH adapter changes where that module runs without changing what the server consumes.
- `web` renders opinionated cost-first defaults and keeps configuration in an Advanced view.
- `vscode-extension` owns only VS Code commands, lifecycle, discovery/startup, and legacy migration.

## Source Hosts and fleet evolution

Every Usage Record belongs to a stable generated Source Host ID. A Source Host stores a preferred hostname plus bounded hostname and IP-address observations. IP addresses inform identification but are not stable identity keys.

Host Group membership is effective-dated so historical fleet totals retain the grouping that applied when usage occurred. The server reads managed hosts from a private `COMPUTE.md` registry. It runs the same bundled inspection code locally or over each host's existing OpenSSH connection, then commits every successful result to one ledger.

The remote process emits canonical Usage Records, quota snapshots, Source Host observations, and one status per requested Usage Source. Raw provider files never leave the source machine. Missing provider stores are normal `unavailable` results. SSH authentication and transport failures become `unreachable` results for every source on that host and do not roll back other hosts.

This is operator-triggered inspection, not a durable agent deployment. Remote enrollment and background upload remain disabled until the following interface exists:

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

`LLM_USAGE_MONITOR_COMPUTE_FILE` selects the managed compute registry. `LLM_USAGE_MONITOR_AGENT_PATH` selects the bundled inspector sent over SSH. A standalone source checkout defaults to `.armadai/COMPUTE.md` and `apps/source-host-agent/dist/cli.mjs`.

## Native shell decision

The portable core is TypeScript on Node.js rather than Tauri or an all-Rust rewrite. Node keeps the server, importer, contracts, extension adapter, and React tooling in one language while remaining portable. Tauri can later be added as an optional desktop shell; it should connect to the same server contract instead of becoming a second authoritative backend.

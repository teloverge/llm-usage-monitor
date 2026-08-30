<p align="center">
  <img src="assets/Teloverge-lum-logo.png" width="144" alt="Teloverge LLM Usage Monitor logo">
</p>

<h1 align="center">Teloverge LLM Usage Monitor</h1>

<p align="center"><strong>Local token intelligence for coding harnesses across managed hosts.</strong></p>

LLM Usage Monitor reads Codex, Claude Code, Grok Build, and OpenCode usage metadata, stores normalized usage in SQLite, and presents cost-first charts in a React browser app. It can run on its own or through the thin VS Code launcher.

The dollar total is an **API-equivalent estimate**: what the selected token usage would cost at configured standard API rates. It is useful for comparing subscription usage with API pricing, but it is not a billing claim.

## Current capabilities

- Inspects Codex, Claude Code, Grok Build, and OpenCode on every host listed in a `COMPUTE.md` registry. A missing source is reported as unavailable without blocking sources that exist.
- Uses the local filesystem for the current host and standard OpenSSH for remote hosts. The remote helper returns normalized usage metadata, never raw prompts, responses, credentials, file contents, or command output.
- Prices cache reads and cache writes separately, because a read costs a fraction of base input while a write costs a premium over it.
- Never imports prompts, responses, reasoning text, tool calls, file contents, or credentials.
- Shows API-equivalent spend as a single headline figure with its cost drivers by harness, model, and task, plus token composition and per-source plan limits.
- Reads plan limits for each harness from what it already stores locally: Codex's session rate-limit events and Claude Code's own cached utilization block, which Claude Code writes only when its `/usage` screen is opened, so a Claude Code plan appears once `/usage` has been viewed on that host. Each meter is stamped with the time the reading was taken, and a window whose reset time has passed is withheld rather than shown at a percentage that no longer applies. One account signed in on several hosts shows one meter, folded together by credential fingerprint.
- Attributes usage to the Credential in effect when it happened — a subscription, an API key, or a cloud gateway — and groups and filters by it. Attribution begins at the first observation and is never backdated, so usage from before the monitor started watching reads as unattributed rather than being credited to a credential that may not have been in use. Codex states its credential outright; Claude Code's is inferred from the environment and is labelled as inferred.
- Separates usage source, harness, model provider, and model as distinct identities, so one harness may use several providers and one provider may be reached through several harnesses.
- Reports metrics a source does not supply as unavailable rather than as zero.
- Filters Today, rolling Last 24 hours, 7/30/90 days, all retained history, task name, and Source Host.
- Uses hostname as the preferred Source Host label and retains IP addresses as informative observations.
- Groups Source Hosts into user-defined Host Groups from Settings, effective from the moment they are saved.
- Stores canonical Usage Records, Source Hosts, effective-dated Host Group membership, prices, and import state in SQLite.
- Runs the VS Code server on loopback and binds the standalone server only to the local host's Tailscale interface.

## Workspace structure

```text
apps/
  server/              authoritative local HTTP server, Codex and Claude importers
  web/                 React and Vite browser dashboard
  vscode-extension/    thin VS Code lifecycle and migration adapter
  source-host-agent/   future secondary-host collector and startup plans
packages/
  contracts/           strict versioned transport and domain schemas
  dashboard-actions/   one typed mutation interface
  usage-analysis/      canonical filtering, costing, and chart projections
  usage-ledger/        SQLite persistence and atomic imports
docs/architecture/     runtime and fleet design
CONTEXT.md             accepted domain vocabulary
```

## Develop and run

Prerequisites are native Node.js 24 or newer, Bun 1.3 or newer, and the Vite+ `vp` CLI. Bun remains the pinned package manager; use `vp` as the workflow entry point so dependency and task commands delegate consistently.

```powershell
vp install
vp run check
```

To build and launch the standalone app, including an initial managed-source refresh:

```powershell
vp run standalone
```

The standalone process reads the local Tailnet DNS name from `COMPUTE.md`, prints a URL that other Tailnet hosts can open, launches that URL in the default browser, and remains active until stopped with Ctrl+C. Run `vp run standalone:refresh` from another terminal to refresh without opening another browser tab.

The server writes its discovery record and SQLite ledger beneath the current user's application-data directory. It reads `.armadai/COMPUTE.md` from the launch directory by default. Set `LLM_USAGE_MONITOR_COMPUTE_FILE` to use another registry, `LLM_USAGE_MONITOR_HOME` to use an isolated data directory, and `LLM_USAGE_MONITOR_WEB_DIR` to serve a different built web directory. `LLM_USAGE_MONITOR_LISTEN_HOST` and `LLM_USAGE_MONITOR_ADVERTISED_HOST` override the listener and URL host. Provider locations can be overridden with `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`, `OPENCODE_DATA_DIR`, or `OPENCODE_DB`.

## VS Code extension

Build the complete runtime with `vp run build`. The extension bundle stages the server and built web app under `apps/vscode-extension/dist/runtime`.

When activated, the extension:

1. checks the per-user server discovery record;
2. reuses a healthy server if one exists;
3. otherwise starts the bundled server without a visible console using the configured Node.js 24+ executable;
4. creates a Windows system-tray menu for **Open Dashboard** and **Exit**;
5. performs a one-time, non-destructive migration of legacy VS Code `globalState` records;
6. opens the same browser dashboard used by the standalone server.

Set `llmUsageMonitor.nodePath` if `node` on `PATH` is not Node.js 24 or newer. The server is independent of the VS Code extension once running. Choosing **Exit** from the tray stops it and prevents background restart; **Open Dashboard** or **Refresh Codex History** explicitly starts it again.

## Managed host inspection

For each remote `COMPUTE.md` entry, the server pipes the bundled Source Host Agent to the entry's `Node command` over its SSH command. `Node command` defaults to `node`. No agent installation or inbound listener is required. The SSH account needs non-interactive authorization and Node.js 24 or newer. Remote inspections time out after 30 seconds on most hosts and 180 seconds on Windows hosts.

The dashboard's Settings → Sources table keeps the latest result for all four sources on every managed host. It distinguishes an available source, a source that is not installed, an unreachable host, and a source whose metadata could not be read.

Durable background enrollment remains disabled. The current path is an operator-triggered SSH inspection using the host authorization already declared in the private compute registry.

See [portable-usage-host.md](docs/architecture/portable-usage-host.md) for the runtime and future fleet topology.

## Privacy and security boundary

The VS Code server binds only to `127.0.0.1`. The standalone command binds to the local host's Tailnet DNS address, not every LAN interface. Both modes use a random unguessable route prefix, reject cross-origin Dashboard Actions, limit request bodies, validate strict schemas, and use parameterized SQLite statements. Remote inspection runs inside the remote host's Node.js process. Only normalized records and source status cross SSH.

## Cost semantics

Rates are USD per one million tokens and are editable in the dashboard. Cached input is priced separately when a rate exists. Reasoning output is a subset of output in Codex metadata and is not billed twice. Models without a configured price remain in token totals but contribute no estimated dollar amount.

## AI-Development Summary

Aside from a bit of manual tweaking, this application was generated by AI mostly using OpenAI GPT-5.6-Sol Medium and then redesigned with Claude Opus 5. Revision 0.2.0 was refactored using Matt Pocock's `codebase-design` skill. The sample images depict these AI-assisted tasks:

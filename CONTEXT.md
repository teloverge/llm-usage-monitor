# LLM Usage Monitor

LLM Usage Monitor turns local provider metadata into a portable, fleet-aware ledger of model usage and API-equivalent estimates.

## Language

**Usage Monitor Server**:
The authoritative local process that owns the Usage Ledger, Usage Analysis, and Dashboard Actions for one Fleet.
_Avoid_: Local Usage Host, server-lite, dashboard server

**Usage Ledger**:
The durable local record of normalized Usage Records, Source Hosts, Host Groups, pricing, and import progress.
_Avoid_: VS Code global state, cache, analytics database

**Usage Record**:
A normalized, deduplicated account of model usage attributable to one Source Host and one provider operation or turn.
_Avoid_: raw session event, prompt, telemetry event

**Usage Analysis**:
The canonical interpretation of Usage Records into filters, totals, rankings, graph series, and API-equivalent estimates.
_Avoid_: dashboard math, report aggregation

**Dashboard Action**:
A validated, versioned request to change state owned by the Usage Monitor Server.
_Avoid_: message, command string, API action

**Source Host**:
A computer whose local provider metadata produces Usage Records. It has a stable identity; hostname is its preferred label and IP addresses are informative observations only.
_Avoid_: Usage Monitor Server, machine name, IP identity

**Source Host Agent**:
A per-user collector for a secondary Source Host that normalizes local provider metadata, buffers it, and eventually sends it outbound to the Usage Monitor Server.
_Avoid_: server-lite, remote server, fleet server

**Host Group**:
A user-defined, effective-dated grouping of Source Hosts used for stable historical Usage Analysis.
_Avoid_: tag, current-only grouping

**Fleet**:
All Source Hosts governed by one Usage Ledger.
_Avoid_: tenant, cluster

**API-equivalent estimate**:
The estimated dollar cost of Usage Records under configured standard API token rates; it is not a claim about subscription billing.
_Avoid_: bill, actual spend, subscription charge

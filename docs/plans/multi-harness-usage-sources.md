# Multi-harness usage-source plan

Status: Proposed for implementation

## Outcome

Make LLM Usage Monitor able to collect, normalize, store, and analyze usage from multiple coding harnesses without changing the server, ledger, analysis, or clients for every new harness.

The initial target catalog is:

- Codex
- Claude Code
- Pi
- t3code
- Kimi Code CLI
- OpenCode
- Cursor
- Grok Build
- Gemini CLI
- Antigravity
- Kilo Code
- Qwen Code

The catalog is not a claim that every product exposes usable local token metadata. Each adapter must report whether its source is detected, configured, supported, unavailable, or failed.

## Definition of support

A harness is supported only when its adapter can:

1. discover or accept an explicitly configured local source;
2. read that source without credentials leaving the machine;
3. normalize stable usage operations into versioned Usage Records;
4. import idempotently and reconcile deleted or rewritten source history;
5. preserve harness, model-provider, model, session, and Source Host identity separately;
6. report collection diagnostics without exposing prompts, responses, secrets, or raw history;
7. pass the shared adapter conformance suite using reviewed fixtures; and
8. state which optional capabilities, such as cache metrics or quota snapshots, are unavailable.

An adapter validated only with fixtures is `experimental`. It becomes `verified` after a live smoke test against a supported harness version and operating system.

## Non-goals

- Do not intercept provider network traffic.
- Do not infer actual subscription charges from API-equivalent estimates.
- Do not require every harness to expose reasoning, caching, context-window, quota, or task-name metadata.
- Do not scrape encrypted or private stores by bypassing a harness's access controls.
- Do not make the Source Host Agent transport operational as part of this work.
- Do not implement all adapters before the shared seam is proven by two materially different adapters.

## Architectural decisions

### Keep three identities distinct

Every Usage Record must distinguish:

- `usageSourceId`: the adapter and source format that supplied authoritative usage evidence, such as `codex-local`;
- `harnessId`: the coding harness in which the work occurred, such as `t3code` or `cursor`;
- `provider`: the model provider or route, such as `openai`, `anthropic`, `google`, `moonshot`, or `alibaba`.

`model` remains a separate identity. A harness can use several providers, and one provider can be used through several harnesses.

When a wrapper such as t3code launches another harness, the adapter must not count both wrapper history and underlying authoritative usage as separate operations. Prefer provider request IDs when available. Otherwise, declare one source authoritative and expose the wrapper as `harnessId` metadata. Do not silently merge ambiguous records.

### Put one deep module at the collection seam

Add `packages/usage-sources`. Its external interface is the server and Source Host Agent's collection surface. Format discovery, filesystem traversal, parsing, checkpoints, native identifiers, and capability mapping stay behind this interface.

```ts
export interface UsageSourceAdapter {
  readonly descriptor: UsageSourceDescriptor;
  collect(request: CollectionRequest): Promise<CollectionBatch>;
}
```

Adapter configuration is injected when the adapter is created rather than added to `collect`. The request contains only the Source Host identity, previous checkpoint, current time, and cancellation signal.

`CollectionBatch` contains:

- normalized Usage Records;
- optional quota snapshots;
- the next opaque checkpoint;
- reconciliation mode: authoritative snapshot or explicit delta;
- bounded, non-sensitive diagnostics; and
- observed adapter and source-format versions when available.

The registry owns adapter selection and exposes two operations to callers:

```ts
listSources(): UsageSourceStatus[];
refreshSources(sourceIds?: string[]): Promise<RefreshSourcesOutcome>;
```

Clients do not receive adapter implementations or provider-native configuration shapes.

### Use a tolerant common core with explicit optional capabilities

Usage Records keep required input, output, and total token counts. Cache-read, cache-write, reasoning-output, context-window, task, session, and turn details must be optional or explicitly unavailable rather than fabricated.

Replace Codex-shaped `rateLimits` embedded in Usage Records with separate, normalized quota snapshots:

```ts
interface UsageQuotaSnapshot {
  usageSourceId: string;
  sourceHostId: string;
  accountScope?: string;
  plan?: string;
  observedAt: string;
  windows: Array<{
    id: string;
    label: string;
    usedPercent?: number;
    windowMinutes?: number;
    resetsAt?: string;
  }>;
  balance?: { amount: number; unit: string };
}
```

Provider-native details may be retained only in a bounded, versioned diagnostic payload that is not used by canonical analysis.

### Make import ownership explicit

Replace `commitProviderImport` with `commitSourceImport`. The ledger must record ownership by `usageSourceId` and `sourceHostId` and perform records, quota snapshots, checkpoint, and reconciliation in one transaction.

- Snapshot batches remove previously owned records that are absent from the new authoritative snapshot.
- Delta batches remove only explicit deleted IDs.
- Record IDs are stable and source-namespaced.
- A failed collection does not advance its checkpoint or partially change records.
- Removing one source never removes records owned by another source.

## Compatibility and migration

1. Introduce a versioned compatibility decoder for existing JSON payloads before tightening the canonical schema.
2. Map current `source: "codex-local"` records to `usageSourceId: "codex-local"` and `harnessId: "codex"`.
3. Preserve the existing SQLite file and configured prices.
4. Convert existing Codex import state to the new checkpoint shape transactionally.
5. Keep `import-codex` as a deprecated action for one release. Route it internally to `refresh-sources` with `sourceIds: ["codex-local"]`.
6. Keep the old VS Code command identifier for one release as a hidden alias so user keybindings do not break.
7. Do not remove compatibility decoding until at least one released version has migrated existing ledgers successfully.

## Dependency-ordered vertical slices

### Slice 0: Freeze current behavior

Goal: establish a safe refactoring baseline on the current `refactor/portable-usage-host` working tree.

Work:

- Decide which current dirty-tree changes belong to this branch before editing overlapping files.
- Add characterization fixtures for Codex discovery, cumulative-token deltas, stable IDs, task-name lookup, quota extraction, and unchanged-file checkpoints.
- Add a ledger test proving current import idempotency and documenting stale-record behavior.
- Record sanitized fixture provenance and harness version beside each fixture.

Acceptance:

- Current typecheck and 21 tests remain green.
- Codex behavior can be refactored without tests reaching into its parser internals.
- Fixtures contain no prompts, responses, repository paths, usernames, tokens, or credentials.

### Slice 1: Separate usage source, harness, provider, and model

Goal: establish the canonical identities needed by every later adapter.

Work:

- Add `usageSourceId` and `harnessId` to the versioned Usage Record contract.
- Make provider-specific token details optional with documented normalization rules.
- Add filters and rankings for harness and usage source while retaining provider/model behavior.
- Add a compatibility decoder and ledger migration for existing records.
- Update the domain language in `CONTEXT.md`.

Acceptance:

- Existing Codex ledgers open without data loss.
- Analysis can independently filter `harnessId=t3code` and `provider=openai`.
- Missing optional metrics render as unavailable, not zero, unless zero is source evidence.
- Pricing still keys only on provider and model.

### Slice 2: Introduce the usage-source module and generic refresh flow

Goal: move Codex behind the real collection seam without changing its observable results.

Work:

- Create `packages/usage-sources` with contracts, registry, fake adapter, and Codex adapter.
- Inject the registry into the server instead of constructing `CodexSessionProvider` directly.
- Add versioned `refresh-sources` and source-catalog contracts.
- Change the browser button to `Refresh sources` and show per-source outcomes.
- Add generic VS Code commands and settings while retaining deprecated Codex aliases.

Acceptance:

- A fake adapter and Codex adapter pass the same tests through `refreshSources`.
- The server, browser, and extension contain no Codex-specific branching outside compatibility aliases and adapter registration.
- Refreshing an unknown or disabled source fails closed with a typed outcome.
- One source failure does not hide successful outcomes from other requested sources.

### Slice 3: Add atomic source ownership and reconciliation

Goal: make repeated, rewritten, and deleted histories correct across multiple adapters.

Work:

- Add ledger ownership and quota-snapshot tables or equivalent indexed columns.
- Implement atomic snapshot and delta reconciliation.
- Migrate Codex checkpoint state.
- Add collision, rollback, deletion, source-removal, and concurrent-refresh tests.

Acceptance:

- Deleting a fixture session removes its previously imported records on the next authoritative scan.
- Rewriting a fixture changes records without duplicates.
- A parser failure leaves records and checkpoint unchanged.
- Two sources may use the same native session ID without collisions.
- `clear-records` clears records, ownership, quota snapshots, and checkpoints consistently.

### Slice 4: Generalize quota and capability reporting

Goal: remove Codex rate-limit assumptions from canonical records and UI.

Work:

- Add normalized quota-snapshot contracts and persistence.
- Convert Codex primary, secondary, individual, credit, and plan data in its adapter.
- Publish per-source capabilities and last collection status in the catalog.
- Render named quota windows without assuming `Primary` or `Weekly`.

Acceptance:

- A source with no quota capability renders `Not reported`, not an error.
- Multiple sources can show independent plans and quota windows.
- Old Codex snapshots migrate or expire without breaking history reads.
- Quota data is not included in token-cost calculations.

### Slice 5: Prove the seam with Claude Code

Goal: make the second adapter prove that the interface is real rather than Codex-shaped indirection.

Work:

- Research the current official local data format and retention behavior.
- Create sanitized fixtures for at least two sessions, model changes, missing optional metrics, and rewritten history.
- Implement discovery, parsing, stable IDs, checkpointing, and capability reporting inside the Claude Code adapter.
- Run the shared conformance suite unchanged.

Acceptance:

- Codex and Claude Code import through the same public interface.
- Adding Claude Code requires no new Dashboard Action variant or analysis branch.
- A combined dashboard separates harness, provider, and model correctly.
- The adapter remains `experimental` until a live Windows smoke test is recorded.

### Slice 6: Publish an adapter conformance kit

Goal: make untestable harness work reviewable and repeatable.

Work:

- Provide fixture builders, redaction checks, clock/filesystem injection, and standard behavioral tests.
- Test discovery-disabled, empty history, malformed entries, huge-line limits, partial writes, duplicate native IDs, checkpoint upgrades, snapshot deletion, and cancellation.
- Add an adapter metadata file containing supported harness versions, operating systems, evidence type, and capability declarations.
- Add a documented fixture-contribution workflow for users who can run other harnesses.

Acceptance:

- A new adapter can be tested without a live installation or network access.
- Fixture validation rejects likely secrets and raw conversational content.
- Experimental and verified status is visible in source catalog responses and the dashboard.
- Conformance tests assert only through the usage-source interface.

### Slice 7: Add remaining adapters by evidence tier

Implement adapters in small, separately reviewable changes. Research each harness immediately before implementation because paths and formats are time-sensitive.

Recommended order:

1. Open-source, inspectable formats: Pi, OpenCode, Gemini CLI, Qwen Code, Kimi Code CLI, Kilo Code.
2. Wrapper/orchestrator attribution: t3code, with explicit double-counting tests against underlying Codex or other harness history.
3. Closed or unstable local formats: Cursor, Grok Build, Antigravity.

Each adapter must answer before implementation:

- What local artifact or supported command is authoritative?
- Does it expose per-operation tokens or only sessions/requests?
- Are counters incremental or cumulative?
- Can history be rewritten or compacted?
- Which identifier is stable across rescans?
- Can the harness route to multiple providers?
- Can wrapper and underlying records overlap?
- Does reading the artifact violate documented product expectations?

Acceptance for every adapter:

- Adapter-specific fixtures plus the unchanged conformance suite pass.
- No core contract, action, ledger, analysis, or client branching is added solely for that harness.
- Missing metadata is reported honestly.
- Documentation states evidence source and verification level.
- Unsupported products appear as unsupported or unavailable, never as zero usage.

### Slice 8: Release hardening

Goal: ship the generic collection architecture without regressing existing users.

Work:

- Run formatting, lint, typecheck, tests, full build, extension packaging, and Windows installation smoke tests.
- Test migration from the latest released VSIX with a copied ledger.
- Validate browser refresh, source status, mixed-provider filtering, pricing, quota displays, shutdown, and restart.
- Update README and architecture documentation.
- Add pending work to `Unreleased`; when shipped, move only those entries into a new version section, preserving newest-first append-only release history.

Acceptance:

- Existing Codex users retain history, pricing, settings, and keybindings.
- A clean installation discovers sources without scanning unrelated directories.
- The packaged extension contains all registered adapters and no raw fixtures.
- Rollback instructions preserve the user's ledger.

## Testing strategy

Tests cross the same interfaces as production callers:

- Contract tests: compatibility decoding, strict transport parsing, canonical invariants.
- Usage-source tests: fake filesystem and clock through the shared adapter conformance kit.
- Ledger tests: atomic reconciliation and source ownership using temporary SQLite databases.
- Analysis tests: mixed harness/provider/model records and unavailable metrics.
- Server tests: generic refresh, catalog, partial failure, origin checks, and bounded bodies.
- Client tests: generic source labels, status, optional metrics, and quota windows.
- Packaging tests: staged runtime includes registry metadata and adapters.

Do not retain parser-internal tests once equivalent behavior is covered through the adapter interface. Keep pure normalization-function tests only where their edge cases would be obscured through fixtures.

## Completion gate

The architecture is ready for broad adapter work when all of the following are true:

- Codex and Claude Code use the same usage-source interface.
- No Codex-specific branch remains in the normal server, ledger, analysis, browser, or extension flow.
- Harness and provider are independently queryable.
- Snapshot deletion and failed-import rollback are proven.
- Optional capabilities do not require fabricated zeros.
- A fixture-only adapter can pass conformance and be labeled experimental.
- Adding a third adapter changes only adapter code, registration metadata, fixtures, documentation, and default pricing when applicable.

## Tomorrow's starting sequence

1. Preserve the current dirty-tree evidence with `git status --short --branch` and review overlapping files; do not clean or reset unrelated work.
2. Start Slice 0 by moving the existing Codex examples into sanitized end-to-end fixtures.
3. Write the first failing compatibility test for an existing Usage Record loaded as the new source/harness identity model.
4. Implement the smallest Slice 1 contract and decoder change that makes that test pass.
5. Add mixed `harnessId` versus `provider` analysis tests before changing filters or UI.
6. Stop at a green, reviewable vertical slice; do not begin individual new harness parsers until the generic registry and Codex adapter pass through the new interface.


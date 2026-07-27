# Credential attribution

Date: 2026-07-26
Status: Approved for planning
Branch: `feature/credential-attribution` (proposed)
Depends on: `2026-07-26-claude-plan-limits-design.md`

## Outcome

The dashboard reports what was spent and, after the plan-limits spec, how much
of a plan window is consumed. It cannot say which of those two things a given
record belongs to. Usage billed to an API key never touches a subscription
window, so a cost total can sit beside a 6% weekly meter while having nothing to
do with it. Nothing on screen distinguishes them.

This spec introduces the Credential as a first-class, effective-dated,
observed concept: a badge on each quota group, attribution of every Usage Record
to the Credential in effect when it happened, and Credential as a breakdown and
filter dimension.

## The evidence problem, stated up front

**No harness stamps a Usage Record with the credential that paid for it.**
Verified 2026-07-26:

- Claude transcripts carry no auth field of any kind. `apiKeySource`,
  `authSource`, `oauth`, `subscription`, `accountUuid`, `organizationUuid`: zero
  occurrences across 104 local files. The only identity field is `userType`,
  which reads `"external"` on all 5,367 lines that carry it.
- Codex `session_meta` carries `model_provider: "openai"` — a provider, not a
  credential.
- `~/.claude/sessions/*.json` carries pid, cwd, version, entrypoint. No auth.

What exists is current state, not history:

- **Codex, stated:** `~/.codex/auth.json` holds `auth_mode` (`chatgpt` or
  `apikey`), a possibly-null `OPENAI_API_KEY`, and `tokens.account_id`.
- **Claude, implied only:** `oauthAccount` in the config cache shows a
  subscription exists, and `customApiKeyResponses.approved` shows a custom API
  key was approved on this machine at some point, with no statement about
  whether it is in use.

Every design decision below follows from this: the signal is real but thin, and
the work is to use it without overclaiming.

## Scope

In scope:

- `Credential` and `Credential Observation` in CONTEXT.md.
- `credentialObservationSchema` in contracts.
- A `credential_observations` table and its reader/writer in the ledger.
- Collectors for Codex (`auth.json`) and Claude (config cache plus environment).
- `effectiveCredential` in `usage-analysis`, `byCredential` in `OverviewView`,
  `credentialId` in `filtersSchema`.
- Credential badge in the Plan limits panel, including the API-key warning.
- A Credential row in Breakdown and a filter chip in the topbar.
- A `credentials` collection on `OverviewView`, so a badge can be rendered
  without a second request.

Explicitly out of scope:

- **Backfilling attribution before the first observation.** See Decisions.
- **Reading any credential file.** `~/.claude/.credentials.json` and the
  `tokens` block of `~/.codex/auth.json` beyond `account_id` stay unread.
- Per-request attribution. The finest grain available is per-record via
  effective dating.
- Editing or declaring credentials by hand. Observations are discovered.
- Distinguishing several API keys used against one account. All API-key usage on
  one (source, host) with one fingerprint is one Credential.

## Decisions

| Decision          | Choice                                                    | Why                                                                                              |
| ----------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Attribution       | Derived in analysis, never stamped on records             | A better observation tomorrow retroactively improves every past answer                           |
| Effective-from    | First time a credential was seen, not last time we looked | `auth.json` mtime moves on every token refresh; last-looked would leave all history unattributed |
| Pre-observation   | A distinguished unattributed bucket; never backfilled     | The guard that stops a thin signal becoming a confident lie                                      |
| Stored identifier | SHA-256 fingerprint, first 12 hex                         | Distinguishes accounts without the ledger ever holding an account identifier                     |
| Confidence        | An `inferred` flag, rendered                              | Codex states its mode; Claude's is deduced. Same instinct as unreported-versus-zero              |
| API-key meters    | Explicit warning on the quota group                       | API-key usage does not consume the window shown above it; a bare percentage there misleads       |
| Cardinality       | One credential per (usage source, host) at an instant     | Mirrors Host Group's one-group-at-a-time resolution                                              |
| Modes             | `subscription`, `api-key`, `bedrock`, `vertex`, `unknown` | The distinctions that change whether plan windows apply                                          |

### Why effective-from must mean "first seen"

`~/.codex/auth.json` is rewritten on every OAuth token refresh, so its mtime is
almost always recent. If each import wrote an observation dated now, the
effective-from of a credential that has been in use for six months would advance
daily, and `effectiveCredential` would find no observation preceding any record.
Every record would resolve to unattributed, permanently, while the ledger filled
with thousands of identical rows.

So: **an observation is written only when the mode or fingerprint differs from
the latest observation for that (usage source, source host).** Identical
re-observation is a no-op. `effectiveFrom` then means what it says, and
attribution reaches back to the first time the monitor saw that credential.

### Why nothing is backfilled

The first observation says nothing about the month before it. Records older than
the earliest observation for their (source, host) resolve to an `unattributed`
bucket that is rendered as such and never merged into a real credential. On a
ledger with existing history this means most rows start unattributed and the
proportion improves over time — which looks like a broken feature and is instead
the only honest reading of the evidence. The UI says so in words rather than
leaving the reader to infer it.

## Domain vocabulary

For CONTEXT.md:

**Credential**:
The means by which a Harness reaches a model provider: a subscription account,
an API key, or a cloud gateway. Identified by a non-reversible fingerprint; the
underlying secret is never read or stored.
_Avoid_: token, key, auth, login

**Credential Observation**:
A discovered, effective-dated fact that one Usage Source on one Source Host was
reaching its provider by a given Credential. Unlike Host Group membership it is
observed rather than declared, and it is never backdated.
_Avoid_: session auth, credential history, login event

## Contract changes

### `CredentialObservation` (new)

```ts
{
  usageSourceId: string;
  sourceHostId: string;
  mode: "subscription" | "api-key" | "bedrock" | "vertex" | "unknown";
  fingerprint: string;      // 12 lowercase hex; "" when the source states no account
  plan?: string;
  inferred: boolean;
  effectiveFrom: string;    // ISO instant, first seen
  observedAt: string;       // ISO instant, most recent confirmation
}
```

The credential id used as a bucket key and filter value is
`` `${mode}:${fingerprint}` ``, so it is stable, non-secret, and derivable
without a lookup.

### `UsageQuotaSnapshot`

Unchanged. An earlier draft filled its unused `accountScope` with the
fingerprint, to join a meter to the usage attributed to it. That join already
exists: a quota snapshot and a credential observation are both keyed by
(usage source, source host), so the meter and its credential meet on the key
they already share. Filling `accountScope` would add a second, redundant join —
and for Codex it would mean threading a fingerprint out of `auth.json` and into
the importer that produces snapshots, which reads a different file entirely.
`accountScope` stays unused.

### `UsageFilters`

Adds `credentialId?: string`.

### `OverviewView`

Adds `byCredential: RankedUsage[]` and `credentials: CredentialObservation[]`,
the latter so the view can render a badge and label a filter chip without a
second request.

## Ledger changes

One additive table in `migrate()`, alongside the existing
`CREATE TABLE IF NOT EXISTS` statements:

```sql
CREATE TABLE IF NOT EXISTS credential_observations (
  usage_source_id TEXT NOT NULL,
  source_host_id  TEXT NOT NULL REFERENCES source_hosts(id),
  mode            TEXT NOT NULL,
  fingerprint     TEXT NOT NULL,
  payload         TEXT NOT NULL,
  effective_from  TEXT NOT NULL,
  observed_at     TEXT NOT NULL,
  PRIMARY KEY (usage_source_id, source_host_id, mode, fingerprint, effective_from)
);
```

`recordCredentialObservation` reads the latest row for the (source, host); if
its mode and fingerprint match, it advances `observed_at` only. Otherwise it
inserts a new row with `effective_from = observedAt`. That comparison is the
whole of the first-seen rule and is where its test belongs.

No migration id is needed — the table is additive and empty ledgers and
populated ones behave identically.

## Analysis changes

`effectiveCredential(observations, usageSourceId, sourceHostId, timestamp)`
returns the observation with the greatest `effectiveFrom` at or before
`timestamp` for that pair, or `undefined`. It mirrors `effectiveGroup`, and the
two should read as siblings.

`analyzeUsage` gains `credentials` as input, ranks `byCredential` keyed by
credential id with `unattributed` for records that resolve to nothing, and
applies `filters.credentialId` in `filterUsageRecords` alongside the existing
predicates.

## Collectors

| Harness | Source                            | Mode                                                                                                                                                                 | Fingerprint                           | Confidence |
| ------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------- |
| Codex   | `~/.codex/auth.json`              | `auth_mode`: `chatgpt` → subscription, `apikey` → api-key                                                                                                            | SHA-256 of `tokens.account_id`        | observed   |
| Claude  | config cache + server environment | env `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX` → those; else `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` → api-key; else `oauthAccount` present → subscription; else unknown | SHA-256 of `oauthAccount.accountUuid` | inferred   |

The gateway switches are tested **before** the API key, correcting an earlier
draft that had it the other way round. Bedrock and Vertex are explicit routing
decisions, and a shell that sets `CLAUDE_CODE_USE_BEDROCK` alongside an
Anthropic key is reaching the model through Bedrock — reporting that as a direct
API key would name the wrong biller.

The fingerprint is always taken from `oauthAccount.accountUuid`, never from key
material, including in `api-key` mode. Hashing is one-way, but the promise is
not to read credentials at all, and an account identifier is enough to tell two
accounts apart. An api-key credential with no OAuth account on the machine
carries an empty fingerprint and is still distinguished by its mode.

Codex's collector reads `auth_mode` and `account_id` and nothing else from that
file. The token bodies are not read, hashed, or logged.

### The hole in Claude's inference, kept visible

Claude Code launched from a shell carrying `ANTHROPIC_API_KEY` that the Usage
Monitor Server's own process cannot see will be read as subscription. There is
no local artefact that would reveal it. This is why Claude observations are
flagged `inferred` and rendered marked, rather than presented with the same
authority as Codex's.

## Web changes

- **Plan limits panel:** each quota group gains a credential badge —
  `ChatGPT subscription`, `API key`, `Bedrock` — with inferred ones marked. An
  api-key credential renders an explicit note that the usage it covers does not
  count against the window shown.
- **Breakdown:** a Credential row alongside harness and model. The unattributed
  bucket is labelled as unattributed, never blank, never zero.
- **Topbar:** a credential filter chip. The topbar already wraps.
- New i18n keys in `en.json` and `es.json` for the badge modes, the inferred
  marker, the api-key note, and the unattributed label.

Labels are resolved in the view, not the analysis layer — the established split:
analysis keys by raw credential id, the view renders it.

## Module boundaries

| Module                                       | Responsibility                                           |
| -------------------------------------------- | -------------------------------------------------------- |
| `apps/server/src/codex-credential.ts` (new)  | Read `auth.json`, produce an observation                 |
| `apps/server/src/claude-credential.ts` (new) | Infer from config cache and environment                  |
| `packages/usage-ledger`                      | Persist observations under the first-seen rule           |
| `packages/usage-analysis`                    | `effectiveCredential`, `byCredential`, the filter        |
| `apps/web/src/model/credential.ts` (new)     | Id-to-label resolution and badge view model, unit-tested |

## Testing strategy

- **First-seen rule:** identical re-observation writes no row and advances
  `observed_at`; a changed mode or fingerprint writes one. This is the test that
  protects against the mtime failure described above.
- **`effectiveCredential`:** record before every observation → unattributed;
  record between two observations → the earlier; record exactly at an
  `effectiveFrom` → that one.
- **No secret is stored:** assert that no persisted payload contains the raw
  account id or any token substring, given fixtures that contain them.
- **Fingerprint stability:** the same account id yields the same 12 hex across
  runs and processes.
- **Collectors:** `auth.json` absent, malformed, `apikey` mode, null
  `OPENAI_API_KEY`; Claude with and without each environment variable.
- **Filter and ranking** in `usage-analysis`, including a ledger where every
  record is unattributed.
- **Label resolution** in `apps/web/test`, matching how that suite tests today.

## Documentation

- CONTEXT.md gains the two terms above.
- README gains a capability line: usage is attributed to the Credential observed
  at the time it happened, attribution begins at first observation, and Claude's
  credential is inferred rather than stated. The "never imports credentials"
  claim stays unqualified — fingerprints are one-way and no secret is read.
- CHANGELOG entry.

## Risks

| Risk                                                   | Mitigation                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| Claude's mode is inferred from the wrong process's env | `inferred` flag, rendered; documented in README                    |
| Existing history is mostly unattributed                | Explicit unattributed labelling and a note in the panel            |
| A user reads the filter as authoritative billing       | Badge wording ties attribution to observation, not to a bill       |
| Harnesses change their local auth layout               | Collectors fail closed to `unknown`; absence yields no observation |

## Completion gate

`vp run check` passes; the Plan limits panel shows a credential badge per group
with Codex marked observed and Claude marked inferred; Breakdown shows a
Credential row with an unattributed bucket for pre-observation history; the
filter chip narrows totals; no persisted payload contains a raw account id.

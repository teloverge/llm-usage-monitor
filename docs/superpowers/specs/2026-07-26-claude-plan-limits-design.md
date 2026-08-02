# Claude plan limits

Date: 2026-07-26
Status: Approved for planning
Branch: `feature/claude-plan-limits` (proposed)

## Outcome

The Overview panel labelled "Plan limits" shows meters for Codex only. Claude
Code runs on the same machine against a plan with its own windows, and that row
is simply absent — not reported as unknown, absent. This spec adds it.

`ClaudeSessionProvider.collect` returns `quotaSnapshots: []` today, and its
header comment explains why: the transcripts carry no rate-limit evidence. That
comment is correct and stays correct. Confirmed by grep across 104 local
transcripts — no `apiKeySource`, `authSource`, `rate_limit`, `resets_at`, or any
other quota field appears in any of them.

The evidence is elsewhere. Claude Code caches its own quota numbers in
`~/.claude.json` under `cachedUsageUtilization`, refreshed from Anthropic
whenever Claude Code runs. Reading that file is the whole of this work.

## Scope

In scope:

- A new `apps/server/src/claude-quota.ts` that reads the config cache and
  produces a `UsageQuotaSnapshot`.
- Wiring it into `ClaudeSessionProvider.collect`.
- Rendering the snapshot's age in the Plan limits panel, for every source.
- Dropping expired windows at projection time, for every source.
- Extracting Codex's `windowLabel` into a module both harnesses share.
- Rewriting the now-misleading half of the `claude-importer.ts` header comment.

Explicitly out of scope:

- **Reading `~/.claude/.credentials.json`.** See Decisions.
- **Credential attribution.** Which subscription or API key paid for a given
  record is a separate spec — see
  `2026-07-26-credential-attribution-design.md`. This spec fills `plan` on the
  snapshot and nothing more.
- Historical quota series. Snapshots stay latest-per-(source, host).
- Notifications or thresholds on quota crossings.
- A settings field for the config file location. The two-location probe covers
  both known layouts; a setting can follow if a third appears.

## Decisions

| Decision            | Choice                                              | Why                                                                                                      |
| ------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Source of truth     | `cachedUsageUtilization` in `~/.claude.json`        | Only local source of true percentages; keeps "calls no vendor account servers" intact                    |
| Module              | Separate `claude-quota.ts`, not inside the importer | Different file, format, and failure mode from transcript parsing                                         |
| Parsing posture     | Lenient, never throws                               | Foreign unversioned data; five null codename slots on one account prove it reshapes                      |
| Windows             | Driven by `limits[]`, all entries                   | Anthropic's own normalized list; survives a new per-model cap with no code change                        |
| Window duration     | Cross-referenced, never assumed                     | `limits[]` omits duration; matching `resets_at` against `five_hour`/`seven_day` is Anthropic stating it  |
| Plan label          | `oauthAccount`, not `.credentials.json`             | Same fetch as the utilization, so it cannot drift out of step with the meter                             |
| `.credentials.json` | Never read                                          | A credential store; the README's "never imports credentials" is worth more than a plan string            |
| Staleness           | `observedAt` shown; expired windows dropped         | The number is a cache of unknown age; an unqualified percentage would be a claim the data cannot support |
| Expiry filtering    | In `analyzeUsage`, not the importer                 | A snapshot is written once and served for days; expiry decided at import is stale before it is read      |
| `severity`          | Ignored                                             | Thresholds are the dashboard's own and apply identically to every source                                 |
| Extra usage         | Mapped, fail-closed                                 | User's explicit choice; both blocks are disabled on the only observable account, so it ships dormant     |

### Why `.credentials.json` stays unread

It holds `claudeAiOauth.subscriptionType: "pro"` and
`rateLimitTier: "default_claude_ai"`, while `oauthAccount` in the config cache
holds `organizationType: "claude_max"` and
`organizationRateLimitTier: "default_claude_max_20x"` with a
`subscriptionCreatedAt` of 2026-07-25. Two local files disagree about the plan.

Beyond picking the fresher one, there is a rule worth stating plainly: the
project promises never to import credentials, and the cheapest way to keep a
promise like that is to never open the file. The plan string is not worth the
exception.

## Evidence: the shape of `cachedUsageUtilization`

Observed 2026-07-26 on a `claude_max` account. This is undocumented and will
change; the parser treats every field as optional.

```jsonc
{
  "fetchedAtMs": 1785105458317,
  "accountUuid": "…",
  "utilization": {
    "five_hour":  { "utilization": 2, "resets_at": "2026-07-27T03:10:00.127734+00:00", … },
    "seven_day":  { "utilization": 6, "resets_at": "2026-07-31T22:00:00.127758+00:00", … },
    "seven_day_opus": null, "tangelo": null, "iguana_necktie": null, …,
    "limits": [
      { "kind": "session",        "group": "session", "percent": 2, "severity": "normal",
        "resets_at": "2026-07-27T03:10:00.127734+00:00", "scope": null, "is_active": false },
      { "kind": "weekly_all",     "group": "weekly",  "percent": 6, "severity": "normal",
        "resets_at": "2026-07-31T22:00:00.127758+00:00", "scope": null, "is_active": true },
      { "kind": "weekly_scoped",  "group": "weekly",  "percent": 0, "severity": "normal",
        "resets_at": null, "scope": { "model": { "display_name": "Fable" } }, "is_active": false }
    ],
    "extra_usage": { "is_enabled": false, "monthly_limit": null, "used_credits": null,
                     "utilization": null, "currency": null, "decimal_places": null, … },
    "spend": { "used": { "amount_minor": 0, "currency": "USD", "exponent": 2 },
               "limit": null, "percent": 0, "enabled": false, … }
  }
}
```

The null codename slots (`tangelo`, `iguana_necktie`, `omelette_promotional`,
`nimbus_quill`, `cinder_cove`, `amber_ladder`) are why `limits[]` drives the
meters rather than the sibling fields: the array is the stable, self-describing
representation and the fields around it are experiment slots.

## Locating the file

Probe in order, first readable wins:

1. `<home>/.claude.json` — the `CLAUDE_CONFIG_DIR` layout.
2. `<home>.json` — which for the default home `~/.claude` is `~/.claude.json`.

`home` is the value `ClaudeSessionProvider` already resolves for transcripts, so
a user who has pointed the importer elsewhere gets the quota from the same
place. Neither file present, or neither parseable, yields no snapshot — which
renders as "Not reported", the existing and correct behaviour.

A size guard rejects anything over 32 MB before parsing. The file accumulates
project history and is not bounded by anything the monitor controls.

## Mapping to `UsageQuotaSnapshot`

| Field           | Source                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `usageSourceId` | `"claude-code-local"`                                                                                |
| `sourceHostId`  | The local host, as the transcript importer already resolves it                                       |
| `observedAt`    | `fetchedAtMs`, as an ISO instant                                                                     |
| `plan`          | `oauthAccount.organizationRateLimitTier` less a leading `default_`; falls back to `organizationType` |
| `windows`       | One per `limits[]` entry                                                                             |
| `balance`       | `spend` then `extra_usage` — see below                                                               |

`accountScope` is left unset by this spec. The credential attribution spec fills
it with a fingerprint.

### Windows

For each entry in `limits[]`:

| Window field    | Rule                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`            | `kind`, plus a scope discriminator when scoped: `weekly_scoped:fable`                                      |
| `label`         | From `windowMinutes` via the shared `windowLabel` when known; otherwise from `kind`, plus the scoped model |
| `usedPercent`   | `percent`                                                                                                  |
| `windowMinutes` | Cross-referenced (below); omitted when it cannot be established                                            |
| `resetsAt`      | `resets_at`, renormalized                                                                                  |

**`id` uniqueness is load-bearing.** It is the React key in `QuotaMeters`, and
`weekly_scoped` legitimately repeats once per scoped model.

**`resetsAt` must be renormalized.** Anthropic emits
`2026-07-27T03:10:00.127734+00:00` — an offset with microsecond precision.
`usageQuotaWindowSchema` uses Zod `.datetime()`, which rejects offsets outright,
so a passthrough value fails validation at the ledger boundary. It goes through
`new Date(value).toISOString()`.

**Duration is read as evidence.** `limits[]` carries no `window_minutes`. Rather
than hardcoding session = 300, compare the entry's `resets_at` against
`utilization.five_hour.resets_at` and `seven_day.resets_at`; an exact match is
Anthropic stating the duration, and yields 300 or 10080 respectively. No match
means `windowMinutes` is omitted and the label falls back to the kind
(`Session window`, `Weekly window`, `Weekly · Fable`). Nothing is invented.

An unrecognised `kind` produces a labelled window from the kind itself rather
than being dropped. A new cap should appear, even ugly, rather than vanish.

### Extra usage and spend

Both blocks are disabled on the only observable account, so this code ships
dormant and unverified against populated values. It is written to fail closed:
any field absent, the whole block is omitted rather than guessed at.

- `spend.enabled` → `balance = { amount: used.amount_minor / 10^used.exponent, unit: used.currency }`.
- `extra_usage.is_enabled` → an additional window, id `extra-usage`, label
  `Extra usage`, `usedPercent` from `utilization`, no `resetsAt` — it is a
  monthly spend cap and the cache states no reset instant.
- When `spend` is disabled but `extra_usage` is enabled, `balance` comes from
  `used_credits` scaled by `decimal_places`, with `currency` as the unit.

The two blocks read as two generations of one feature, hence the precedence.

## Staleness

`observedAt` comes from `fetchedAtMs`, so the ledger's newest-wins upsert
behaves correctly, and the panel renders it as an "as of" line per quota group —
Codex included, which has the same exposure and gains the same honesty.

Windows whose `resetsAt` lies in the past are dropped in `analyzeUsage`, which
already accepts an injectable `now`. A snapshot left with no windows still
renders its group, plan, and as-of line: "we know this account exists and have
nothing current about it" is a different statement from "no such account".

## Contract changes

None. `usageQuotaSnapshotSchema`, `usageQuotaWindowSchema`, and the ledger's
`(usage_source_id, source_host_id)` upsert already carry everything. This is the
payoff for the multi-harness snapshot design — a second harness reporting quota
requires no schema movement.

## Analysis changes

`analyzeUsage` filters expired windows out of `quotaSnapshots` before projecting
them, using its existing `now`.

## Web changes

- `QuotaMeters` renders an as-of line per group from `snapshot.observedAt`,
  formatted with the existing `formatDateTime`.
- New i18n key `quota.asOf` in `en.json` and `es.json`.
- Meters, glyphs, thresholds, and the empty state are untouched. A Claude
  snapshot is another entry in the list the panel already maps over.

## Module boundaries

| Module                                        | Responsibility                                                   |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `apps/server/src/claude-quota.ts` (new)       | Locate, parse, and map the config cache. No transcript knowledge |
| `apps/server/src/quota-window-label.ts` (new) | `windowLabel`, shared by both harnesses                          |
| `apps/server/src/claude-importer.ts`          | Transcripts; calls `claude-quota` and passes the result through  |
| `packages/usage-analysis`                     | Expiry filtering at projection time                              |
| `apps/web/.../quota-meters.tsx`               | Renders the as-of line                                           |

## Testing strategy

Against a fixture derived from the real file with account identifiers redacted:

- Offset-and-microsecond `resets_at` normalizes to a `Z` instant the contract
  accepts. This is the test that would have caught a passthrough.
- Scoped entries get distinct ids; two scoped models produce two windows.
- Duration cross-reference matching and not matching.
- Unknown `kind` yields a labelled window rather than a crash or a drop.
- Absent `cachedUsageUtilization`, malformed JSON, absent file, oversized file:
  each yields no snapshot and no throw.
- `spend` and `extra_usage`, enabled and disabled. Dormant code without tests
  breaks silently on the day an account enables it.
- Expiry filtering in `usage-analysis` with a fixed `now`, covering both
  harnesses and the all-windows-expired case.
- Round trip through `apps/server/test/quota-round-trip.test.ts`.

## Documentation

- The `claude-importer.ts` header comment currently asserts "No quota
  snapshots". Rewrite it: the transcripts still carry none, and the quota comes
  from the config cache instead. That distinction is the reason the module is
  separate and belongs where a reader will meet it.
- README gains a capability line for the config-cache read. The "calls no vendor
  account servers" claim stays accurate and unqualified — this reads a file
  Claude Code already wrote.
- CHANGELOG entry.

## Risks

| Risk                                        | Mitigation                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| Anthropic reshapes the cache                | Lenient parsing, every field optional, absence yields no snapshot                    |
| The cache is arbitrarily stale              | As-of line; expired windows dropped                                                  |
| Extra usage mapping is wrong when populated | Fail-closed; flagged here as unverified                                              |
| `.claude.json` holds personal data          | Only `cachedUsageUtilization` and `oauthAccount` are read; nothing else is persisted |

## Completion gate

`vp run check` passes; the Plan limits panel shows a Claude group with its
windows, plan, and as-of line on a machine where Claude Code has run; a machine
where it has not still reads "Not reported".

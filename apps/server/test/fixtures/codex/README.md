# Codex fixtures

Hand-authored, not captured from a real machine. Session and turn identifiers are
synthetic. These files contain no prompts, responses, reasoning text, tool calls,
file contents, repository paths, usernames, or credentials — only the event
envelopes and token counters the importer reads.

Shape mirrors Codex rollout JSONL as of 2026-07. Update this note if the shape is
re-derived from a newer version.

`session_index.jsonl` is not read by `codex-characterization.test.ts` — that test
builds an equivalent `Map` literal in-process and passes it directly to
`parseSession`, since `readTaskIndex` (the function that reads this file) is not
exported. This file exists so a fixture consumer that does go through
`CodexSessionProvider.collect` (later refactor tasks) has a matching index to read;
keep its one entry in sync with the `Map` literal in the test.

`sessions/2026/07/rollout-2026-07-21T09-00-00-66666666-7777-8888-9999-aaaaaaaaaaaa.jsonl`
is a separate, single-turn fixture (Task 14) whose `turn_context` payload has no
`effort` field at all. It's a distinct file rather than a fourth turn appended to
the main fixture above, so it doesn't disturb that fixture's existing
turn-count/id/delta assertions. It proves an absent `effort` produces a record
with no `reasoningLevel` key, not the literal string `"unknown"`.

`archived_sessions/2026/06/rollout-2026-06-15T08-00-00-bbbbbbbb-...jsonl` (Task 17)
is deliberately the OLDEST session here while also being the LAST one `collect`
walks — `collect` concatenates `sessions` and then `archived_sessions`, sorting
each independently, so archived files always iterate after live ones. It reports a
different plan (`pro`, 5.5% / 9.75%) from the 07-20 fixture (`plus`, 41.5% / 78.25%)
so that "newest observation wins" is distinguishable from "last one written wins".
Without this file the quota recency guard in `collect` is unreachable by the suite.

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

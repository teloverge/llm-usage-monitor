# Codex fork fixtures

Hand-authored, like `../codex`, and kept in a separate home so the quota and
turn-count assertions over that directory are undisturbed. Ids are synthetic
but UUIDv7-shaped, because the importer relies on that shape: a turn whose id
sorts below the session's own id began before the session was forked.

Two rollouts, shaped after a real spawn as of 2026-08:

- `rollout-2026-08-01T10-00-00-01900000-0000-…0001.jsonl` is the parent. Two
  turns, cumulative totals 1,200 then 3,600.
- `rollout-2026-08-01T10-06-00-01900000-0100-…0002.jsonl` is the agent "Gibbs"
  it spawned. It opens with its own `session_meta` (carrying `parent_thread_id`,
  `forked_from_id`, and the spawn source), then REPLAYS the parent: the
  parent's `session_meta` and both parent turns, the second of them a mid-turn
  snapshot (2,400, below the parent's finished 3,600). Its own single turn then
  reaches a cumulative 3,100, so the agent's real usage is 3,100 − 2,400 = 700.

`session_index.jsonl` names only the parent. The agent must inherit that name.

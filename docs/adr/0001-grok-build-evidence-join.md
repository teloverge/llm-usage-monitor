# Grok Build usage evidence is a join, with honesty fallbacks

Grok Build is the first Usage Source whose token counts and model identity live
in different files: tokens appear only in the global `~/.grok/logs/unified.jsonl`
(`shell.turn.inference_done`, keyed by session id, no model id), while model
identity appears only in per-session files. We decided each Usage Record takes
its tokens from one `inference_done` event and its model from the session's
`events.jsonl` `turn_started` timeline — the model in effect at the inference
timestamp — falling back to `summary.json`'s `current_model_id` when the
timeline is missing, and recording the model as unknown when both are gone.
A model is never guessed, matching the ledger's "unavailable rather than zero"
convention.

## Considered Options

- **Session-level attribution** (`current_model_id` alone): simplest, but
  durably misattributes every turn that preceded a mid-session model switch.
- **Turn-timeline join** (chosen): correct across model switches; costs one
  extra content-free metadata file per session.
- **Transcript join** (`chat_history.jsonl` assistant lines): no more accurate
  than the timeline, and requires opening a file of conversation content, which
  the privacy boundary forbids. Rejected on that ground alone — do not "fix"
  the importer by reading it, even though it is the only per-message source of
  `model_id`.

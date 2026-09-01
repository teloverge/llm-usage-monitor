# Contributing

## Read This First

This is a small, single-maintainer project and it is not actively accepting contributions right now.

You can still report a bug or open a PR, but please do so knowing there is a real chance it gets closed, deferred indefinitely, or never reviewed.

Bug reports go in [Issues](https://github.com/teloverge/llm-usage-monitor/issues/new/choose). Feature requests and proposals also go through the issue form, but open one to discuss the idea **before** writing code for it.

If that sounds annoying, that is because it is. The project is still early and the goal is to keep scope, quality, and direction under control.

## What Is Most Likely To Be Accepted

Small, focused bug fixes.

Small reliability fixes, especially in the importers (Codex, Claude Code, Grok Build, OpenCode) and the remote-host collector.

Small performance improvements.

Tightly scoped maintenance work that clearly improves the project without changing its direction.

## What Is Least Likely To Be Accepted

Large PRs.

Drive-by feature work.

Opinionated rewrites.

New usage sources, new chart types, or anything that expands product scope without being asked for first.

Anything that weakens the privacy stance: the monitor never imports prompts, responses, reasoning text, tool calls, file contents, or credentials, and the remote helper never returns them. PRs that move in the other direction will be closed.

If you open a 1,000+ line PR full of new features, it will be closed quickly.

## If You Still Want To Open A PR

Keep it small.

Explain exactly what changed.

Explain exactly why the change should exist.

Do not mix unrelated fixes together.

Run `vp run check` (format, lint, typecheck, test, build) before opening the PR.

If the PR makes anything resembling a UI change, include clear before/after images.

If the change depends on motion, timing, transitions, or interaction details, include a short video.

If the reviewer has to guess what changed, the PR is much less likely to be reviewed.

## Discuss Changes First

If you are thinking about a non-trivial change, open an issue first and describe the idea.

That still does not mean the PR will be wanted, but it gives you a chance to avoid wasting your time.

## Be Realistic

Opening a PR does not create an obligation on the maintainer's side.

It may be closed. It may be ignored. You may be asked to shrink it. The idea may be reimplemented later in a different form.

If you are fine with that, proceed.

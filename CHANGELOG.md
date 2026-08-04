# Changelog

## 0.5.1

- Plan limits moved from the Overview to their own tab, organized as one card per credential: the subscription is the thing, the harness merely where it was observed from, so one account seen from several machines is a single card. The account currently in use is marked "In use".
- Multiple subscriptions to the same provider are now retained side by side. Switching accounts no longer overwrites the previous account's last-known meters; each snapshot is stamped with the credential in effect when it was observed, and a reading from before the monitor could identify the account is superseded once the same source reports who it is.
- The Period chip is the tab's recency filter — "All retained" reveals accounts long since logged out, whose expired windows are withheld as always — and the Host and Credential chips narrow the cards. The task search does not apply to plan limits.

## 0.5.0

- Grok Build sessions are now monitored alongside Codex and Claude Code. Usage is read from Grok Build's local logs, never from its conversation transcripts. Each turn is attributed to the model actually in effect at that moment — including across a mid-session model switch — and a turn whose model can no longer be determined reads as unknown rather than being guessed.
- Grok Build's plan appears beside the other plan limits. The free tier shows its plan name without inventing a meter for a cap it does not have; a paid tier's weekly on-demand window will appear as a meter once a cap exists.
- Grok Build usage is attributed to the credential it states it is using, fingerprinted from the account identifier; key material is never read. grok-4.5 is priced by default at OpenRouter's published rates, editable in Settings like every other rate.
- Cache writes are not observable in Grok Build's metadata and read as unavailable rather than zero.

## 0.4.2

- The dashboard is now available in Russian. Count-bearing phrases use colon phrasing («Записей: 42»), which stays grammatical for every number where a single plural form could not. Machine-authored and not reviewed by a native speaker, like the other non-English languages.
- Every entry in the Language picker now carries its ISO code beside the endonym — "English (en)", "Русский (ru)" — a second anchor for a reader who has landed in a script they cannot read.

## 0.4.1

- The dashboard is now available in German, French, Japanese, Simplified Chinese, and Hindi, alongside the existing English and Spanish. Numbers, dates and compact figures follow each language's own conventions — Japanese and Chinese count tokens in units of 万, Hindi groups digits in lakhs. Any regional Chinese browser tag resolves to the one Chinese offered, which the language picker labels as Simplified. Translations are machine-authored and have not been reviewed by native speakers.

## 0.4.0

- Plan limits now include Claude Code, read from the utilization block Claude Code caches locally. Its session and weekly windows appear beside Codex's, with per-model weekly caps shown separately when a plan has them.
- Each plan limit states when its reading was taken, because these figures are caches that refresh only while their harness is running. A window whose reset time has already passed is withheld rather than shown at a percentage that no longer applies.
- Usage is attributed to the Credential that paid for it — a subscription, an API key, or a cloud gateway — with a badge on each plan-limit meter, a Credential breakdown, and a Credential filter. API-key, Bedrock and Vertex usage is called out where it appears beside a plan window, because it never consumed that window.
- Attribution starts from the first time a credential was observed and is never backdated. Usage from before then reads as unattributed, which on an existing ledger is most of it at first; the proportion falls as new usage accumulates.
- Plan limit window names now follow the interface language, including the Codex windows that have always been shown in English. A per-model cap keeps the model's own name untranslated. A window recorded by an older version keeps its English name until its harness refreshes the reading.

## 0.3.2

- The dashboard reads in the language of your browser, with English and Spanish available and a Language setting to override the choice. Numbers, dates and percentages follow the selected language; costs always name the currency explicitly as `USD` rather than a bare `$`, which is ambiguous outside the US.
- Chart axis ticks no longer carry the currency — the unit is stated once on the Cost/Tokens toggle above the chart — and no longer round two different gridlines to the same label, which made an axis read `2K` twice.
- Source Host names resolve in the view rather than on the server, so a host whose reported hostname is a MAC address shows a stable "Source Host N" label consistently everywhere it appears, in whichever language is selected.

## 0.3.1

Maintenance release. No functional changes; version bump only.

## 0.3.0

- Host Groups are configurable from Settings: create, rename, populate and retire them. Grouping takes effect from the moment it is saved, so historical totals keep the grouping that applied when the usage happened.
- Fixed retiring a Host Group silently reverting itself, which left Save enabled and made the group appear to un-retire. An unsaved draft was compared against a baseline that had already been overwritten, so untouched cards were treated as edited and stale drafts were kept.
- Fixed `setHostGroup` leaving a host in two groups at once when it was moved, which made its group resolution depend on insertion order.
- Host Group breakdown rows now show the group's name instead of its internal id.
- Fixed a failed price save reporting success.
- Import Claude Code usage from local session transcripts under the Claude home directory, populating the `claude-code` harness the dashboard already knew how to render. One record per billed request, deduplicated by message id because Claude Code writes one transcript line per content block and repeats the same usage figures on each.
- Separate cache writes from cache reads in Usage Records and model prices. The two bill at opposite ends of the rate card, so the previous single cached figure could not price an Anthropic record correctly; Codex records, which report one undifferentiated figure, cost exactly as they always did.
- Add Anthropic rates to the default price catalog, and let a newly supported provider's defaults reach installs whose price catalog already exists, which previously only `codex-auto-review` could do.

## 0.2.1

- Rebuild the dashboard as a cost-first cockpit: one headline figure, a single-axis trend with a Cost/Tokens toggle, driver panels by harness, model, and task, and a context rail for token mix, plan limits, and hosts.
- Replace the token composition donut with a stacked bar, dashed gridlines with solid hairlines, and plan-limit progress bars with status-aware meters.
- Move rate configuration into Settings and rename Advanced to Breakdown, which now groups by harness, model, task, host, or Host Group with nested rollups and a table view.
- Add canonical `usageSourceId` and `harnessId` to every Usage Record, with a compatibility decoder so existing ledgers open unchanged.
- Add normalized usage quota snapshots with named windows, replacing the Codex-shaped rate limits previously embedded in records.
- Add session-level children under task rankings and harness attribution to History sessions.
- Stop counting records whose source does not report caching toward cache efficiency, which previously understated the ratio, and disclose the token coverage the ratio speaks for.
- Report a reasoning level the source did not supply as "not reported" rather than fabricating `unknown`.
- Fix `vp run dev`, which ran the server under Bun; Bun does not implement `node:sqlite`, so the documented development command failed on every machine. The server now runs under Node.
- Add Oxlint and Oxfmt to the pinned validation workflow, remove the redundant Activity Bar import link, and rename incremental Codex imports to refresh actions.
- Restart stale shared runtimes after an extension update, load newly added default prices such as `codex-auto-review`, and condense the Pricing workspace.
- Add `codex-auto-review` to the default OpenAI pricing catalog using the supplied July 22, 2026 rate source.
- Group Advanced usage into collapsible provider and model levels, and roll logically identical History tasks into summed task rows with collapsible session details.
- Start the Windows Usage Monitor Server without a visible console and add a system-tray menu for opening the dashboard or fully exiting until the next explicit launch.
- Roll Advanced model usage up by base model with expandable reasoning levels and explicit Ultra and Fast mode indicators across the dashboard.
- Group History by date, task, model, reasoning level, or Source Host with collapsible sections, row estimates, and group-level API-equivalent totals.
- Replace the generated web header mark with the approved Teloverge LLM Usage Monitor asset.
- Prevent raw Source Host identifiers and MAC-shaped hostnames from being rendered or returned in History views.
- Reorganize the project as a TypeScript workspace with separate React web, shared server, VS Code extension, Source Host Agent, contracts, analysis, action, and SQLite ledger modules.
- Add cost-first automatic charts, API-equivalent spend totals, rolling Last 24 hours, and fleet-aware Source Host and Host Group projections.
- Run the browser and VS Code clients against one loopback-only server, with VS Code discovery/startup and one-time legacy-state migration.
- Reserve a fail-closed, per-user Source Host Agent for future authenticated secondary-host collection on Windows, macOS, and Linux.

## 0.1.6 – 0.1.9

These patch versions were produced by the automatic pre-packaging bump and were never sectioned individually; the entries below shipped across them.

- Transfer the product identity from PsiForge to Teloverge and replace the parent, dashboard, README, package, and Activity Bar branding with the Teloverge LLM Usage Monitor logo.
- Sort expanded reasoning-level rows from highest effort to lowest.
- Add the Usage Monitor view icon and remove redundant generated activation events from the extension manifest.
- Add collapsed model rows to the Analysis cost pivot with expandable reasoning-level breakdowns.
- Refine Pricing table density, increase supporting copy size, balance the overview cards, and prevent model-spend labels and values from overlapping.
- Tighten dashboard spacing, controls, metrics, charts, tables, and responsive margins to show more usage data at once.

## 0.1.5

- Add PsiForge branding and a dedicated analytics child mark to the README, extension metadata, dashboard, and Activity Bar.
- Automatically increment the extension patch version once when critical runtime sources change before packaging.
- Add a filter-aware grouped bar graph that follows the Analysis pivot configuration.
- Use Bun for dependency installation, validation, tests, and extension packaging.
- Add Today, Since Reset, and Since Weekly Reset timeframe filters using timestamp-precise rate-limit window boundaries.
- Improve Pricing table alignment and unit formatting, show USD symbols, and link provider names to pricing sources instead of displaying a Source column.
- Add a filter-aware Analysis tab for configurable pivot-style rows, columns, values, and aggregate calculations.
- Open the interactive dashboard and exported HTML reports in the system's default browser instead of inside VS Code.
- Record per-turn totals, final model-call tokens, model context-window utilization, and complete Codex rate-limit, credit, plan, and limit-reached snapshots.
- Make every usage-history column sortable with mouse or keyboard controls.
- Add an LLM Usage Monitor Activity Bar view with one-click dashboard and import actions.
- Include the expanded usage statistics in standalone HTML reports.

## 0.1.0

- Initial local-first Codex usage importer.
- Task-keyed token and API-equivalent cost history.
- Dashboard filters and summaries by timeframe, provider, model, and reasoning level.
- Editable dated model pricing catalog.
- Canonical JSON import and provider registration API.
- Standalone printable HTML report export.

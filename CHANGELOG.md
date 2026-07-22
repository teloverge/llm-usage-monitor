# Changelog

## Unreleased

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

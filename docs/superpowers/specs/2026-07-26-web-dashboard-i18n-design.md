# Web Dashboard Internationalization (i18next)

Date: 2026-07-26
Branch: `feature/i18n-i18next`

## Goal

Make the Usage Monitor dashboard readable in a language other than English, without
loosening the guarantee that its numbers, dates, and currency stay deterministic and
unambiguous.

English remains the source of truth. Spanish ships alongside it as a pilot, chosen to
prove the wiring against a real second language rather than to serve a known audience.

## Scope

In scope: `apps/web` — the React dashboard.

Out of scope, deliberately:

- **VS Code extension** (`apps/vscode-extension`). Its command titles, configuration
  descriptions, and `viewsWelcome` copy live in `package.json`, which i18next cannot
  reach. VS Code localizes these through `package.nls.<locale>.json` and `vscode.l10n`
  — a separate mechanism warranting its own change.
- **Server and agent CLIs** (`apps/server`, `apps/source-host-agent`). Console output
  and logs stay English so they remain searchable and quotable in bug reports.

## Decisions

| Area            | Decision                                                                                 |
| --------------- | ---------------------------------------------------------------------------------------- |
| Locales         | `en` (source of truth), `es`                                                             |
| Stack           | `i18next` + `react-i18next`, resources bundled statically                                |
| Formatting      | Follows the UI language; currency always renders the ISO code                            |
| Axis ticks      | Bare compact numbers; unit stated once on the measure toggle                             |
| Selection       | `navigator.language` on first load, overridable in Settings, persisted to `localStorage` |
| Glossary        | UI-visible terms translated; identifiers, field names, and log text untouched            |
| Locale plumbing | Module-level current locale in `format.ts`, set via `setFormatLocale`                    |
| Testing         | Format helpers exercised against both locales explicitly, never via OS locale            |

### Why bundled, not lazily fetched

`i18next-http-backend` buys code-splitting this app does not need — roughly 120 strings
across two locales is a few kilobytes — and costs offline-friendliness it does need. The
dashboard's stated premise is that everything stays on the machine (`app.tsx`, footer).
Fetching locale files over HTTP would contradict that, and would introduce an async init,
a Suspense boundary, and a first-paint flash for no benefit.

`main.tsx` imports `./i18n/index.ts` for its side effect before rendering, so the first
paint is already in the resolved language.

### Why the currency code, everywhere

`Intl` output for the two locales, verified on Node 24:

|                                       | `en-US`                 | `es`                 |
| ------------------------------------- | ----------------------- | -------------------- |
| `currencyDisplay: "code"`             | `USD 1,234.56`          | `1234,56 USD`        |
| compact + code                        | `USD 8.9K`              | `8,9 mil USD`        |
| plain compact                         | `892.4K`                | `892,4 mil`          |
| `dateStyle: medium, timeStyle: short` | `Jul 26, 2026, 3:04 PM` | `26 jul 2026, 15:04` |

Note that the code precedes the number in English and follows it in Spanish, and that
Spanish does not group four-digit integers (`1234`, not `1.234`). Both are correct CLDR
behaviour and neither should be overridden.

This changes English output too: `$142.30` becomes `USD 142.30`. That is intended. The
dashboard reports US-dollar API rates to readers who may not be in the US, and a bare `$`
is ambiguous across a dozen currencies.

## Module layout

```
apps/web/src/i18n/
  index.ts            i18n.init() with statically imported resources; side-effect module
  locales/en.json     source of truth
  locales/es.json
  language.ts         supported-locale list, resolution, localStorage persistence
apps/web/src/views/settings/language.tsx    the selector
apps/web/src/model/format.ts                gains setFormatLocale(); per-locale formatter cache
```

## Locale plumbing

The active locale is module-level state in `format.ts`, not a parameter threaded through
call sites. This keeps `model/` free of a locale argument that its pure functions do not
conceptually need — `cacheStat`, `usage-groups`, and the scale helpers call format
helpers without ceremony. It carries two obligations.

**Formatters are cached per locale, never captured at module load.** `format.ts` currently
builds five `Intl` objects once at import time. They become a small map keyed by locale,
populated on first use and reused thereafter. `setFormatLocale(lng)` swaps which key is
active; it never mutates a live formatter, so no cached formatter can go stale.

**Listener registration order is a correctness requirement.** `i18n/index.ts` registers
`i18n.on("languageChanged", setFormatLocale)` at init, before any component mounts.
i18next fires listeners in registration order, and `react-i18next` registers its
re-render listener when the first component mounts — so ours always runs first, and the
module global is current before React re-renders. Reversed, every formatted value would
lag one language change behind. This is invisible at the call site and must carry a
comment at the registration site.

### Determinism

Nothing reads the OS locale, at any point. `format.ts` never falls back to the runtime
default; the locale is always one the app resolved and validated. This preserves the
property the current `LOCALE = "en-US"` pin exists to protect — contributor and CI
machines with a non-English default locale produce identical output — while allowing the
user's chosen language to drive formatting.

## String extraction

A single `translation` namespace with keys grouped by screen: `nav.*`, `filters.*`,
`period.*`, `headline.*`, `overview.*`, `breakdown.*`, `history.*`, `settings.*`,
`common.*`. Splitting into multiple namespaces buys nothing at this volume.

Two patterns need judgement rather than mechanical replacement.

### Concatenated fragments become one interpolated key

Spanish reorders what English joins with `+`. Each of these collapses into a single key
with named interpolation:

- `headline.tsx` — `"API-equivalent cost of work · " + period`
- `headline.tsx` — coverage text `+ " · estimated at your configured API rates, not a bill"`
- `app.tsx` — the screen-reader `<h1>`, `"Usage Monitor — " + view`
- `app.tsx` — the two-clause footer
- `quota-meters.tsx` — `` `${glyph} ${shown}%` ``; the percentage also moves onto `Intl`
  rather than string-appending `%`

### The two timeframe lists stay two lists

`app.tsx` holds Title Case timeframe labels for the Period dropdown (`"Last 7 days"`);
`headline.tsx` holds lowercase ones for mid-sentence use (`"last 7 days"`). Centralizing
strings makes merging them look attractive. Do not. Spanish does not title-case, and
other languages capitalize differently again, so sentence-position casing must stay a
per-locale decision. They remain `period.select.*` and `period.inline.*`.

## The model-layer boundary

`model/` does not import `t`. It stays pure and independently tested. Two shapes cover
every case.

**Label lookups accept the translated string as a parameter.** `harnessLabel` returns
`"Unknown harness"` for unrecognized ids; it becomes `harnessLabel(harnessId, unknownLabel)`.
This matches an idiom already in the codebase — `rank-list.tsx` takes `emptyLabel` as a
prop. Product names inside `HARNESS_LABELS` (`"Codex"`, `"Claude Code"`) are not
translated in any locale.

**Sentence builders return a key and params, not prose.** `formatCoverage` currently
returns one of three English sentences. It becomes `coverageMessage({ records, priced })`
returning `{ key, params }`, with the caller applying `t`. Its documented contract — always
returns something renderable, so the call site needs no conditional — is preserved; it
returns a key instead of a sentence.

The zero case (`"No records in this period"`) is a distinct message, not a plural form of
the others, so it gets its own key rather than relying on plural suffixes. Neither English
nor Spanish has a CLDR `zero` plural category, and depending on one would be wrong in both.

## Formatting changes

### `formatMoneyCompact` → `formatNumberCompact`

Its sole caller is the Y-axis `tickFormatter` in `headline.tsx`. Axis ticks drop the
currency entirely: the existing code documents a ~7-character budget for the 48px gutter,
and `USD 8.9K` (8) and `8,9 mil USD` (11) both overflow it, producing exactly the clipping
that comment was written to prevent. Widening the gutter in every chart to accommodate the
longest locale would steal plot area permanently.

The unit moves to the measure toggle: `"Cost"` becomes `"Cost (USD)"`. The hero figure
directly above the chart already renders the full `USD 8,947.32`, so the axis reads
unambiguously.

### `formatPercent` moves onto `Intl`

It currently builds its output as `` `${(ratio * 100).toFixed(1)}%` ``, which bypasses
`Intl` entirely and hardcodes both the decimal point and the symbol's position. Spanish
writes `12,5 %` — comma separator, and a space before the sign. It becomes an
`Intl.NumberFormat` with `style: "percent"`, which also removes the manual `* 100`.

### `formatBucketLabel` moves onto `Intl`

The current implementation slices fixed-width ISO strings positionally to yield `07-20`.
Spanish orders day before month, so this must go through `Intl.DateTimeFormat`.

The two bucket shapes require different time zones, and conflating them is a silent
off-by-one-day bug:

- **Date-only buckets** (`2026-07-20`, every timeframe except `last24`) must format with
  `timeZone: "UTC"`. `new Date("2026-07-20")` parses as UTC midnight; formatting that in
  any negative-offset zone renders the _previous_ day.
- **Hourly buckets** (`2026-07-20T09:00:00.000Z`, `last24` only) are true instants and
  format in local time, consistent with `formatDateTime`'s existing behaviour — "resets at
  3pm" is only useful in the reader's own zone.

The year continues to be omitted; every bucket on an axis shares it.

## Glossary

UI-visible terms are translated. Identifiers, field names, `usageSourceId`/`harnessId`
values, and log output are not — the code layer is untouched by this work.

Fixed Spanish renderings for the `CONTEXT.md` ubiquitous language, so the terms stay
ubiquitous within each locale and later translators inherit decisions instead of
re-guessing:

| English                 | Spanish                       |
| ----------------------- | ----------------------------- |
| Source Host             | Host de origen                |
| Host Group              | Grupo de hosts                |
| Usage Record            | Registro de uso               |
| Harness                 | Entorno                       |
| Fleet                   | Flota                         |
| Model rates             | Tarifas de modelo             |
| Unknown harness         | Entorno desconocido           |
| Unpriced                | Sin tarifa                    |
| Not reported            | No informado                  |
| API-equivalent estimate | Estimación equivalente de API |

Product names — Codex, Claude Code, Usage Monitor, Teloverge — are never translated.

## Language selection

`language.ts` resolves in order: a validated value in `localStorage`, then
`navigator.language` normalized to a supported base tag (`es-419` and `es-MX` both resolve
to `es`), then `en`.

The selector is a third tab in the existing Settings shell, beside Model rates and Host
groups, holding a single `<select>`. The topbar chip row already carries Period, Host,
search, Refresh sources, and the gear; language is a set-once preference and does not
belong in that traffic. The tab can absorb further display preferences later.

Language is per-viewer, not Fleet state, so it needs no Usage Ledger schema change and no
new Dashboard Action.

`i18n/index.ts` sets `document.documentElement.lang` on init and on every change.
`index.html` hardcodes `lang="en"` today; screen readers select pronunciation from this
attribute, so a Spanish page left marked `en` is read aloud with English phonetics. The
`<title>` is a product name and stays as-is.

## Testing

`apps/web/test/format.test.ts` is updated and parameterized:

- Assertions move to the new output — `formatMoney(142.3)` is `"USD 142.30"` in `en` and
  `"142,30 USD"` in `es`.
- Each helper runs against both locales, calling `setFormatLocale(locale)` first and
  restoring `en` in a `finally`. The setter is what makes the locale explicit; no test
  depends on the machine's default.
- `formatBucketLabel` gains cases for both bucket shapes in both locales, including a
  date-only bucket asserted under a negative-offset time zone to pin the UTC behaviour.
- `harnessLabel` gains a case covering the injected unknown-label parameter.
- `coverageMessage` is tested for the key and params it returns, not for rendered prose.

## Non-goals and known risks

- **No key-parity test.** Testing was scoped to the format helpers, so a key present in
  `en.json` and absent from `es.json` falls back to English silently, mid-page, with
  nothing failing. This is the most probable failure mode in practice and is roughly ten
  lines to guard. Recorded here so the gap is a known one.
- **No hardcoded-string check.** New UI can reintroduce untranslated literals without any
  test or lint rule catching it.
- **Layout is not covered by tests.** Spanish runs 15–20% longer than English. The table
  headers in `history.tsx` and `rates.tsx` are the tight spots. This needs a visual pass;
  a green suite does not mean the page is not overflowing.
- **Deferred**: RTL support, lazy-loaded namespaces, pluralization test coverage, and
  localization of the VS Code extension and CLI surfaces.
- **Pluralization is structurally foreclosed, not merely deferred.** Counted strings receive
  a pre-formatted string from `model/format.ts`, not the raw number — `t()` never sees a
  `count` interpolation value — so i18next's plural machinery cannot engage no matter how a
  key is later authored. Adding real plurals means passing both the raw number as `count`
  and the formatted string at every such call site, which is a call-site-by-call-site change,
  not a locale-file change. (English already reads "1 tasks · 1 sessions · 1 records" for a
  single-item period; this is pre-existing behaviour from before this branch, not something
  introduced here, and is recorded rather than fixed.)
- **Runtime API error text stays English.** `apps/web/src/api.ts`'s thrown error messages are
  deliberately not translated, on the same searchability grounds as the equivalent CLI
  decision: an error a user pastes into a search engine or an issue is more useful in English.

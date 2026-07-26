import type en from "./locales/en.json";

/**
 * Binds `t()` to the English resource file, which makes `bun run typecheck` fail
 * on a key that does not exist. That is the only automated check standing behind
 * the string-extraction work — the repo has no React test runner — so it is
 * doing real load-bearing work, not just improving autocomplete.
 *
 * It checks keys against `en` only. A key MISSING from `es.json` still falls
 * back to English silently at runtime; see the spec's non-goals.
 *
 * `strictKeyChecks: true` is required, not cosmetic. i18next's default (non-strict)
 * `t` overload set widens `key` to plain `string` on the two `defaultValue`
 * signatures — `t(key, { defaultValue })` and `t(key, defaultValue, options)` —
 * so a call written with a `defaultValue` would type-check with any typo'd key,
 * silently opening the exact bypass this file exists to close.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    strictKeyChecks: true;
  }
}

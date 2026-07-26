import type en from "./locales/en.json";

/**
 * Binds `t()` to the English resource file, which makes `bun run typecheck` fail
 * on a key that does not exist. That is the only automated check standing behind
 * the string-extraction work — the repo has no React test runner — so it is
 * doing real load-bearing work, not just improving autocomplete.
 *
 * It checks keys against `en` only. A key MISSING from `es.json` still falls
 * back to English silently at runtime; see the spec's non-goals.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

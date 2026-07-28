import type { UsageQuotaWindow } from "@llm-usage-monitor/contracts";

/**
 * The wording for one quota window, in the reader's language.
 *
 * The server sends both a rendered English `label` and, where it could classify
 * the window, a `kind`. This prefers `kind` and falls back to `label`, which
 * covers two real cases: a snapshot written before `kind` existed and still
 * sitting in the ledger, and a cap whose kind this codebase has never seen. In
 * both, English wording beats a missing meter.
 *
 * The count is recomputed here from `windowMinutes` rather than carried, so the
 * two sides cannot disagree about how many weeks "10080 minutes" is.
 *
 * `scope` is a model's own display name and is appended untranslated, exactly as
 * a model id is everywhere else in this dashboard.
 */
export function quotaWindowLabel(
  window: UsageQuotaWindow,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const base = baseLabel(window, t);
  return window.scope ? `${base} · ${window.scope}` : base;
}

function baseLabel(
  window: UsageQuotaWindow,
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const minutes = window.windowMinutes ?? 0;
  switch (window.kind) {
    case "session":
      return t("quota.window.session");
    case "extra-usage":
      return t("quota.window.extraUsage");
    // Singular gets its own key rather than "1 week": every locale words a
    // one-unit window idiomatically ("Weekly window", not "1-week window"), and
    // the plural keys interpolate {{n}} rather than i18next's `count`, which
    // would pull in plural-category resolution this project does not use.
    case "weekly": {
      const weeks = Math.floor(minutes / 10_080);
      return weeks > 1 ? t("quota.window.weeks", { n: weeks }) : t("quota.window.weekly");
    }
    case "daily": {
      const days = Math.floor(minutes / 1_440);
      return days > 1 ? t("quota.window.days", { n: days }) : t("quota.window.daily");
    }
    case "hourly":
      return t("quota.window.hours", { n: Math.floor(minutes / 60) });
    case "minute":
      return t("quota.window.minutes", { n: minutes });
    default:
      // No kind: the server either could not classify this window or predates
      // the field. Its English label is the only wording anyone has.
      return window.label;
  }
}

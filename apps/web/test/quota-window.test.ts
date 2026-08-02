import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { UsageQuotaWindow } from "@llm-usage-monitor/contracts";
import { quotaWindowLabel } from "../src/model/quota-window.ts";

/**
 * Stands in for i18next. Returns the key and any interpolation, so a test can
 * see WHICH key was chosen — the thing that decides the wording — without
 * pinning English copy that lives in the locale files.
 */
const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key;

const window = (over: Partial<UsageQuotaWindow>): UsageQuotaWindow => ({
  id: "w",
  label: "Fallback label",
  ...over,
});

describe("quotaWindowLabel", () => {
  it("translates a window the server classified", () => {
    assert.equal(quotaWindowLabel(window({ kind: "session" }), t), "quota.window.session");
    assert.equal(quotaWindowLabel(window({ kind: "extra-usage" }), t), "quota.window.extraUsage");
  });

  /**
   * One unit gets its own key rather than an interpolated "1": every locale
   * words it idiomatically ("Weekly window", not "1-week window").
   */
  it("uses the singular key for a one-unit window and the counted key beyond it", () => {
    assert.equal(
      quotaWindowLabel(window({ kind: "weekly", windowMinutes: 10_080 }), t),
      "quota.window.weekly",
    );
    assert.equal(
      quotaWindowLabel(window({ kind: "weekly", windowMinutes: 20_160 }), t),
      'quota.window.weeks({"n":2})',
    );
    assert.equal(
      quotaWindowLabel(window({ kind: "daily", windowMinutes: 1_440 }), t),
      "quota.window.daily",
    );
    assert.equal(
      quotaWindowLabel(window({ kind: "daily", windowMinutes: 2_880 }), t),
      'quota.window.days({"n":2})',
    );
  });

  it("counts hours and minutes from the reported length", () => {
    assert.equal(
      quotaWindowLabel(window({ kind: "hourly", windowMinutes: 300 }), t),
      'quota.window.hours({"n":5})',
    );
    assert.equal(
      quotaWindowLabel(window({ kind: "minute", windowMinutes: 90 }), t),
      'quota.window.minutes({"n":90})',
    );
  });

  /**
   * The compatibility path, and the reason `label` is still required by the
   * contract: snapshots written before `kind` existed are still in ledgers, and
   * a cap this codebase has never seen carries no kind either. English wording
   * beats a blank meter in both cases.
   */
  it("falls back to the server's English label when no kind was sent", () => {
    assert.equal(quotaWindowLabel(window({ label: "Monthly all" }), t), "Monthly all");
    assert.equal(
      quotaWindowLabel(window({ label: "5-hour window", windowMinutes: 300 }), t),
      "5-hour window",
    );
  });

  /**
   * The scope is Anthropic's own display name for a model. Model names are not
   * translated anywhere else in this dashboard and are not translated here.
   */
  it("appends an untranslated scope to a translated window", () => {
    assert.equal(
      quotaWindowLabel(window({ kind: "weekly", windowMinutes: 10_080, scope: "Fable" }), t),
      "quota.window.weekly · Fable",
    );
  });

  it("appends the scope to a fallback label too", () => {
    assert.equal(
      quotaWindowLabel(window({ label: "Monthly all", scope: "Fable" }), t),
      "Monthly all · Fable",
    );
  });
});

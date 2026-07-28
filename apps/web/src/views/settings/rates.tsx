import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelPrice } from "@llm-usage-monitor/contracts";
import { executeAction } from "../../api.ts";
import { formatCount } from "../../model/format.ts";

/**
 * Only `cacheWrite` may be cleared back to "unset"; the other three are required
 * by `modelPriceSchema`, so an emptied field there becomes 0 rather than
 * `undefined` — which would fail validation on save and lose the whole edit.
 */
function rateFromInput(value: string, key: keyof ModelPrice): number | undefined {
  if (value.trim() === "") return key === "cacheWrite" ? undefined : 0;
  return Math.max(0, Number(value) || 0);
}

export function Pricing({
  prices,
  onSaved,
}: {
  prices: ModelPrice[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(prices);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setDraft(prices), [prices]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prices);
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await executeAction({ version: 1, type: "replace-prices", prices: draft });
      await onSaved();
    } catch (reason) {
      // Without this the rejection is unhandled, onSaved never runs, and the
      // button returns to "Prices saved" as though nothing went wrong.
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="pricing-panel" aria-labelledby="pricing-table-title">
      <div className="pricing-toolbar">
        <div>
          <h2 id="pricing-table-title">{t("settings.rates.heading")}</h2>
          <p>{t("settings.rates.subtitle", { models: formatCount(draft.length) })}</p>
        </div>
        <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
          {saving
            ? t("settings.rates.saving")
            : dirty
              ? t("settings.rates.save")
              : t("settings.rates.saved")}
        </button>
      </div>
      {error && (
        <p role="alert" className="error settings-error">
          {error}
        </p>
      )}
      {draft.length ? (
        <div className="table-card pricing-table">
          <table>
            <caption className="sr-only">{t("settings.rates.caption")}</caption>
            <thead>
              <tr>
                <th>{t("settings.rates.provider")}</th>
                <th>{t("settings.rates.model")}</th>
                <th>{t("settings.rates.input")}</th>
                <th>{t("settings.rates.cachedInput")}</th>
                <th>{t("settings.rates.cacheWrite")}</th>
                <th>{t("settings.rates.output")}</th>
                <th>{t("settings.rates.effective")}</th>
              </tr>
            </thead>
            <tbody>
              {draft.map((price, index) => (
                <tr key={`${price.provider}/${price.model}`}>
                  <td className="provider-cell">{price.provider}</td>
                  <td className="pricing-model">{price.model}</td>
                  {(["input", "cachedInput", "cacheWrite", "output"] as const).map((key) => (
                    <td key={key}>
                      <input
                        aria-label={`${price.model} ${t(`settings.rates.${key}`)}`}
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.001"
                        // Blank rather than 0 for an unset cache-write rate, so the
                        // cell shows "this card does not surcharge writes" instead of
                        // claiming writes are free — the two price very differently.
                        value={price[key] ?? ""}
                        onChange={(event) =>
                          setDraft((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, [key]: rateFromInput(event.target.value, key) }
                                : item,
                            ),
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>{price.effectiveDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-state">{t("settings.rates.loading")}</p>
      )}
    </section>
  );
}

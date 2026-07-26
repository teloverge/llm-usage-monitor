import { useEffect, useState } from "react";
import type { ModelPrice } from "@llm-usage-monitor/contracts";
import { executeAction } from "../../api.ts";

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
  const [draft, setDraft] = useState(prices);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(prices), [prices]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(prices);
  const save = async () => {
    setSaving(true);
    try {
      await executeAction({ version: 1, type: "replace-prices", prices: draft });
      await onSaved();
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="pricing-panel" aria-labelledby="pricing-table-title">
      <div className="pricing-toolbar">
        <div>
          <h2 id="pricing-table-title">Model rates</h2>
          <p>USD per one million tokens · {draft.length} configured models</p>
        </div>
        <button type="button" className="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? "Saving…" : dirty ? "Save changes" : "Prices saved"}
        </button>
      </div>
      {draft.length ? (
        <div className="table-card pricing-table">
          <table>
            <caption className="sr-only">
              Configured model prices in USD per one million tokens
            </caption>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Input</th>
                <th>Cache read</th>
                <th>Cache write</th>
                <th>Output</th>
                <th>Effective</th>
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
                        aria-label={`${price.model} ${key}`}
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
        <p className="empty-state">Loading the local price catalog…</p>
      )}
    </section>
  );
}

import { useTranslation } from "react-i18next";
import type { SupportedLocale } from "../../model/format.ts";
import { changeLanguage } from "../../i18n/index.ts";
import { SUPPORTED_LANGUAGES } from "../../i18n/language.ts";

export function LanguageSettings() {
  const { t, i18n } = useTranslation();
  return (
    <section className="settings-section" aria-labelledby="language-title">
      <div className="settings-section-head">
        <div>
          <h2 id="language-title">{t("settings.language.heading")}</h2>
          <p>{t("settings.language.hint")}</p>
        </div>
      </div>
      <label className="chip">
        <span className="chip-key">{t("settings.language.heading")}</span>
        <select
          value={i18n.resolvedLanguage ?? "en"}
          onChange={(event) => changeLanguage(event.target.value as SupportedLocale)}
        >
          {/*
            Each option is labelled in its OWN language, never translated into
            the current one. Someone who has landed in a language they cannot
            read needs to recognise their own entry to get back out — the ISO
            code beside the endonym is a second anchor for exactly that reader,
            legible even when the endonym's script is not.
          */}
          {SUPPORTED_LANGUAGES.map((language) => (
            <option key={language.value} value={language.value}>
              {`${language.label} (${language.value})`}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

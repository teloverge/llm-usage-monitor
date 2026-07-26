import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { setFormatLocale, type SupportedLocale } from "../model/format.ts";
import { LANGUAGE_STORAGE_KEY, resolveLanguage } from "./language.ts";
import en from "./locales/en.json";
import es from "./locales/es.json";

/**
 * Resources are bundled, not fetched. This dashboard's premise is that
 * everything stays on the machine, and at roughly a hundred strings per locale
 * there is nothing to code-split — an HTTP backend would buy a loading flash and
 * an async init for no benefit.
 */
const resources = {
  en: { translation: en },
  es: { translation: es },
} as const;

function storedLanguage(): string | null {
  // Private-mode and embedded webviews can throw on access rather than return
  // null, and a language preference is not worth failing to boot over.
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

const initial = resolveLanguage(storedLanguage(), navigator.languages ?? [navigator.language]);

/**
 * Registered BEFORE `initReactI18next` and before any component mounts, and the
 * ordering is load-bearing rather than incidental.
 *
 * i18next fires `languageChanged` listeners in registration order, and
 * react-i18next's listener is what triggers the re-render. Registering this
 * one first guarantees the module-level locale inside `model/format.ts` is
 * already current when components re-render. Reversed, every formatted number,
 * date, and currency on the page would lag one language change behind — visible
 * only as stale output, with nothing failing.
 */
i18n.on("languageChanged", (language) => {
  setFormatLocale(language);
  document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: "en",
  // The dashboard uses one namespace; splitting buys nothing at this volume.
  defaultNS: "translation",
  interpolation: {
    // React escapes on render already, and double-escaping mangles the "→" and
    // "·" that several labels contain.
    escapeValue: false,
  },
});

// `init` does not fire `languageChanged`, so the initial locale is applied here.
setFormatLocale(initial);
document.documentElement.lang = initial;

export function changeLanguage(language: SupportedLocale): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // A browser that refuses storage still gets the language change for this
    // session; only persistence is lost.
  }
  void i18n.changeLanguage(language);
}

export default i18n;

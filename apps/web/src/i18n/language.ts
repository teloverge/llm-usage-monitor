import type { SupportedLocale } from "../model/format.ts";

/**
 * Each language is offered under its OWN name, not translated into the current
 * UI language. Someone who has landed in a language they cannot read needs to
 * recognise their own in the list to get out again.
 */
export const SUPPORTED_LANGUAGES = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "hi", label: "हिन्दी" },
  { value: "ja", label: "日本語" },
  { value: "ru", label: "Русский" },
  { value: "zh", label: "中文（简体）" },
] as const satisfies ReadonlyArray<{ value: SupportedLocale; label: string }>;

export const LANGUAGE_STORAGE_KEY = "llm-usage-monitor.language";

const DEFAULT_LANGUAGE: SupportedLocale = "en";

function supported(tag: string | null | undefined): SupportedLocale | undefined {
  if (!tag) return undefined;
  // Base subtag only: es-419, es-MX, and es-AR are all Spanish, and matching the
  // full tag would drop every one of them to English.
  const base = tag.split("-")[0]?.toLowerCase();
  return SUPPORTED_LANGUAGES.find((language) => language.value === base)?.value;
}

/**
 * Resolves the UI language from an explicit stored choice and the browser's
 * ordered preference list, in that order of precedence.
 *
 * Pure, and takes both inputs as parameters rather than reading `localStorage`
 * and `navigator` itself, so the whole decision is testable under `node --test`
 * with no DOM. `i18n/index.ts` supplies the real values.
 *
 * An unsupported stored value is ignored rather than honoured: it would
 * otherwise wedge the UI into a language with no resources behind it, and the
 * value is user-editable.
 */
export function resolveLanguage(
  stored: string | null,
  preferred: readonly string[],
): SupportedLocale {
  const chosen = supported(stored);
  if (chosen) return chosen;
  for (const tag of preferred) {
    const match = supported(tag);
    if (match) return match;
  }
  return DEFAULT_LANGUAGE;
}

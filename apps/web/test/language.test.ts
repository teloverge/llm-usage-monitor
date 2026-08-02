import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLanguage, SUPPORTED_LANGUAGES } from "../src/i18n/language.ts";

describe("Language resolution", () => {
  it("prefers a stored choice over the browser's preference", () => {
    assert.equal(resolveLanguage("es", ["en-GB", "en"]), "es");
    assert.equal(resolveLanguage("en", ["es-ES"]), "en");
  });

  it("falls back to the browser's preference when nothing is stored", () => {
    assert.equal(resolveLanguage(null, ["es-ES", "en"]), "es");
    assert.equal(resolveLanguage(null, ["en-US"]), "en");
  });

  // A stale or hand-edited localStorage value must not wedge the UI into a
  // language with no resources behind it.
  it("ignores a stored value that is not supported", () => {
    assert.equal(resolveLanguage("pt", ["es-ES"]), "es");
    assert.equal(resolveLanguage("", ["es-ES"]), "es");
  });

  // Regional Spanish is still Spanish. Matching on the base subtag is what makes
  // es-419, es-MX, and es-AR all resolve rather than silently landing on English.
  it("matches on the base subtag, not the full tag", () => {
    assert.equal(resolveLanguage(null, ["es-419"]), "es");
    assert.equal(resolveLanguage(null, ["es-MX"]), "es");
    assert.equal(resolveLanguage("es-AR", []), "es");
  });

  it("resolves every added language from a regional browser tag", () => {
    assert.equal(resolveLanguage(null, ["de-AT"]), "de");
    assert.equal(resolveLanguage(null, ["fr-CA"]), "fr");
    assert.equal(resolveLanguage(null, ["ja-JP"]), "ja");
    // A Traditional-script reader lands on the one Chinese the dashboard has —
    // the picker labels it Simplified, so the substitution is at least declared.
    assert.equal(resolveLanguage(null, ["zh-TW"]), "zh");
    assert.equal(resolveLanguage(null, ["hi-IN"]), "hi");
    assert.equal(resolveLanguage(null, ["ru-BY"]), "ru");
  });

  // The primary subtag is matched case-insensitively — a browser or a
  // hand-edited storage value may report it upper-cased (BCP 47 only
  // requires the REGION subtag, not the primary language, to be upper-cased).
  it("matches the base subtag regardless of case", () => {
    assert.equal(resolveLanguage("ES-MX", []), "es");
    assert.equal(resolveLanguage(null, ["ES-MX", "EN"]), "es");
  });

  it("walks the browser list in order and takes the first supported entry", () => {
    assert.equal(resolveLanguage(null, ["pt-BR", "it", "es-ES", "en"]), "es");
    assert.equal(resolveLanguage(null, ["fr-FR", "de", "es-ES"]), "fr");
  });

  it("defaults to English when nothing matches", () => {
    assert.equal(resolveLanguage(null, ["pt-BR", "it"]), "en");
    assert.equal(resolveLanguage(null, []), "en");
  });

  it("offers each supported language under its own endonym", () => {
    assert.deepEqual(SUPPORTED_LANGUAGES, [
      { value: "de", label: "Deutsch" },
      { value: "en", label: "English" },
      { value: "es", label: "Español" },
      { value: "fr", label: "Français" },
      { value: "hi", label: "हिन्दी" },
      { value: "ja", label: "日本語" },
      { value: "ru", label: "Русский" },
      { value: "zh", label: "中文（简体）" },
    ]);
  });
});

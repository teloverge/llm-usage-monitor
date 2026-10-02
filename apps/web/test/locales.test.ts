import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * The typecheck binds `t()` to `en.json` only, so a key missing from any other
 * locale falls back to English silently at runtime — tolerable at two locales
 * kept in one PR, but not at seven hand-authored files. These tests are the
 * automated check standing behind every non-English locale: full key parity,
 * and the same interpolation placeholders per key, since a translation that
 * drops `{{records}}` renders a sentence with a hole in it.
 *
 * Read with `fs` rather than imported: `node --test` runs this file directly,
 * where a JSON import needs an import attribute the bundled `src/` imports do
 * not use, and two loading mechanisms for one file set is a disagreement
 * waiting to happen.
 */
const TRANSLATED = ["de", "es", "fr", "hi", "ja", "ru", "zh"] as const;

function readLocale(code: string): unknown {
  const url = new URL(`../src/i18n/locales/${code}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function flatten(node: unknown, prefix: string, into: Map<string, string>): Map<string, string> {
  if (typeof node === "string") {
    into.set(prefix, node);
    return into;
  }
  assert.ok(node !== null && typeof node === "object", `unexpected leaf at "${prefix}"`);
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    flatten(value, prefix === "" ? key : `${prefix}.${key}`, into);
  }
  return into;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1] ?? "").sort();
}

/**
 * i18next picks a plural form by suffix — `sessionCount_one`, `_few`, `_other` —
 * and each language needs a different set: Russian four, Japanese one. Key
 * parity is therefore checked on the BASE key, and the suffixes separately
 * against the categories the language's own plural rules can produce.
 *
 * Every category must be present, not just `_other`: i18next does not fall
 * back from a missing `_many` to `_other` within a language, it falls through
 * to English.
 */
const PLURAL = /_(zero|one|two|few|many|other)$/;

function baseKeys(keys: Iterable<string>): string[] {
  return [...new Set([...keys].map((key) => key.replace(PLURAL, "")))].sort();
}

function pluralForms(keys: Iterable<string>, base: string): string[] {
  return [...keys]
    .filter((key) => key.replace(PLURAL, "") === base && PLURAL.test(key))
    .map((key) => key.match(PLURAL)![1]!)
    .sort();
}

/** The English text a translated key is compared against: its `_other` form when plural. */
function englishFor(en: Map<string, string>, key: string): string | undefined {
  return en.get(key) ?? en.get(key.replace(PLURAL, "_other"));
}

describe("Locale resources", () => {
  const en = flatten(readLocale("en"), "", new Map());
  const pluralBases = baseKeys([...en.keys()].filter((key) => PLURAL.test(key)));

  it("en carries every plural form English needs", () => {
    for (const base of pluralBases)
      assert.deepEqual(pluralForms(en.keys(), base), ["one", "other"]);
  });

  for (const code of TRANSLATED) {
    it(`${code} translates exactly the keys en defines`, () => {
      const locale = flatten(readLocale(code), "", new Map());
      assert.deepEqual(baseKeys(locale.keys()), baseKeys(en.keys()));
    });

    it(`${code} carries exactly the plural forms its language uses`, () => {
      const locale = flatten(readLocale(code), "", new Map());
      const categories = [...new Intl.PluralRules(code).resolvedOptions().pluralCategories].sort();
      for (const base of pluralBases) {
        assert.deepEqual(pluralForms(locale.keys(), base), categories, base);
      }
    });

    it(`${code} keeps every interpolation placeholder en uses`, () => {
      const locale = flatten(readLocale(code), "", new Map());
      for (const [key, translated] of locale) {
        const english = englishFor(en, key);
        // A missing key is the parity test's finding, not this one's.
        if (english === undefined) continue;
        assert.deepEqual(placeholders(translated), placeholders(english), key);
      }
    });
  }
});

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

describe("Locale resources", () => {
  const en = flatten(readLocale("en"), "", new Map());

  for (const code of TRANSLATED) {
    it(`${code} translates exactly the keys en defines`, () => {
      const locale = flatten(readLocale(code), "", new Map());
      assert.deepEqual([...locale.keys()].sort(), [...en.keys()].sort());
    });

    it(`${code} keeps every interpolation placeholder en uses`, () => {
      const locale = flatten(readLocale(code), "", new Map());
      for (const [key, english] of en) {
        const translated = locale.get(key);
        // A missing key is the previous test's finding, not this one's.
        if (translated === undefined) continue;
        assert.deepEqual(placeholders(translated), placeholders(english), key);
      }
    });
  }
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fijarIdioma, idioma, idiomaDe, olvidarIdioma, t } from "./i18n.ts";

test("English for everyone, whatever the browser says", () => {
  olvidarIdioma();
  // A browser in Spanish no longer changes anything: that was the bug that got fixed.
  assert.equal(idiomaDe(["es-ES", "en"]), "en");
  assert.equal(idiomaDe(["es-MX"]), "en");
  assert.equal(idiomaDe(["fr-FR"]), "en");
  assert.equal(idiomaDe([]), "en");
});

test("it only changes if it is forced", () => {
  fijarIdioma("es");
  assert.equal(idiomaDe(["en-GB"]), "es");
  olvidarIdioma();
  assert.equal(idiomaDe(["es-ES"]), "en");
});

test("without a translation the fallback text is used", () => {
  assert.equal(t("no-existe", "Hola"), "Hola");
});

test("English is the starting language and the fallback", () => {
  fijarIdioma("en");
  assert.equal(idioma(), "en");
  // The fallback passed in is the English text: it does not translate itself.
  assert.equal(t("abrir", "Open"), "Open");
});

test("Spanish can be forced, and then it does translate", () => {
  fijarIdioma("es");
  assert.equal(idioma(), "es");
  assert.equal(t("abrir", "Open"), "Abrir");
  assert.equal(t("borrar", "Delete"), "Borrar");
  fijarIdioma("en");
});

test("all the HTML keys have a Spanish translation", () => {
  // If someone adds a button with data-i18n and does not translate it, this catches it:
  // with the language in Spanish the key would stay in English, in plain sight.
  fijarIdioma("es");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const claves = [
    ...new Set([...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1])),
  ];
  assert.ok(claves.length >= 40, `expected the HTML keys, there are ${claves.length}`);
  const sinTraducir = claves.filter((clave) => t(clave, "__SIN_TRADUCIR__") === "__SIN_TRADUCIR__");
  assert.deepEqual(sinTraducir, [], "HTML keys without a Spanish translation");
  fijarIdioma("en");
});

test("the HTML is in English: it is the source, not the translation", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, />Open</);
  assert.match(html, /placeholder="Ask the agent anything/);
  // No loose Spanish in the visible texts (code comments do not count: they are
  // outside the tags).
  for (const palabra of ["Abrir<", "Guardar<", "Proyectos<", "Sonidos<", "Encargo<"]) {
    assert.ok(!html.includes(palabra), `Spanish is left in the interface: ${palabra}`);
  }
});

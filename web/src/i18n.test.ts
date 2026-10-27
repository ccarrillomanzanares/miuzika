import assert from "node:assert/strict";
import test from "node:test";
import { idiomaDe, t } from "./i18n.ts";

test("el idioma sale de las preferencias del navegador, en orden", () => {
  assert.equal(idiomaDe(["es-ES", "en"]), "es");
  assert.equal(idiomaDe(["es-MX"]), "es");
  assert.equal(idiomaDe(["en-GB", "es"]), "en");
  assert.equal(idiomaDe(["fr-FR", "es-ES"]), "es");
  // Sin ninguno de los dos, inglés.
  assert.equal(idiomaDe(["ja-JP"]), "en");
  assert.equal(idiomaDe([]), "en");
});

test("sin traducción se usa el texto de reserva", () => {
  assert.equal(t("no-existe", "Hola"), "Hola");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fijarIdioma, idioma, idiomaDe, t } from "./i18n.ts";

test("el idioma sale de las preferencias del navegador, en orden", () => {
  assert.equal(idiomaDe(["es-ES", "en"]), "es");
  assert.equal(idiomaDe(["es-MX"]), "es");
  assert.equal(idiomaDe(["en-GB", "es"]), "en");
  assert.equal(idiomaDe(["fr-FR", "es-ES"]), "es");
  // Sin ninguno de los dos, inglés: es el idioma base.
  assert.equal(idiomaDe(["ja-JP"]), "en");
  assert.equal(idiomaDe([]), "en");
});

test("sin traducción se usa el texto de reserva", () => {
  assert.equal(t("no-existe", "Hola"), "Hola");
});

test("el inglés es el idioma de partida y la reserva", () => {
  fijarIdioma("en");
  assert.equal(idioma(), "en");
  // La reserva que se pasa es el texto inglés: no se traduce a sí mismo.
  assert.equal(t("abrir", "Open"), "Open");
});

test("se puede forzar español, y entonces sí traduce", () => {
  fijarIdioma("es");
  assert.equal(idioma(), "es");
  assert.equal(t("abrir", "Open"), "Abrir");
  assert.equal(t("borrar", "Delete"), "Borrar");
  fijarIdioma("en");
});

test("todas las claves del HTML tienen traducción al español", () => {
  // Si alguien añade un botón con data-i18n y no lo traduce, esto lo caza: con el
  // idioma en español la clave se quedaría en inglés, a la vista.
  fijarIdioma("es");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const claves = [
    ...new Set([...html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)].map((m) => m[1])),
  ];
  assert.ok(claves.length >= 40, `esperaba las claves del HTML, hay ${claves.length}`);
  const sinTraducir = claves.filter((clave) => t(clave, "__SIN_TRADUCIR__") === "__SIN_TRADUCIR__");
  assert.deepEqual(sinTraducir, [], "claves del HTML sin traducción al español");
  fijarIdioma("en");
});

test("el HTML está en inglés: es la fuente, no la traducción", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, />Open</);
  assert.match(html, /placeholder="Ask the agent anything/);
  // Nada de español suelto en los textos visibles (los comentarios del código no
  // cuentan: van fuera de las etiquetas).
  for (const palabra of ["Abrir<", "Guardar<", "Proyectos<", "Sonidos<", "Encargo<"]) {
    assert.ok(!html.includes(palabra), `queda español en la interfaz: ${palabra}`);
  }
});

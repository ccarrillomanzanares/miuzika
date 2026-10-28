import assert from "node:assert/strict";
import test from "node:test";
import { ENCARGO_VACIO, textoDeEncargo } from "./encargo.ts";

test("un encargo vacío deja todo al agente", () => {
  assert.equal(textoDeEncargo(ENCARGO_VACIO), "Una canción nueva, en un proyecto nuevo.");
});

test("una versión con todo rellenado sale corta y en orden", () => {
  const texto = textoDeEncargo({
    ...ENCARGO_VACIO,
    tipo: "version",
    cancion: "Hurt – Nine Inch Nails",
    estilo: "dark synth pop, atmósfera fría",
    bpm: 80,
    tonica: "B",
    modo: "minor",
    minutos: 3,
    instrumentos: ["Grand Piano, Steinway B", "Violonchelo"],
    voz: "melodia",
    evitar: "nada alegre",
    mas: "Que el estribillo explote.",
  });
  assert.equal(
    texto,
    [
      "Versión de «Hurt – Nine Inch Nails», con su melodía.",
      "Estilo: dark synth pop, atmósfera fría.",
      "80 BPM · Si menor · unos 3 min.",
      "Instrumentos: Grand Piano, Steinway B; Violonchelo.",
      "Sin voz: la melodía la lleva un instrumento.",
      "Evita: nada alegre.",
      "Que el estribillo explote.",
    ].join("\n"),
  );
});

test("en inglés y arreglando el proyecto abierto", () => {
  const texto = textoDeEncargo({ ...ENCARGO_VACIO, tipo: "arreglo", tonica: "F#", modo: "dorian" }, "en", "Stahl");
  assert.equal(texto, "Work on the open project (“Stahl”): don't create a new one.\nF# dorian.");
});

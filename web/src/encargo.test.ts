import assert from "node:assert/strict";
import test from "node:test";
import { ENCARGO_VACIO, textoDeEncargo } from "./encargo.ts";

test("un encargo vacío deja todo al agente", () => {
  assert.equal(textoDeEncargo(ENCARGO_VACIO, "es"), "Una canción nueva, en un proyecto nuevo: ponle tú el nombre.");
  assert.equal(textoDeEncargo({ ...ENCARGO_VACIO, nombre: " Rebeldía " }, "es"), "Una canción nueva, en un proyecto nuevo llamado «Rebeldía».");
});

test("versión: a dónde se lleva, qué conserva y tempo relativo", () => {
  const texto = textoDeEncargo({
    ...ENCARGO_VACIO,
    tipo: "version",
    cancion: "Hurt – Nine Inch Nails",
    estilo: "música de cine, piano y cuerdas",
    conservar: { melodia: true, acordes: true, riff: false, estructura: true },
    tempo: "original",
    tonalidad: "original",
    minutos: 4,
    instrumentos: ["Grand Piano, Steinway B", "Cuerdas", "Violonchelo"],
    melodiaLaLleva: "el violonchelo",
    voz: "melodia",
    energia: "crece",
    evitar: "nada de sintes",
    entregaMidi: true,
    entregaWav: true,
  }, "es");
  assert.equal(
    texto,
    [
      "Versión de «Hurt – Nine Inch Nails», llevada a música de cine, piano y cuerdas.",
      "Conserva la melodía, los acordes y la estructura; lo demás puedes cambiarlo.",
      "Mismo tempo que el original · en su tonalidad original · unos 4 min.",
      "Instrumentos: Grand Piano, Steinway B; Cuerdas; Violonchelo.",
      "Sin voz: la melodía la lleva el violonchelo.",
      "Energía: que crezca hasta el final.",
      "Evita: nada de sintes.",
      "Entrega: cuando esté terminada, expórtala en MIDI y WAV.",
    ].join("\n"),
  );
});

test("versión sin conservar nada es sólo inspiración", () => {
  const texto = textoDeEncargo({
    ...ENCARGO_VACIO,
    tipo: "version",
    cancion: "Smells Like Teen Spirit",
    conservar: { melodia: false, acordes: false, riff: false, estructura: false },
  }, "es");
  assert.match(texto, /Sólo inspirada en ella: no copies su melodía ni sus acordes\./);
});

test("nueva: uso, imagen, referencias, gancho, groove", () => {
  const texto = textoDeEncargo({
    ...ENCARGO_VACIO,
    estilo: "synthwave oscuro",
    uso: "loop",
    imagen: "conducir de noche bajo la lluvia",
    suenaComo: "Kavinsky, la banda sonora de Drive",
    gancho: "un arpegio de sinte que vuelve en cada estribillo.",
    tempo: "bpm",
    bpm: 100,
    groove: "recto",
    tonalidad: "otra",
    tonica: "D",
    modo: "minor",
  }, "es");
  assert.equal(
    texto,
    [
      "Una canción nueva, en un proyecto nuevo: ponle tú el nombre.",
      "Estilo: synthwave oscuro.",
      "Es un loop que tiene que cerrar sin costura: sin principio ni final marcados, que pueda sonar mucho rato sin cansar.",
      "Imagen: conducir de noche bajo la lluvia.",
      "Que suene como Kavinsky, la banda sonora de Drive.",
      "El gancho: un arpegio de sinte que vuelve en cada estribillo.",
      "100 BPM · groove recto · Re menor.",
    ].join("\n"),
  );
});

test("en inglés y arreglando el proyecto abierto", () => {
  const texto = textoDeEncargo(
    { ...ENCARGO_VACIO, tipo: "arreglo", estilo: "darker chorus", tonalidad: "otra", tonica: "F#", modo: "dorian" },
    "en",
    "Stahl",
  );
  assert.equal(texto, "Work on the open project (“Stahl”): don't create a new one.\nWhat to change: darker chorus.\nF# dorian.");
});

test("sin idioma, el encargo sale en inglés", () => {
  assert.equal(textoDeEncargo(ENCARGO_VACIO), "A new song, in a new project: you name it.");
  assert.equal(
    textoDeEncargo({ ...ENCARGO_VACIO, nombre: " Rebeldía " }),
    "A new song, in a new project called “Rebeldía”.",
  );
});

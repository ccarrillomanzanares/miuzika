import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "../../src/core/project.ts";
import {
  FORMATO,
  carpetaDeRuta,
  interpretarProyectoEnDisco,
  nombreDeProyectoDesdeFicheros,
  rutaDeProyecto,
  rutaRelativa,
  serializarProyecto,
  slugDeNombre,
} from "./proyecto-archivo.ts";

const VACIO = new Map<string, { name: string; durationBeats: number; src?: string }>();

test("el slug de la carpeta quita acentos, signos y espacios", () => {
  assert.equal(slugDeNombre("Vitrina"), "vitrina");
  assert.equal(slugDeNombre("Mi Tema (v2)"), "mi-tema-v2");
  assert.equal(slugDeNombre("Ñandú Ácido"), "nandu-acido");
  assert.equal(slugDeNombre(""), "proyecto");
  assert.equal(slugDeNombre("---"), "proyecto");
});

test("la ruta del fichero maestro vive en la carpeta del proyecto", () => {
  assert.equal(rutaDeProyecto("vitrina"), "proyectos/vitrina/proyecto.json");
  assert.equal(carpetaDeRuta("proyectos/vitrina/proyecto.json"), "vitrina");
  assert.equal(carpetaDeRuta("proyectos/vitrina/salida/x.wav"), "vitrina");
});

test("rutaRelativa quita la carpeta del proyecto y las barras sobrantes", () => {
  assert.equal(rutaRelativa("salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("/salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("proyectos/vitrina/salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("salida\\kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("../salida/kick.wav"), "salida/kick.wav");
});

test("serializarProyecto escribe la ruta de cada WAV dentro del proyecto", () => {
  const proyecto = createProject({ name: "Vitrina", bpm: 90, lengthBars: 76 });
  proyecto.audioAssets = [
    { id: "aud_kick", name: "kick", durationBeats: 32 },
    { id: "aud_pad", name: "pad", durationBeats: 64 },
  ];
  const assets = new Map([
    ["aud_kick", { name: "kick", durationBeats: 32, src: "salida/vitrina_kick.wav" }],
    ["aud_pad", { name: "pad", durationBeats: 64 }],
  ]);

  const { datos, sinRuta } = serializarProyecto(proyecto, assets, new Date("2026-10-23T21:00:00Z"));

  assert.equal(datos.formato, FORMATO);
  assert.equal(datos.version, 1);
  assert.equal(datos.guardadoEn, "2026-10-23T21:00:00.000Z");
  assert.equal(datos.proyecto.bpm, 90);
  assert.deepEqual(datos.proyecto.audioAssets, [
    { id: "aud_kick", name: "kick", durationBeats: 32, ruta: "salida/vitrina_kick.wav" },
    // Sin ruta no se inventa nada: se avisa.
    { id: "aud_pad", name: "pad", durationBeats: 64 },
  ]);
  assert.deepEqual(sinRuta, ["pad"]);
});

test("los assets citados sólo por un clip entran en el fichero maestro", () => {
  const proyecto = createProject({ name: "Suelto" });
  proyecto.tracks = [
    {
      id: "trk_1",
      name: "Bombo",
      kind: "audio",
      instrument: { type: "sampler" },
      gainDb: 0,
      pan: 0,
      muted: false,
      solo: false,
      devices: [],
      clips: [
        {
          id: "clip_1",
          name: "bombo",
          start: 0,
          length: 16,
          notes: [],
          audio: { assetId: "aud_x", offset: 0, gainDb: 0 },
        },
      ],
    },
  ];
  const { datos, sinRuta } = serializarProyecto(proyecto, VACIO);
  assert.deepEqual(
    datos.proyecto.audioAssets?.map((asset) => [asset.id, asset.name]),
    [["aud_x", "aud_x"]],
  );
  assert.deepEqual(sinRuta, ["aud_x"]);
});

test("lo que se escribe se puede volver a leer tal cual", () => {
  const proyecto = createProject({ name: "Vitrina", bpm: 90, lengthBars: 76 });
  proyecto.audioAssets = [{ id: "aud_kick", name: "kick", durationBeats: 32 }];
  const assets = new Map([["aud_kick", { name: "kick", durationBeats: 32, src: "salida/kick.wav" }]]);

  const texto = JSON.stringify(serializarProyecto(proyecto, assets, new Date("2026-10-23T21:00:00Z")).datos);
  const leido = interpretarProyectoEnDisco(texto);

  assert.equal(leido.proyecto.name, "Vitrina");
  assert.equal(leido.proyecto.bpm, 90);
  assert.equal(leido.proyecto.lengthBars, 76);
  assert.deepEqual(leido.proyecto.audioAssets, [
    { id: "aud_kick", name: "kick", durationBeats: 32, ruta: "salida/kick.wav" },
  ]);
});

test("interpretarProyectoEnDisco acepta un Project suelto (json exportado a mano)", () => {
  const proyecto = createProject({ name: "Suelto" });
  const leido = interpretarProyectoEnDisco(JSON.stringify(proyecto));
  assert.equal(leido.proyecto.name, "Suelto");
});

test("un fichero del formato anterior (assets[] aparte) conserva las rutas", () => {
  const proyecto = createProject({ name: "Viejo" });
  proyecto.audioAssets = [{ id: "aud_tono", name: "tono", durationBeats: 6 }];
  const texto = JSON.stringify({
    formato: FORMATO,
    version: 1,
    guardadoEn: "",
    proyecto,
    assets: [{ id: "aud_tono", nombre: "tono", duracionBeats: 6, ruta: "/salida/tono.wav" }],
  });
  const leido = interpretarProyectoEnDisco(texto);
  assert.deepEqual(leido.proyecto.audioAssets, [
    { id: "aud_tono", name: "tono", durationBeats: 6, ruta: "salida/tono.wav" },
  ]);
});

test("interpretarProyectoEnDisco rechaza lo que no es un proyecto, con motivo", () => {
  assert.throws(() => interpretarProyectoEnDisco("{roto"), /is not valid JSON/);
  assert.throws(() => interpretarProyectoEnDisco("null"), /empty or is not an object/);
  assert.throws(() => interpretarProyectoEnDisco('{"hola":1}'), /no es un proyecto de miuzika/);
  assert.throws(
    () => interpretarProyectoEnDisco(`{"formato":"${FORMATO}","version":1,"proyecto":{"schemaVersion":2}}`),
    /the project in the file is not valid/,
  );
});

test("el nombre del proyecto nuevo sale de la carpeta, no de «salida»", () => {
  // Carpeta del selector: proyectos/vitrina/salida/*.wav
  assert.equal(
    nombreDeProyectoDesdeFicheros([
      { name: "vitrina_kick.wav", webkitRelativePath: "vitrina/salida/vitrina_kick.wav" },
      { name: "vitrina_pad.wav", webkitRelativePath: "vitrina/salida/vitrina_pad.wav" },
    ]),
    "vitrina",
  );
  // Sólo la carpeta de salida: no hay nada mejor que el nombre del fichero.
  assert.equal(
    nombreDeProyectoDesdeFicheros([{ name: "sacramento_stems.wav", webkitRelativePath: "salida/sacramento_stems.wav" }]),
    "sacramento",
  );
  // Ficheros sueltos (sin carpeta): el nombre del primero, limpio.
  assert.equal(nombreDeProyectoDesdeFicheros([{ name: "Tema_Nuevo-master.wav" }]), "Tema Nuevo");
  assert.equal(nombreDeProyectoDesdeFicheros([{ name: "midi_vitrina_multitrack.mid" }]), "vitrina");
  assert.equal(nombreDeProyectoDesdeFicheros([]), "proyecto");
});

test("un proyecto guardado con efectos 0..1 se abre con unidades reales", () => {
  const viejo = createProject({ name: "Viejo" });
  viejo.tracks.push({
    id: "trk_a",
    name: "A",
    kind: "midi",
    instrument: { type: "synth" },
    gainDb: 0,
    pan: 0,
    muted: false,
    solo: false,
    clips: [],
    devices: [{ id: "dev_filter_1", type: "filter", enabled: true, params: { cutoff: 0.62, resonance: 0 } }],
  });
  const texto = JSON.stringify({ formato: FORMATO, version: 1, guardadoEn: "", proyecto: viejo });
  const { proyecto } = interpretarProyectoEnDisco(texto);
  // 20·1000^0.62 = 1.449 Hz: lo mismo que sonaba con el mapeo viejo.
  assert.deepEqual(proyecto.tracks[0]!.devices[0]!.params, { cutoffHz: 1449, q: 0.5 });
});

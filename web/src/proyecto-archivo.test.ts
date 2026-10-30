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

test("the folder slug strips accents, punctuation and spaces", () => {
  assert.equal(slugDeNombre("Vitrina"), "vitrina");
  assert.equal(slugDeNombre("Mi Tema (v2)"), "mi-tema-v2");
  assert.equal(slugDeNombre("Ñandú Ácido"), "nandu-acido");
  assert.equal(slugDeNombre(""), "proyecto");
  assert.equal(slugDeNombre("---"), "proyecto");
});

test("the master file path lives in the project folder", () => {
  assert.equal(rutaDeProyecto("vitrina"), "proyectos/vitrina/proyecto.json");
  assert.equal(carpetaDeRuta("proyectos/vitrina/proyecto.json"), "vitrina");
  assert.equal(carpetaDeRuta("proyectos/vitrina/salida/x.wav"), "vitrina");
});

test("rutaRelativa strips the project folder and extra slashes", () => {
  assert.equal(rutaRelativa("salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("/salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("proyectos/vitrina/salida/kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("salida\\kick.wav"), "salida/kick.wav");
  assert.equal(rutaRelativa("../salida/kick.wav"), "salida/kick.wav");
});

test("serializarProyecto writes each WAV's path inside the project", () => {
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
    // Without a path nothing is invented: a warning is given.
    { id: "aud_pad", name: "pad", durationBeats: 64 },
  ]);
  assert.deepEqual(sinRuta, ["pad"]);
});

test("assets referenced only by a clip enter the master file", () => {
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

test("what is written can be read back as is", () => {
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

test("interpretarProyectoEnDisco accepts a loose Project (json exported by hand)", () => {
  const proyecto = createProject({ name: "Suelto" });
  const leido = interpretarProyectoEnDisco(JSON.stringify(proyecto));
  assert.equal(leido.proyecto.name, "Suelto");
});

test("a file in the previous format (assets[] separate) keeps the paths", () => {
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

test("interpretarProyectoEnDisco rejects what is not a project, with a reason", () => {
  assert.throws(() => interpretarProyectoEnDisco("{roto"), /is not valid JSON/);
  assert.throws(() => interpretarProyectoEnDisco("null"), /empty or is not an object/);
  assert.throws(() => interpretarProyectoEnDisco('{"hola":1}'), /not a miuzika project/);
  assert.throws(
    () => interpretarProyectoEnDisco(`{"formato":"${FORMATO}","version":1,"proyecto":{"schemaVersion":2}}`),
    /the project in the file is not valid/,
  );
});

test("the new project's name comes from the folder, not from “salida”", () => {
  // Picker folder: proyectos/vitrina/salida/*.wav
  assert.equal(
    nombreDeProyectoDesdeFicheros([
      { name: "vitrina_kick.wav", webkitRelativePath: "vitrina/salida/vitrina_kick.wav" },
      { name: "vitrina_pad.wav", webkitRelativePath: "vitrina/salida/vitrina_pad.wav" },
    ]),
    "vitrina",
  );
  // Only the output folder: there is nothing better than the file name.
  assert.equal(
    nombreDeProyectoDesdeFicheros([{ name: "sacramento_stems.wav", webkitRelativePath: "salida/sacramento_stems.wav" }]),
    "sacramento",
  );
  // Loose files (no folder): the first one's name, cleaned.
  assert.equal(nombreDeProyectoDesdeFicheros([{ name: "Tema_Nuevo-master.wav" }]), "Tema Nuevo");
  assert.equal(nombreDeProyectoDesdeFicheros([{ name: "midi_vitrina_multitrack.mid" }]), "vitrina");
  assert.equal(nombreDeProyectoDesdeFicheros([]), "proyecto");
});

test("a project saved with 0..1 effects opens with real units", () => {
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
  // 20·1000^0.62 = 1,449 Hz: the same as what sounded with the old mapping.
  assert.deepEqual(proyecto.tracks[0]!.devices[0]!.params, { cutoffHz: 1449, q: 0.5 });
});

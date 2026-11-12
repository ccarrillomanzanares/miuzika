import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "../../src/core/project.ts";
import { applyOps } from "../../src/core/ops.ts";
import { audioAssets, cargarWavDeDisco, decidirDecodificar, hidratarAssets, opsDeAudio, PRESUPUESTO_DECODIFICADO_MB } from "./audio-store.ts";

const MB = 1024 * 1024;

test("short WAVs are always decoded, even when no budget is left", () => {
  assert.equal(decidirDecodificar(12, 10_000 * MB), true);
});

test("a long stem goes into openDAW as long as it fits in the budget", () => {
  // 4 min stereo at 48 kHz in Float32 ≈ 88 MB.
  assert.equal(decidirDecodificar(240, 0), true);
  assert.equal(decidirDecodificar(240, (PRESUPUESTO_DECODIFICADO_MB - 50) * MB), false);
  // One that does not fit on its own always goes through streaming (20 min ≈ 440 MB).
  assert.equal(decidirDecodificar(1200, 0), false);
});

/** A fake server (peaks + bytes) and decoder; returns the routes the code asked for. */
function servidorFalso(segundos: number): { rutas: string[]; restaurar: () => void } {
  const rutas: string[] = [];
  const fetchOriginal = globalThis.fetch;
  const contextoOriginal = (globalThis as { AudioContext?: unknown }).AudioContext;
  globalThis.fetch = (async (url: string | URL) => {
    const ruta = String(url);
    rutas.push(ruta.split("?")[0]!);
    if (ruta.startsWith("/api/picos")) return new Response(JSON.stringify({ picos: [0, 0.5], duracionSeg: segundos }));
    if (ruta.startsWith("/api/audio")) return new Response(new Uint8Array(44));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const muestras = Math.round(segundos * 48_000);
  (globalThis as { AudioContext?: unknown }).AudioContext = class {
    async decodeAudioData() {
      const canal = new Float32Array(muestras);
      return { duration: segundos, length: muestras, numberOfChannels: 2, sampleRate: 48_000, getChannelData: () => canal };
    }
  };
  return {
    rutas,
    restaurar: () => {
      globalThis.fetch = fetchOriginal;
      (globalThis as { AudioContext?: unknown }).AudioContext = contextoOriginal;
      audioAssets.clear();
    },
  };
}

test("the Audio button's file is decoded from the bytes in hand, not downloaded again", async () => {
  const srv = servidorFalso(12);
  try {
    const asset = await cargarWavDeDisco({ id: "a1", name: "kick", ruta: "entrada/kick.wav", slug: "p", bpm: 120, fichero: new Blob([new Uint8Array(44)]) });
    assert.equal(asset.streaming, false);
    assert.equal(asset.durationBeats, 24);
    assert.deepEqual(srv.rutas, ["/api/picos"]);
  } finally {
    srv.restaurar();
  }
});

test("an agent import downloads and decodes; a stem over the budget streams", async () => {
  let srv = servidorFalso(30);
  try {
    const corto = await cargarWavDeDisco({ id: "a2", name: "toma", ruta: "generado/toma.wav", slug: "p", bpm: 125 });
    assert.equal(corto.streaming, false);
    assert.deepEqual(srv.rutas, ["/api/picos", "/api/audio"]);
  } finally {
    srv.restaurar();
  }
  srv = servidorFalso(1200);
  try {
    const largo = await cargarWavDeDisco({ id: "a3", name: "stem", ruta: "stems/largo.wav", slug: "p", bpm: 60 });
    assert.equal(largo.streaming, true);
    assert.deepEqual(srv.rutas, ["/api/picos"]);
  } finally {
    srv.restaurar();
  }
});

test("project load keeps the project's duration and goes through the same intake", async () => {
  const srv = servidorFalso(30);
  try {
    let p = createProject({ name: "Vidrio", bpm: 120, lengthBars: 8 });
    p = applyOps(p, [{ op: "register_audio_asset", assetId: "toma", name: "toma", durationBeats: 64, ruta: "generado/toma.wav" }]).project;
    p = applyOps(p, [{ op: "add_audio_clip", assetId: "toma", startBar: 0, name: "toma", track: { name: "toma" } }]).project;
    const { cargados, faltan } = await hidratarAssets(p, "vidrio");
    assert.deepEqual([cargados, faltan], [1, []]);
    assert.equal(audioAssets.get("toma")?.durationBeats, 64);
  } finally {
    srv.restaurar();
  }
});

test("opsDeAudio replaces a same-named track's clips only when asked", () => {
  let p = createProject({ name: "Stahl", bpm: 125, lengthBars: 8 });
  const datos = { assetId: "a", nombre: "toma", durationBeats: 16, ruta: "generado/toma.wav", startBar: 0, lengthBeats: 16 };
  p = applyOps(p, opsDeAudio(p, { ...datos, reemplazar: true })).project;
  const otra = applyOps(p, opsDeAudio(p, { ...datos, assetId: "b", reemplazar: true })).project;
  assert.deepEqual(otra.tracks.filter((t) => t.name === "toma").map((t) => t.clips.length), [1]);
  const doble = applyOps(p, opsDeAudio(p, { ...datos, assetId: "b", reemplazar: false })).project;
  assert.equal(doble.tracks.filter((t) => t.name === "toma").length, 2);
});

test("the WAVs on tracks with an effect on or a send are the ones decoded first", async () => {
  const { idsConEfectos } = await import("./audio-store.ts");
  const pista = (id: string, cambios: object) => ({
    id, name: id, kind: "audio", instrument: { type: "sampler" }, gainDb: 0, pan: 0, muted: false, solo: false, devices: [],
    clips: [{ id: `c${id}`, name: id, start: 0, length: 8, notes: [], audio: { assetId: id, offset: 0, gainDb: 0 } }],
    ...cambios,
  });
  const project = {
    ...createProject({ name: "x" }),
    tracks: [
      pista("seca", {}),
      pista("apagado", { devices: [{ enabled: false }] }),
      pista("efecto", { devices: [{ enabled: true }] }),
      pista("envio", { sends: [{}] }),
    ],
  } as unknown as Parameters<typeof idsConEfectos>[0];
  assert.deepEqual([...idsConEfectos(project)], ["efecto", "envio"]);
});

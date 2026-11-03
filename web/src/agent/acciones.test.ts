import { test } from "node:test";
import assert from "node:assert/strict";

import { createProject } from "../../../src/core/project.ts";
import type { Project } from "../../../src/core/types.ts";
import { assetsPorStreaming } from "../audio-store.ts";
import { crearAcciones } from "./acciones.ts";

/**
 * A WAV of `segundos` behind a fake server and a fake decoder: /api/picos gives the
 * duration (as the real server does) and decodeAudioData returns a silent buffer of
 * that length. Enough for importarPistas to decide decode vs streaming.
 */
function servidorFalso(segundos: number): () => void {
  const fetchOriginal = globalThis.fetch;
  const contextoOriginal = (globalThis as { AudioContext?: unknown }).AudioContext;
  globalThis.fetch = (async (url: string | URL) => {
    const ruta = String(url);
    if (ruta.startsWith("/api/picos")) {
      return new Response(JSON.stringify({ picos: [0, 0], duracionSeg: segundos }));
    }
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
  return () => {
    globalThis.fetch = fetchOriginal;
    (globalThis as { AudioContext?: unknown }).AudioContext = contextoOriginal;
  };
}

async function importar(segundos: number, ruta: string, bpm = 125): Promise<{ texto: string; proyecto: Project }> {
  const restaurar = servidorFalso(segundos);
  let proyecto: Project = createProject({ name: "Stahl", bpm, lengthBars: 8 });
  try {
    const acciones = crearAcciones({
      proyecto: () => proyecto,
      fijar: (p) => (proyecto = p),
      enVivo: (p) => (proyecto = p),
      avisar: () => {},
    });
    const r = await acciones.anadirPistas({ midis: [], wavs: [ruta], inicioCompas: 0 });
    assert.equal(r.ok, true, r.texto);
    return { texto: r.texto, proyecto };
  } finally {
    restaurar();
  }
}

test("a 30.0 s generar_audio take is decoded, so escuchar_mezcla and the export hear it", async () => {
  // 2-Nov: the action had its own `>= 30 s` rule and streamed this take (silent in the mix).
  const { texto, proyecto } = await importar(30.0, "salida/toma_30s.wav");
  assert.match(texto, /\(audio, /);
  assert.doesNotMatch(texto, /streaming/);
  assert.deepEqual(assetsPorStreaming(proyecto), []);
});

test("a 35 s WAV is decoded too while it fits the memory budget", async () => {
  const { texto } = await importar(35, "salida/toma_35s.wav");
  assert.match(texto, /\(audio, /);
});

test("a stem that does not fit the budget still streams", async () => {
  // 20 min stereo Float32 ≈ 440 MB > 400 MB (at 60 BPM so it stays under 512 bars).
  const { texto } = await importar(1200, "salida/stem_largo.wav", 60);
  assert.match(texto, /streaming audio/);
});

test("crear_sonido refuses a GPU voice when the selector does not allow the GPU (3-Nov bug 4)", async () => {
  const original = globalThis.fetch;
  const rutas: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    rutas.push(String(url));
    const voz = { clave: "zumbido_gpu", etiqueta: "Zumbido", familia: "fx", descripcion: "", params: [], destino: "gpu" };
    return new Response(JSON.stringify(String(url) === "/api/voces" ? { voces: [voz] } : { ok: true }));
  }) as typeof fetch;
  let proyecto: Project = createProject({ name: "Stahl", bpm: 125, lengthBars: 8 });
  try {
    const acciones = crearAcciones({ proyecto: () => proyecto, fijar: (p) => (proyecto = p), enVivo: (p) => (proyecto = p), avisar: () => {} });
    const r = await acciones.crearSonido({ nombre: "zumbido", voz: "zumbido_gpu", gpuPermitida: false });
    assert.equal(r.ok, false);
    assert.match(r.texto, /The GPU is not allowed/);
    assert.deepEqual(rutas, ["/api/voces"], "nothing was written or run");
  } finally {
    globalThis.fetch = original;
  }
});

test("a cancelled anadir_pistas leaves the project untouched (3-Nov bug 5)", async () => {
  const restaurar = servidorFalso(30);
  let proyecto: Project = createProject({ name: "Stahl", bpm: 125, lengthBars: 8 });
  const antes = proyecto;
  let fijado = false;
  try {
    const acciones = crearAcciones({ proyecto: () => proyecto, fijar: (p) => ((fijado = true), (proyecto = p)), enVivo: (p) => (proyecto = p), avisar: () => {} });
    const corte = new AbortController();
    corte.abort();
    const r = await acciones.anadirPistas({ midis: [], wavs: ["salida/toma.wav"], inicioCompas: 0 }, corte.signal);
    assert.equal(r.texto, "Cancelled by the user.");
    assert.equal(fijado, false);
    assert.equal(proyecto, antes);
  } finally {
    restaurar();
  }
});

test("Cancel cuts usar_sample while the server converts, instead of waiting up to 300 s (3-Nov bug 5)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_listo, fallo) => {
      init?.signal?.addEventListener("abort", () => fallo(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  let proyecto: Project = createProject({ name: "Stahl", bpm: 125, lengthBars: 8 });
  try {
    const acciones = crearAcciones({ proyecto: () => proyecto, fijar: (p) => (proyecto = p), enVivo: (p) => (proyecto = p), avisar: () => {} });
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 20);
    const r = await acciones.usarSample({ archivo: "catalogo/kick.wav" }, corte.signal);
    assert.equal(r.texto, "Cancelled by the user.");
  } finally {
    globalThis.fetch = original;
  }
});

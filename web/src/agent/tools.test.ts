import { test } from "node:test";
import assert from "node:assert/strict";

import { HERRAMIENTAS, MANEJADORES, PREVIAS_GENERAR, ejecutarHerramienta, herramientasDelTurno, herramientasForzadas, motivoSinOps, opsDeArgumento, resumenLlamada, setDestino } from "./tools.ts";

/** Runs escribir_fichero against a fake /api/fs/write and returns what the server got. */
async function escribir(args: Record<string, unknown>): Promise<{ ok: boolean; texto: string; cuerpo: unknown }> {
  const original = globalThis.fetch;
  let cuerpo: unknown = null;
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    cuerpo = JSON.parse(String(init?.body ?? "null"));
    const c = cuerpo as { path: string; contenido: string };
    return new Response(JSON.stringify({ path: c.path, bytes: c.contenido.length }));
  }) as typeof fetch;
  try {
    const r = await ejecutarHerramienta("escribir_fichero", JSON.stringify(args));
    return { ok: r.ok, texto: r.texto, cuerpo };
  } finally {
    globalThis.fetch = original;
  }
}

test("escribir_fichero takes `content` as an alias of `contenido`", async () => {
  // 2-Nov: DeepSeek v4.1 flash sent `content` six times; three in a row aborted the turn.
  const r = await escribir({ path: "codigo/x.py", content: "print(1)\n" });
  assert.equal(r.ok, true, r.texto);
  assert.deepEqual(r.cuerpo, { path: "codigo/x.py", contenido: "print(1)\n" });
  assert.equal(resumenLlamada("escribir_fichero", JSON.stringify({ path: "a/x.py", content: "abc" })), "writing x.py (3 chars)");
});

test("escribir_fichero without text says what is missing and writes nothing", async () => {
  const r = await escribir({ path: "codigo/x.py" });
  assert.equal(r.ok, false);
  assert.match(r.texto, /Missing `contenido`/);
  assert.equal(r.cuerpo, null);
});

/** Runs a tool against a fake server and returns its answer and the routes it called. */
async function conServidorFalso(nombre: string, args: Record<string, unknown>): Promise<{ ok: boolean; texto: string; rutas: string[] }> {
  const original = globalThis.fetch;
  const rutas: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    rutas.push(String(url));
    return new Response(JSON.stringify({ ok: true }));
  }) as typeof fetch;
  try {
    const r = await ejecutarHerramienta(nombre, JSON.stringify(args));
    return { ok: r.ok, texto: r.texto, rutas };
  } finally {
    globalThis.fetch = original;
  }
}

const LLAMADAS_GPU: [string, Record<string, unknown>][] = [
  ["generar_audio", { prompt: "industrial", nombre: "toma" }],
  ["proponer_midi", { prompt: "industrial", nombre: "idea" }],
  ["crear_voz", { nombre: "zumbido", fuente: "def zumbido(vel=1.0):\n    return vel  # long enough source text", destino: "gpu" }],
  ["ejecutar_python", { path: "gpu/x.py", destino: "lambda" }],
];

test("with the selector on CPU no tool reaches Lambda (3-Nov bug 4: only ejecutar_python was gated)", async () => {
  setDestino("cpu");
  for (const [nombre, args] of LLAMADAS_GPU) {
    const r = await conServidorFalso(nombre, args);
    assert.equal(r.ok, false, nombre);
    assert.match(r.texto, /The GPU is not allowed/, nombre);
    assert.deepEqual(r.rutas, [], `${nombre} called the server`);
  }
});

test("with the selector on GPU the same calls pass the gate", async () => {
  setDestino("lambda");
  try {
    for (const [nombre, args] of LLAMADAS_GPU) {
      const r = await conServidorFalso(nombre, args);
      assert.doesNotMatch(r.texto, /The GPU is not allowed/, nombre);
    }
  } finally {
    setDestino("cpu");
  }
});

test("Cancel reaches leer_fichero in flight and is reported as a cancel, not a timeout (3-Nov bug 5)", async () => {
  const original = globalThis.fetch;
  let recibioSenal = false;
  globalThis.fetch = ((_url: string | URL, init?: RequestInit) =>
    new Promise<Response>((_listo, fallo) => {
      recibioSenal = init?.signal instanceof AbortSignal;
      init?.signal?.addEventListener("abort", () => fallo(new DOMException("aborted", "AbortError")));
    })) as typeof fetch;
  try {
    const corte = new AbortController();
    setTimeout(() => corte.abort(), 20);
    const r = await ejecutarHerramienta("leer_fichero", JSON.stringify({ path: "notas.txt" }), corte.signal);
    assert.equal(recibioSenal, true);
    assert.equal(r.ok, false);
    assert.equal(r.texto, "Cancelled by the user.");
  } finally {
    globalThis.fetch = original;
  }
});

test("every declared tool has a handler and every handler is declared (3-Nov step 3)", () => {
  const declaradas = HERRAMIENTAS.map((h) => h.function.name).sort();
  assert.deepEqual(Object.keys(MANEJADORES).sort(), declaradas);
  assert.equal(declaradas.length, 31);
});

test("an unknown tool name is refused, also one that names an Object method", async () => {
  for (const nombre of ["no_existe", "toString", "constructor"]) {
    const r = await ejecutarHerramienta(nombre, "{}");
    assert.equal(r.ok, false);
    assert.match(r.texto, /Unknown tool/, nombre);
  }
});

test("with the selector on CPU the GPU tools are not offered at all", () => {
  // Carlos, 4-Nov: the person chooses, the code enforces (docs/PLAN-PROVEEDORES-GPU.md).
  const nombres = (d: Parameters<typeof herramientasDelTurno>[0]) => herramientasDelTurno(d).map((h) => h.function.name);
  assert.ok(!nombres("cpu").includes("generar_audio"));
  assert.ok(!nombres("cpu").includes("proponer_midi"));
  assert.ok(nombres("lambda").includes("generar_audio") && nombres("lambda").includes("proponer_midi"));
  assert.equal(nombres("lambda").length, HERRAMIENTAS.length);
  const enumDe = (d: Parameters<typeof herramientasDelTurno>[0], tool: string): string[] =>
    ((herramientasDelTurno(d).find((h) => h.function.name === tool)!.function.parameters as { properties: Record<string, { enum: string[] }> })
      .properties.destino!.enum);
  assert.deepEqual(enumDe("cpu", "ejecutar_python"), ["cpu"]);
  assert.deepEqual(enumDe("cpu", "crear_voz"), ["cpu"]);
  assert.deepEqual(enumDe("lambda", "ejecutar_python"), ["cpu", "lambda"]);
  // The shared list itself is not mutated by the CPU view.
  assert.deepEqual(enumDe("lambda", "crear_voz"), ["cpu", "gpu"]);
});

test("editar_proyecto takes ops as a list or as that list in JSON text", () => {
  // 4-Nov "herminia": "ops": "[{...}]" was refused as missing.
  assert.deepEqual(opsDeArgumento([{ op: "set_master", gainDb: -3 }]), [{ op: "set_master", gainDb: -3 }]);
  assert.deepEqual(opsDeArgumento('[{"op":"set_master","gainDb":-3}]'), [{ op: "set_master", gainDb: -3 }]);
  assert.deepEqual(opsDeArgumento("[{no json"), []);
  assert.deepEqual(opsDeArgumento('{"op":"set_master"}'), []);
  assert.deepEqual(opsDeArgumento(undefined), []);
});

test("a forced generar_audio turn only offers it and what leads to it, and nothing on CPU", () => {
  // 4-Nov: Ollama Cloud ignores tool_choice, so the list itself is narrowed.
  const nombres = (l: ReturnType<typeof herramientasForzadas>) => l.map((h) => h.function.name).sort();
  assert.deepEqual(
    nombres(herramientasForzadas(herramientasDelTurno("lambda"), "generar_audio", PREVIAS_GENERAR)),
    ["crear_proyecto", "generar_audio", "leer_proyecto", "listar_ficheros"],
  );
  assert.deepEqual(herramientasForzadas(herramientasDelTurno("cpu"), "generar_audio", PREVIAS_GENERAR), []);
});

test("when ops gives nothing, the refusal says why (4-Nov, prueba-nivel: JSON text missing its final ])", () => {
  const cortado = '[{"op": "set_song", "lengthBars": 8}, {"op": "set_send", "trackId": "Arpa", "busId": "sala", "levelDb": -12}';
  assert.match(motivoSinOps(cortado), /does not parse/);
  assert.match(motivoSinOps(cortado), /"levelDb": -12}$|levelDb": -12}\. Check/);
  assert.match(motivoSinOps('{"op":"set_master"}'), /not a list/);
  assert.match(motivoSinOps([]), /empty list/);
  assert.match(motivoSinOps(undefined), /Missing `ops`/);
});

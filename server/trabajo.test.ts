import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cambiadosDesde, ficherosDeTrabajo, proyectosEnDisco } from "./trabajo.ts";

function espacio(): string {
  const raiz = mkdtempSync(join(tmpdir(), "miuzika-trabajo-"));
  const escribir = (rel: string, texto: string): void => {
    mkdirSync(join(raiz, rel, ".."), { recursive: true });
    writeFileSync(join(raiz, rel), texto);
  };
  escribir("proyectos/hard/proyecto.json", JSON.stringify({ guardadoEn: "x", proyecto: { name: "Hard", bpm: 90, lengthBars: 112, tracks: [1, 2] } }));
  escribir("proyectos/hard/generado/toma.wav", "RIFF");
  escribir("proyectos/hard/versiones/v1.json", "{}");
  escribir("proyectos/hard/trayectorias/t1.json", "{}");
  escribir("proyectos/roto/proyecto.json", "{no");
  escribir("proyectos/sin-maestro/notas.txt", "x");
  escribir("catalogo/kick.wav", "RIFF");
  return raiz;
}

test("projects on disk: only folders with proyecto.json, an unreadable one says so", () => {
  const raiz = espacio();
  try {
    const lista = proyectosEnDisco(raiz);
    assert.deepEqual(lista.map((p) => p.slug).sort(), ["hard", "roto"]);
    const hard = lista.find((p) => p.slug === "hard")!;
    assert.equal(hard.nombre, "Hard");
    assert.equal(hard.compases, 112);
    assert.equal(hard.pistas, 2);
    assert.ok(typeof lista.find((p) => p.slug === "roto")!.error === "string");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("listing skips the hidden folders and refuses to leave the workspace", () => {
  const raiz = espacio();
  try {
    const rutas = ficherosDeTrabajo(raiz, "proyectos/hard").map((f) => f.path);
    assert.deepEqual(rutas.sort(), ["proyectos/hard/generado/toma.wav", "proyectos/hard/proyecto.json"]);
    assert.ok(!ficherosDeTrabajo(raiz, "").some((f) => f.path.startsWith("catalogo/")));
    assert.deepEqual(ficherosDeTrabajo(raiz, "../"), []);
    assert.deepEqual(ficherosDeTrabajo(raiz, "no-existe"), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("what changed in a project since a moment, relative to the project", () => {
  const raiz = espacio();
  try {
    const antes = Date.now() - 60_000;
    const viejo = new Date(antes - 60_000);
    utimesSync(join(raiz, "proyectos/hard/proyecto.json"), viejo, viejo);
    assert.deepEqual(cambiadosDesde(raiz, "hard", antes), ["generado/toma.wav"]);
    assert.deepEqual(cambiadosDesde(raiz, "no-existe", antes), []);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

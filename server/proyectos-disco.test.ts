import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { borrarProyecto, carpetaDeSlug, duplicarProyecto, tamanoDeCarpeta } from "./proyectos-disco.ts";

function espacio(): string {
  const raiz = mkdtempSync(join(tmpdir(), "miuzika-proyectos-"));
  const escribir = (rel: string, texto: string): void => {
    mkdirSync(join(raiz, rel, ".."), { recursive: true });
    writeFileSync(join(raiz, rel), texto);
  };
  escribir("proyectos/hard/proyecto.json", JSON.stringify({ formato: "x", proyecto: { id: "prj_1", name: "Hard", meta: { carpeta: "hard", generator: "miuzika" } } }));
  escribir("proyectos/hard/generado/toma.wav", "RIFF1234");
  escribir("proyectos/hard/entrada/voz.wav", "RIFF");
  escribir("proyectos/hard-copia/proyecto.json", "{}");
  escribir("proyectos/solo/proyecto.json", "{}");
  escribir("proyectos/roto/proyecto.json", "{no");
  escribir("fuera.txt", "x");
  return raiz;
}

test("a slug is one existing folder right under proyectos/, nothing else", () => {
  const raiz = espacio();
  try {
    assert.ok(carpetaDeSlug(raiz, "hard"));
    for (const malo of ["", ".", "..", "../hard", "hard/generado", "hard\\generado", "no-existe", "C:", 7, null, undefined]) {
      assert.equal(carpetaDeSlug(raiz, malo), null, String(malo));
    }
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("the size of a folder counts every file under it", () => {
  const raiz = espacio();
  try {
    const t = tamanoDeCarpeta(join(raiz, "proyectos", "hard"));
    assert.equal(t.ficheros, 3);
    assert.equal(t.bytes, readFileSync(join(raiz, "proyectos/hard/proyecto.json")).length + 8 + 4);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("a duplicate is the whole folder under a free name, with its own name, id and folder", () => {
  const raiz = espacio();
  try {
    const uno = duplicarProyecto(raiz, "hard");
    assert.equal(uno.slug, "hard-copy");
    assert.equal(uno.nombre, "Hard (copy)");
    assert.equal(uno.ficheros, 3);
    assert.equal(readFileSync(join(raiz, "proyectos/hard-copy/generado/toma.wav"), "utf8"), "RIFF1234");
    const copia = JSON.parse(readFileSync(join(raiz, "proyectos/hard-copy/proyecto.json"), "utf8")) as { formato: string; proyecto: { id: string; name: string; meta: Record<string, string> } };
    assert.equal(copia.formato, "x");
    assert.equal(copia.proyecto.name, "Hard (copy)");
    assert.notEqual(copia.proyecto.id, "prj_1");
    assert.deepEqual(copia.proyecto.meta, { carpeta: "hard-copy", generator: "miuzika" });
    // The source is untouched, and a second duplicate does not land on the first.
    assert.equal((JSON.parse(readFileSync(join(raiz, "proyectos/hard/proyecto.json"), "utf8")) as { proyecto: { name: string } }).proyecto.name, "Hard");
    assert.equal(duplicarProyecto(raiz, "hard").slug, "hard-copy-2");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("an unreadable master file is duplicated as it is; a missing project is refused", () => {
  const raiz = espacio();
  try {
    assert.equal(duplicarProyecto(raiz, "roto").slug, "roto-copy");
    assert.equal(readFileSync(join(raiz, "proyectos/roto-copy/proyecto.json"), "utf8"), "{no");
    assert.throws(() => duplicarProyecto(raiz, "../fuera"), /no project folder/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("deleting without the folder takes only the master file and leaves the audio", () => {
  const raiz = espacio();
  try {
    assert.deepEqual(borrarProyecto(raiz, "hard", false), { slug: "hard", carpetaBorrada: false, quedan: 2 });
    assert.equal(existsSync(join(raiz, "proyectos/hard/proyecto.json")), false);
    assert.equal(existsSync(join(raiz, "proyectos/hard/generado/toma.wav")), true);
    // Nothing else in the folder: it goes too, instead of staying as an empty folder.
    assert.deepEqual(borrarProyecto(raiz, "solo", false), { slug: "solo", carpetaBorrada: true, quedan: 0 });
    assert.equal(existsSync(join(raiz, "proyectos/solo")), false);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("deleting with the folder takes everything in it and nothing next to it", () => {
  const raiz = espacio();
  try {
    assert.deepEqual(borrarProyecto(raiz, "hard", true), { slug: "hard", carpetaBorrada: true, quedan: 0 });
    assert.equal(existsSync(join(raiz, "proyectos/hard")), false);
    assert.equal(existsSync(join(raiz, "proyectos/hard-copia/proyecto.json")), true);
    assert.equal(existsSync(join(raiz, "fuera.txt")), true);
    for (const malo of ["..", ".", "", "../proyectos", "hard-copia/.."]) assert.throws(() => borrarProyecto(raiz, malo, true), /no project folder/);
    assert.equal(existsSync(join(raiz, "proyectos/hard-copia/proyecto.json")), true);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("a project's files are measured and deleted by the names its master file gives them, and nothing else", async () => {
  const { ficherosDeProyecto } = await import("./proyectos-disco.ts");
  const raiz = espacio();
  try {
    const rutas = ["generado/toma.wav", "entrada/voz.wav", "no/esta.wav", "../hard-copia/proyecto.json", "proyecto.json", "generado", "C:/x.wav", "generado/toma.wav"];
    const medidos = ficherosDeProyecto(raiz, "hard", rutas, false);
    assert.deepEqual(medidos.map((m) => m.bytes), [8, 4, null, null, null, null, null]);
    assert.equal(existsSync(join(raiz, "proyectos/hard/generado/toma.wav")), true);
    const borrados = ficherosDeProyecto(raiz, "hard", rutas, true);
    assert.deepEqual(borrados.map((b) => b.borrado), [true, true, false, false, false, false, false]);
    assert.equal(existsSync(join(raiz, "proyectos/hard/generado/toma.wav")), false);
    assert.equal(existsSync(join(raiz, "proyectos/hard/proyecto.json")), true);
    assert.equal(existsSync(join(raiz, "proyectos/hard-copia/proyecto.json")), true);
    assert.throws(() => ficherosDeProyecto(raiz, "..", ["x"], true), /no project folder/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

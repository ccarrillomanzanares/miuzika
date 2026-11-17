import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anotarNota, leerNotas, marcarLeidas, notaDe, notaLegible, notasSinLeer } from "./notas.ts";

const AHORA = new Date("2026-01-02T03:04:05.000Z");

test("a note keeps its words, verdict and context", () => {
  const r = notaDe({ texto: "  barely audible  ", veredicto: "fail", contexto: { compas: 9 } }, AHORA);
  assert.deepEqual(r, { nota: { t: "2026-01-02T03:04:05.000Z", veredicto: "fail", texto: "barely audible", contexto: { compas: 9 } } });
});

test("a verdict alone is a note; nothing at all is not", () => {
  assert.ok("nota" in notaDe({ veredicto: "pass" }, AHORA));
  assert.ok("error" in notaDe({ texto: "   " }, AHORA));
  assert.ok("error" in notaDe(null, AHORA));
});

test("an unknown verdict or an endless text is refused", () => {
  assert.ok("error" in notaDe({ texto: "x", veredicto: "great" }, AHORA));
  assert.ok("error" in notaDe({ texto: "x".repeat(2001) }, AHORA));
});

test("a context too large is dropped and said, the note stays", () => {
  const r = notaDe({ texto: "x", contexto: { relleno: "y".repeat(40_000) } }, AHORA);
  assert.ok("nota" in r);
  if ("nota" in r) {
    assert.equal(r.nota.contexto, undefined);
    assert.equal(r.nota.contextoRecortado, true);
  }
});

test("only the lines after the mark are new; a shorter file is all new", () => {
  assert.deepEqual(notasSinLeer("a\nb\nc\n", 1), { nuevas: ["b", "c"], total: 3 });
  assert.deepEqual(notasSinLeer("a\nb\n", 2), { nuevas: [], total: 2 });
  assert.deepEqual(notasSinLeer("a\n", 5), { nuevas: ["a"], total: 1 });
  assert.deepEqual(notasSinLeer("", 0), { nuevas: [], total: 0 });
  assert.deepEqual(notasSinLeer("a\n", Number.NaN), { nuevas: ["a"], total: 1 });
});

test("written, read, marked: the next read is empty until another arrives", () => {
  const carpeta = mkdtempSync(join(tmpdir(), "miuzika-notas-"));
  const fichero = join(carpeta, "notas.log");
  try {
    assert.deepEqual(leerNotas(fichero), { nuevas: [], total: 0 });
    anotarNota({ t: AHORA.toISOString(), texto: "one\nwith a line break" }, fichero);
    anotarNota({ t: AHORA.toISOString(), texto: "two", veredicto: "pass" }, fichero);
    assert.equal(readFileSync(fichero, "utf8").trim().split("\n").length, 2);
    assert.equal(leerNotas(fichero).nuevas.length, 2);
    assert.equal(marcarLeidas(fichero), 2);
    assert.equal(leerNotas(fichero).nuevas.length, 0);
    anotarNota({ t: AHORA.toISOString(), texto: "three" }, fichero);
    const { nuevas } = leerNotas(fichero);
    assert.equal(nuevas.length, 1);
    assert.match(notaLegible(nuevas[0]!), /three/);
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
});

test("a note reads as date, verdict, words and context", () => {
  const linea = JSON.stringify({ t: AHORA.toISOString(), veredicto: "so-so", texto: "thin", contexto: { compas: 3 } });
  assert.equal(notaLegible(linea), '[2026-01-02T03:04:05.000Z] SO-SO  thin\n  context: {"compas":3}');
  assert.match(notaLegible("not json"), /unreadable/);
});

// The notes are the user's own words and the repository is public: they must never be committable by accident.
test("the notes file and its mark are ignored by git", () => {
  for (const fichero of [".miuzika/notas.log", ".miuzika/notas.leido"]) {
    // Exit 0 = ignored; 1 (not ignored) makes execFileSync throw.
    execFileSync("git", ["check-ignore", "-q", fichero]);
  }
});

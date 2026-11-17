/**
 * The notes left from the app (the "Note" box): what was thought of something at the moment it was used, with what
 * the app was showing then. One JSON line each in `.miuzika/notas.log`.
 *
 * The file is the user's own words: outside git (`.miuzika/` is ignored, and a test fails if that stops being true)
 * and outside workspace/. What is learned from a note goes to ESTADO.md as a verdict; the words stay here.
 * `.miuzika/notas.leido` holds how many lines have been read, so a session sees only the new ones.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** MIUZIKA_NOTAS points a test server at another file, so trying the route never writes among the real notes. */
export const FICHERO_NOTAS = process.env.MIUZIKA_NOTAS || resolve(process.cwd(), ".miuzika", "notas.log");
export const ficheroLeidas = (fichero = FICHERO_NOTAS): string => fichero.replace(/\.log$/, "") + ".leido";

export const VEREDICTOS = ["pass", "so-so", "fail"] as const;
export type Veredicto = (typeof VEREDICTOS)[number];

const MAX_TEXTO = 2000;
/** A context is a chain of effects or a form: a few kB. Beyond this something went wrong in the page; the note still counts. */
const MAX_CONTEXTO = 32 * 1024;

export interface Nota {
  t: string;
  veredicto?: Veredicto;
  texto: string;
  contexto?: unknown;
  contextoRecortado?: true;
}

/** The line to write for what the page sent, or why it is refused. */
export function notaDe(datos: unknown, ahora: Date): { nota: Nota } | { error: string } {
  const d = (typeof datos === "object" && datos !== null ? datos : {}) as Record<string, unknown>;
  const texto = typeof d.texto === "string" ? d.texto.trim() : "";
  const veredicto = VEREDICTOS.find((v) => v === d.veredicto);
  if (d.veredicto !== undefined && d.veredicto !== null && !veredicto) return { error: `veredicto: one of ${VEREDICTOS.join(", ")}` };
  if (texto === "" && !veredicto) return { error: "a note needs some text or a verdict" };
  if (texto.length > MAX_TEXTO) return { error: `texto: at most ${MAX_TEXTO} characters` };
  const nota: Nota = { t: ahora.toISOString(), ...(veredicto ? { veredicto } : {}), texto };
  if (typeof d.contexto === "object" && d.contexto !== null) {
    if (JSON.stringify(d.contexto).length <= MAX_CONTEXTO) nota.contexto = d.contexto;
    else nota.contextoRecortado = true;
  }
  return { nota };
}

export function anotarNota(nota: Nota, fichero = FICHERO_NOTAS): void {
  mkdirSync(dirname(fichero), { recursive: true });
  appendFileSync(fichero, `${JSON.stringify(nota)}\n`, "utf8");
}

/**
 * The lines after the first `leidas`. A file shorter than the mark was emptied or replaced: everything in it is new.
 */
export function notasSinLeer(contenido: string, leidas: number): { nuevas: string[]; total: number } {
  const lineas = contenido.split("\n").filter((l) => l.trim() !== "");
  const desde = Number.isInteger(leidas) && leidas >= 0 && leidas <= lineas.length ? leidas : 0;
  return { nuevas: lineas.slice(desde), total: lineas.length };
}

export function leerNotas(fichero = FICHERO_NOTAS): { nuevas: string[]; total: number } {
  const contenido = existsSync(fichero) ? readFileSync(fichero, "utf8") : "";
  const marca = ficheroLeidas(fichero);
  const leidas = existsSync(marca) ? Number(readFileSync(marca, "utf8").trim()) : 0;
  return notasSinLeer(contenido, leidas);
}

export function marcarLeidas(fichero = FICHERO_NOTAS): number {
  const { total } = leerNotas(fichero);
  mkdirSync(dirname(fichero), { recursive: true });
  writeFileSync(ficheroLeidas(fichero), `${total}\n`, "utf8");
  return total;
}

/** One note as a person reads it: when, the verdict, the words, then its context. */
export function notaLegible(linea: string): string {
  let nota: Nota;
  try {
    nota = JSON.parse(linea) as Nota;
  } catch {
    return `(unreadable line) ${linea}`;
  }
  const cabeza = `[${nota.t}]${nota.veredicto ? ` ${nota.veredicto.toUpperCase()}` : ""}  ${nota.texto || "(no text)"}`;
  const contexto = nota.contextoRecortado ? "  context: dropped, too large" : nota.contexto ? `  context: ${JSON.stringify(nota.contexto)}` : "";
  return contexto ? `${cabeza}\n${contexto}` : cabeza;
}

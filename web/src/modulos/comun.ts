/**
 * What the MuLaCover and Demucs windows share (8-Nov): the source audio, the run on the GPU and small HTML
 * helpers. ACE-Step's window keeps its own copies on purpose: it was heard and checked, and is not touched.
 */

import { carpetaDeProyecto } from "../../../src/core/project.ts";
import { metadatosWav, rutaEnProyecto } from "../audio-store.ts";
import { cabeceraDeProyecto, subirAudio } from "../proyecto-disco.ts";
import type { BarraGpu } from "../gpu-barra.ts";
import type { Anfitrion } from "./anfitrion.ts";

/** Under this a source counts as silence (the 5-Nov run that uploaded 42 MB of nothing). */
export const SILENCIO_DBFS = -60;

export const esc = (texto: string): string => texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** The newline after the tag is the one the HTML parser eats (6-Nov: a leading line break was lost). */
export const areaDeTexto = (atributos: string, filas: number, valor: string): string => `<textarea ${atributos} rows="${filas}">\n${esc(valor)}</textarea>`;
export const numero = (texto: string | undefined): number | null => {
  if (texto === undefined || texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
};
export const fila = (etiqueta: string, control: string, ayuda = ""): string =>
  `<div class="ace-fila"><label>${etiqueta}</label><div>${control}${ayuda ? `<small>${ayuda}</small>` : ""}</div></div>`;

export interface ResultadoRun {
  ok: boolean;
  codigo: number | null;
  ms: number;
  por_timeout: boolean;
  salida: string;
  errores: string;
  nota: string;
  traidos: string[];
  traida_fallo: string;
}

export function causaDeFallo(r: ResultadoRun): string {
  return r.por_timeout ? "the time limit cut the run off" : r.errores.trim().split("\n").slice(-4).join(" ") || `exit ${r.codigo}`;
}

/** The project's folder if one is open, else a free folder named after the take. */
export async function carpetaDestino(a: Anfitrion, nombre: string, porDefecto: string): Promise<string> {
  const p = a.proyecto();
  return p ? carpetaDeProyecto(p) : a.carpetaParaNuevo(nombre || porDefecto);
}

export interface AudioPreparado {
  audio: string;
  descripcion: string;
  bytes: number;
  carpeta: string;
  /** Length of the source file. */
  segundos: number;
}

/**
 * The source as a WAV in the project folder: the chosen tracks rendered whole, or a file uploaded (an MP3 is
 * converted to WAV on arrival, bug 6). A silent source is refused before any money is spent.
 */
export async function prepararAudio(
  a: Anfitrion,
  o: { tipo: "pistas" | "archivo"; pistas: string[]; archivo: File | null; nombre: string; porDefecto: string },
): Promise<AudioPreparado> {
  const p = a.proyecto();
  if (o.tipo === "pistas") {
    if (!p) throw new Error("There is no project open: choose a file.");
    if (o.pistas.length === 0) throw new Error("Choose the tracks to send.");
    const r = await a.renderizarPistas({ pistas: o.pistas, nombre: `${o.nombre || "fuente"}-fuente` });
    if (r.picoDb < SILENCIO_DBFS) throw new Error(`The chosen tracks sound silent (peak ${r.picoDb.toFixed(1)} dBFS). Nothing was sent.`);
    for (const aviso of r.avisos) a.avisos.error(aviso);
    const nombres = p.tracks.filter((t) => o.pistas.includes(t.id)).map((t) => t.name).join(", ");
    return {
      audio: r.ruta,
      descripcion: `${nombres}: ${r.segundos.toFixed(1)} s, ${r.nivel}, ${(r.bytes / 1048576).toFixed(1)} MB`,
      bytes: r.bytes,
      carpeta: carpetaDeProyecto(p),
      segundos: r.segundos,
    };
  }
  if (!o.archivo) throw new Error("Choose the file to send.");
  const carpeta = await carpetaDestino(a, o.nombre, o.porDefecto);
  const { path, bytes } = await subirAudio(o.archivo, carpeta);
  const { picos, duracionSeg } = await metadatosWav(rutaEnProyecto(path, carpeta));
  const pico = picos.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const picoDb = pico > 0 ? 20 * Math.log10(pico) : -Infinity;
  if (picoDb < SILENCIO_DBFS) throw new Error(`“${o.archivo.name}” is silent (peak ${picoDb.toFixed(1)} dBFS). Nothing was sent.`);
  return {
    audio: path,
    descripcion: `${o.archivo.name}: ${duracionSeg.toFixed(1)} s, peak ${picoDb.toFixed(1)} dBFS, ${(bytes / 1048576).toFixed(1)} MB`,
    bytes,
    carpeta,
    segundos: duracionSeg,
  };
}

/** A .mid copied to the project's entrada/, as is. */
export async function subirMidi(a: Anfitrion, archivo: File, nombre: string, porDefecto: string): Promise<{ ruta: string; carpeta: string }> {
  const carpeta = await carpetaDestino(a, nombre, porDefecto);
  const { path } = await subirAudio(archivo, carpeta);
  return { ruta: path, carpeta };
}

/**
 * Sends a run of a script of workspace/gpu/ and waits only for the server's answer, which arrives before the machine
 * boots: a refusal (a taken name, a missing input, no Hugging Face token…) throws with the server's reason, so the window
 * can say it on Review and keep the form. Noted 7-Nov: Run closed the window first, the 409 only reached the Log and the
 * form's edits were gone. The window closes only once this resolves; then `seguirEnGpu` reads the run.
 */
export async function iniciarEnGpu(o: {
  script: string;
  nombre: string;
  receta: unknown;
  entradas: string[];
  carpeta: string;
  senal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch("/api/gpu/ejecutar", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(o.carpeta) },
    body: JSON.stringify({ script: o.script, nombre: o.nombre, receta: o.receta, entradas: o.entradas }),
    signal: o.senal,
  });
  if (!res.ok || !res.body) {
    const datos = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(datos.error ?? `HTTP ${res.status}`);
  }
  return res.body;
}

/**
 * Reads a run started by `iniciarEnGpu` and returns its result. Steps reach the GPU bar. The browser's fetch has no body
 * timeout, unlike Node's (8-Nov: Node cut a silent 5-min MuLaCover run, which the server took as Cancel).
 */
export async function seguirEnGpu(cuerpo: ReadableStream<Uint8Array>, o: { etiqueta: string; gpu: BarraGpu }): Promise<ResultadoRun> {
  const lector = cuerpo.getReader();
  const decodificador = new TextDecoder();
  let resto = "";
  let resultado: ResultadoRun | null = null;
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    resto += decodificador.decode(value, { stream: true });
    const lineas = resto.split("\n");
    resto = lineas.pop() ?? "";
    for (const linea of lineas.filter(Boolean)) {
      const dato = JSON.parse(linea) as { aviso?: string; error?: string; resultado?: ResultadoRun };
      if (dato.aviso) {
        o.gpu.fijarTarea(`${o.etiqueta}: ${dato.aviso}`);
        void o.gpu.refrescar();
      }
      if (dato.error) throw new Error(dato.error);
      if (dato.resultado) resultado = dato.resultado;
    }
  }
  if (!resultado) throw new Error("the server closed the connection without a result");
  return resultado;
}

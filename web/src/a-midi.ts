/**
 * "To MIDI": the selected audio track's clips become a new MIDI track, with Basic Pitch on this machine (8-Nov-2026, Carlos:
 * "transcribe to midi cómo se haría?"; heard on Demucs stems: "está lejos de ser perfecta pero puede ayudar a componer").
 * Each clip is transcribed for the part of its WAV it plays, and its notes land where the clip is.
 */

import type { Project, Track } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { applyOps, type Op } from "../../src/core/ops.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { segundosPorTiempo } from "../../src/core/tiempo.ts";
import { PROGRAMAS_GM } from "../../src/core/gm-nombres.ts";
import { cabeceraDeProyecto } from "./proyecto-disco.ts";
import type { Avisos } from "./avisos.ts";

type Tipo = "bajo" | "melodia" | "acordes" | "otro" | "bateria";

const TIPOS: { id: Tipo; etiqueta: string; ayuda: string; instrumento: Track["instrument"] | null }[] = [
  { id: "bajo", etiqueta: "Bass", ayuda: "One low line: of notes heard together, the lowest is kept (Basic Pitch often adds the octave above).", instrumento: { type: "bass", program: 38 } },
  { id: "melodia", etiqueta: "Melody", ayuda: "One line: voice, lead synth, solo guitar, flute… Of notes heard together, the strongest is kept.", instrumento: { type: "lead", program: 81 } },
  { id: "acordes", etiqueta: "Chords / pad", ayuda: "Several notes at once: piano, rhythm guitar, strings, organ, pads. Nothing is removed.", instrumento: { type: "pad", program: 89 } },
  { id: "otro", etiqueta: "Other / not sure", ayuda: "What Basic Pitch hears, as it comes, in the whole range.", instrumento: { type: "synth", program: 0 } },
  { id: "bateria", etiqueta: "Drums", ayuda: "Not possible: Basic Pitch only hears pitched notes, and drums are hits.", instrumento: null },
];

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const nota = (m: number): string => `${["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][m % 12]}${Math.floor(m / 12) - 1}`;

interface Resultado {
  ok: boolean;
  error?: string;
  mid?: string;
  notas?: { pitch: number; start: number; duration: number; velocity: number }[];
  resumen?: { notas: number; crudas: number; segundos: number; por_segundo: number; grave: number | null; agudo: number | null; s: number };
}

export class VentanaAMidi {
  private readonly dialogo: HTMLDialogElement;
  private pista: string | null = null;
  private v = { tipo: "melodia" as Tipo, sensibilidad: "media", minimo: "128", rejilla: "0" };
  private ocupada = false;
  private mensaje = "";
  private instalado = true;

  constructor(
    private readonly d: {
      proyecto(): Project | null;
      aplicar(next: Project): void;
      avisos: Avisos;
    },
  ) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho acestep";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement | HTMLSelectElement;
      if (el.name === "tipo") this.v.tipo = el.value as Tipo;
      else if (el.name === "sensibilidad" || el.name === "minimo" || el.name === "rejilla") this.v[el.name] = el.value;
      this.pintar();
    });
    this.dialogo.addEventListener("click", (e) => {
      const accion = (e.target as HTMLElement).closest<HTMLElement>("[data-accion]")?.dataset.accion;
      if (accion === "cerrar") this.dialogo.close();
      else if (accion === "lanzar") void this.lanzar();
    });
  }

  async abrir(trackId: string): Promise<void> {
    const t = this.d.proyecto()?.tracks.find((x) => x.id === trackId);
    if (!t || t.kind !== "audio") return;
    this.pista = trackId;
    this.mensaje = "";
    try {
      this.instalado = ((await (await fetch("/api/transcribir/estado")).json()) as { instalado?: boolean }).instalado !== false;
    } catch {
      this.instalado = true;
    }
    this.pintar();
    if (!this.dialogo.open) this.dialogo.showModal();
  }

  private pista_(): Track | undefined {
    return this.d.proyecto()?.tracks.find((t) => t.id === this.pista);
  }

  private pintar(): void {
    const t = this.pista_();
    if (!t) return;
    const tipo = TIPOS.find((x) => x.id === this.v.tipo)!;
    const sel = (nombre: "sensibilidad" | "rejilla", opciones: [string, string][]): string =>
      `<select name="${nombre}">${opciones.map(([v, e]) => `<option value="${v}"${this.v[nombre] === v ? " selected" : ""}>${esc(e)}</option>`).join("")}</select>`;
    const fila = (etiqueta: string, control: string, ayuda = ""): string =>
      `<div class="ace-fila"><label>${etiqueta}</label><div>${control}${ayuda ? `<small>${ayuda}</small>` : ""}</div></div>`;
    const clips = t.clips.filter((c) => c.audio);
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>To MIDI · ${esc(t.name)}</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Turns the notes heard in this audio into a new MIDI track, with Basic Pitch on this computer: no GPU, no cost. It works on <strong>one clean instrument</strong>; for a whole song, separate it first with Demucs and transcribe each part. Far from perfect: a sketch to compose from.</p>
      <div class="ace-cuerpo">
        ${fila("What is it", `<div class="ace-lista">${TIPOS.map((x) => `<label class="ace-opcion"><input type="radio" name="tipo" value="${x.id}"${x.id === this.v.tipo ? " checked" : ""}> ${x.etiqueta}</label>`).join("")}</div>`, esc(tipo.ayuda))}
        ${fila("Sensitivity", sel("sensibilidad", [["baja", "low: fewer, surer notes"], ["media", "medium (its default)"], ["alta", "high: more notes, more mistakes"]]))}
        ${fila("Shortest note", `<input type="number" name="minimo" value="${esc(this.v.minimo)}" step="1" min="20" max="1000"> ms`, "Shorter notes are dropped (its default is 128 ms).")}
        ${fila("Snap to grid", sel("rejilla", [["0", "no: as played"], ["0.5", "1/8"], ["0.25", "1/16"]]), "At the project's tempo.")}
        ${fila("Clips", `<code>${clips.length}</code>`, "Each clip is transcribed for the part it plays; the notes land where the clip is.")}
        ${tipo.instrumento ? fila("Comes in as", `<code>${esc(`${t.name} (MIDI)`)}</code> · ${esc(PROGRAMAS_GM[tipo.instrumento.program ?? 0] ?? "")}`, "Change it with the instrument picker afterwards.") : ""}
      </div>
      ${this.instalado ? "" : `<p class="ace-nota">The first time, Basic Pitch is installed on this computer (about 460 MB, two minutes or so).</p>`}
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones">
        <button type="button" class="primario" data-accion="lanzar"${this.ocupada || !tipo.instrumento || clips.length === 0 ? " disabled" : ""}>${this.ocupada ? "Transcribing…" : "Transcribe"}</button>
      </div>`;
  }

  private async lanzar(): Promise<void> {
    const proyecto = this.d.proyecto();
    const t = this.pista_();
    const tipo = TIPOS.find((x) => x.id === this.v.tipo)!;
    if (!proyecto || !t || !tipo.instrumento || this.ocupada) return;
    this.ocupada = true;
    this.mensaje = "";
    this.pintar();
    const bpb = beatsPerBar(proyecto);
    const spb = segundosPorTiempo(proyecto.bpm);
    const nombre = `${t.name} (MIDI)`.slice(0, 60);
    const base = t.name.replace(/[^A-Za-z0-9._-]+/g, "_");
    try {
      let actual = proyecto;
      const id = `trk_amidi_${Date.now().toString(36)}`;
      actual = applyOps(actual, [{ op: "add_track", id, name: nombre, kind: "midi", instrument: tipo.instrumento }]).project;
      const informes: string[] = [];
      let total = 0;
      for (const [k, clip] of t.clips.filter((c) => c.audio).entries()) {
        const asset = (proyecto.audioAssets ?? []).find((a) => a.id === clip.audio!.assetId);
        if (!asset?.ruta) throw new Error(`the clip “${clip.name}” has no WAV in the project folder`);
        const res = await fetch("/api/transcribir", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(carpetaDeProyecto(proyecto)) },
          body: JSON.stringify({
            ruta: asset.ruta, desde: clip.audio!.offset * spb, duracion: clip.length * spb, bpm: proyecto.bpm, tipo: this.v.tipo,
            sensibilidad: this.v.sensibilidad, minimoMs: Number(this.v.minimo) || 128, rejilla: Number(this.v.rejilla) || 0,
            programa: tipo.instrumento.program ?? 0, nombre: `${base}-midi${t.clips.length > 1 ? `-${k + 1}` : ""}`,
          }),
        });
        const r = (await res.json()) as Resultado;
        if (!r.ok || !r.notas || !r.resumen) throw new Error(r.error ?? `HTTP ${res.status}`);
        const s = r.resumen;
        informes.push(`${r.mid}: ${s.notas} notes (${s.crudas} heard)${s.grave !== null ? `, ${nota(s.grave)}–${nota(s.agudo!)}` : ""}, ${s.por_segundo}/s, ${s.s} s`);
        if (r.notas.length === 0) continue;
        total += r.notas.length;
        // The notes are in beats from the clip's start; a clip need not start on a bar.
        const compas = Math.floor(clip.start / bpb);
        const desplaza = clip.start - compas * bpb;
        const notas = r.notas.map((n) => ({ ...n, start: n.start + desplaza }));
        let clipId: string | undefined;
        for (let i = 0; i < notas.length; i += 2000) {
          const trozo = notas.slice(i, i + 2000);
          const op: Op = i === 0 ? { op: "add_notes", trackId: id, startBar: compas, name: clip.name.slice(0, 60), notes: trozo } : { op: "add_notes", trackId: id, clipId, notes: trozo };
          actual = applyOps(actual, [op]).project;
          clipId = actual.tracks.find((x) => x.id === id)?.clips.at(-1)?.id;
        }
      }
      if (total === 0) {
        this.mensaje = `No notes were heard (${informes.join("; ")}). Try a higher sensitivity, or another kind.`;
        return;
      }
      this.d.aplicar(actual);
      this.d.avisos.info(`To MIDI “${nombre}” (${tipo.etiqueta}): ${informes.join("; ")}. Nobody has heard it yet.`);
      this.dialogo.close();
    } catch (error) {
      this.mensaje = `Could not transcribe: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.ocupada = false;
      if (this.dialogo.open) this.pintar();
    }
  }
}

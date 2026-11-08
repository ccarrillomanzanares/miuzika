/**
 * The Strudel module's window (8-Nov-2026, Carlos: "hay que añadir el módulo de strudel que estaba en la versión antigua de
 * miuzika"). A pattern is rendered to WAV in the browser with the real Strudel engine (motor.ts, the old strudel-audio.ts),
 * heard here, and only then added to the project as an audio track. No GPU and no cost: the first render downloads Strudel's
 * sample packs from its CDN.
 *
 * What changed from the old Code Lab: it is a module like the others (Modules menu, the host's entregarAudio); the render can
 * be heard before it is added; a silent render is not added; the patterns are kept per project folder in this browser.
 */

import { beatsPerBar } from "../../../../src/core/types.ts";
import { carpetaDeProyecto } from "../../../../src/core/project.ts";
import { nombreDeArchivo } from "../../../../src/modulos/ace-step/receta.ts";
import { subirAudio } from "../../proyecto-disco.ts";
import type { Anfitrion } from "../anfitrion.ts";
import { SILENCIO_DBFS, areaDeTexto, carpetaDestino, esc, fila, numero } from "../comun.ts";
import { renderStrudelAudio, type StrudelRenderizado } from "./motor.ts";

/** The old Code Lab's example, and a few more, all with the REPL's default sounds. */
const EJEMPLOS: { titulo: string; codigo: string }[] = [
  { titulo: "Drums and a saw bass (the old default)", codigo: 'stack(\n  s("bd ~ sd ~"),\n  note("c2 e2 g2").s("sawtooth").slow(2)\n)' },
  { titulo: "Four-on-the-floor kit", codigo: 's("bd*4, ~ sd ~ sd, hh*8").bank("RolandTR909")' },
  { titulo: "Industrial: distorted kick and acid line", codigo: '$: s("bd*4").bank("RolandTR909").distort(2)\n$: s("~ cp ~ cp").room(0.4)\n$: note("c2 c2 eb2 c2 g1 c2 bb1 c2").s("sawtooth").lpf(600).lpq(12).distort(1.5)' },
  { titulo: "Chords on piano", codigo: 'note("<[c3,eb3,g3] [f3,ab3,c4] [g3,b3,d4] [c3,eb3,g3]>").s("piano")' },
  { titulo: "Arpeggio with delay", codigo: 'note("c4 eb4 g4 bb4 g4 eb4".fast(2)).s("triangle").delay(0.5).delaytime(0.375).room(0.3)' },
];

const AYUDA =
  "1 cycle = 1 bar at the project's tempo. `$:` lines are played together, as in the Strudel REPL. Visual methods " +
  "(._pianoroll, ._scope…) are ignored. samples('url') loads a pack. Reference: strudel.cc/learn.";

interface Guardado {
  codigo: string;
  compases: number;
}

const CLAVE = "miuzika-strudel";

export class VentanaStrudel {
  private readonly dialogo: HTMLDialogElement;
  private readonly a: Anfitrion;
  private v: Record<string, string> = { nombre: "strudel", compases: "8", inicio: "1", bpm: "120", codigo: EJEMPLOS[0]!.codigo };
  private render: { r: StrudelRenderizado; url: string; codigo: string; compases: number; bpm: number } | null = null;
  private mensaje = "";
  private ocupada = false;

  constructor(anfitrion: Anfitrion) {
    this.a = anfitrion;
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho acestep";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (el.name && !(el instanceof HTMLSelectElement)) this.v[el.name] = el.value;
    });
    this.dialogo.addEventListener("change", (e) => this.alCambiar(e));
    this.dialogo.addEventListener("click", (e) => void this.alPulsar(e));
    this.dialogo.addEventListener("close", () => this.soltarRender());
  }

  async abrir(): Promise<void> {
    const p = this.a.proyecto();
    if (p) this.v.bpm = String(p.bpm);
    this.mensaje = "";
    this.pintar();
    this.dialogo.showModal();
  }

  // ---------------------------------------------------------------- patterns kept in this browser, per project folder

  private carpetaActual(): string {
    const p = this.a.proyecto();
    return p ? carpetaDeProyecto(p) : "";
  }

  private guardados(): Record<string, Guardado> {
    try {
      const todo = JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, Record<string, Guardado>>;
      return todo[this.carpetaActual()] ?? {};
    } catch {
      return {};
    }
  }

  private guardar(nombre: string, g: Guardado): void {
    try {
      const todo = JSON.parse(localStorage.getItem(CLAVE) ?? "{}") as Record<string, Record<string, Guardado>>;
      todo[this.carpetaActual()] = { ...(todo[this.carpetaActual()] ?? {}), [nombre]: g };
      localStorage.setItem(CLAVE, JSON.stringify(todo));
    } catch {
      // A full storage only loses the list; the WAV is on disk.
    }
  }

  // ---------------------------------------------------------------- painting

  private pintar(): void {
    const p = this.a.proyecto();
    const guardados = Object.keys(this.guardados());
    const opcion = (v: string, t: string): string => `<option value="${esc(v)}">${esc(t)}</option>`;
    const r = this.render;
    const segundos = (numero(this.v.compases) ?? 0) * (p ? beatsPerBar(p) : 4) * (60 / (numero(this.v.bpm) ?? 120));
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>Strudel → WAV</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Write a Strudel pattern; it is rendered to WAV here in the browser, with the real Strudel engine and its samples and effects. Listen to it, then add it as an audio track. No GPU, no cost. The first render downloads Strudel's sample packs (internet needed).</p>
      <div class="ace-cuerpo">
        ${fila("Name", `<input type="text" name="nombre" value="${esc(this.v.nombre ?? "")}" placeholder="the track and its WAV">`)}
        ${fila("Start from", `<select name="cargar">${opcion("", "— an example or a saved pattern —")}${EJEMPLOS.map((e, i) => opcion(`e${i}`, `Example: ${e.titulo}`)).join("")}${guardados.map((n) => opcion(`g${n}`, `Saved: ${n}`)).join("")}</select>`, guardados.length ? "Saved: the patterns added to this project from this browser." : "")}
        ${fila("Pattern", areaDeTexto('name="codigo" spellcheck="false" style="font-family: ui-monospace, monospace; font-size: 12px"', 12, this.v.codigo ?? ""), esc(AYUDA))}
        ${fila("Bars", `<input type="number" name="compases" min="1" max="64" step="1" value="${esc(this.v.compases ?? "8")}">`, `1 to 64. ${segundos > 0 ? `${segundos.toFixed(1)} s at ${p ? "the project's" : "this"} tempo.` : ""}`)}
        ${p ? fila("Tempo", `<code>${p.bpm} BPM</code>`, "The project's.") : fila("BPM", `<input type="number" name="bpm" value="${esc(this.v.bpm ?? "120")}" step="any">`, "No project is open: a new one is made with this tempo.")}
        ${fila("At bar", `<input type="number" name="inicio" min="1" step="1" value="${esc(this.v.inicio ?? "1")}">`, "Where the clip starts in the timeline.")}
      </div>
      ${r ? `<div class="ace-cuerpo">${fila("Rendered", `<audio controls src="${r.url}" style="width:100%"></audio>`, esc(`${r.r.durationSeconds.toFixed(1)} s, peak ${Number.isFinite(r.r.picoDb) ? r.r.picoDb.toFixed(1) : "-∞"} dBFS${r.r.picoDb > -0.1 ? " (at full scale: it may clip)" : ""}.${r.codigo !== (this.v.codigo ?? "") || r.compases !== numero(this.v.compases) ? " The pattern changed since: render again to add the new one." : ""}`))}</div>` : ""}
      ${r && r.r.warnings.length ? `<ul class="ace-nota">${r.r.warnings.slice(0, 8).map((w) => `<li>${esc(w)}</li>`).join("")}${r.r.warnings.length > 8 ? `<li>…and ${r.r.warnings.length - 8} more.</li>` : ""}</ul>` : ""}
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones">
        <button type="button" data-accion="renderizar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Working…" : r ? "Render again" : "Render"}</button>
        <button type="button" class="primario" data-accion="anadir"${!r || this.ocupada || this.cambiado() ? " disabled" : ""}>Add as a track</button>
      </div>`;
  }

  private cambiado(): boolean {
    const r = this.render;
    return !r || r.codigo !== (this.v.codigo ?? "") || r.compases !== numero(this.v.compases);
  }

  private soltarRender(): void {
    if (this.render) URL.revokeObjectURL(this.render.url);
    this.render = null;
  }

  // ---------------------------------------------------------------- events

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLSelectElement | HTMLInputElement;
    if (el.name === "cargar" && el.value) {
      if (el.value.startsWith("e")) {
        this.v.codigo = EJEMPLOS[Number(el.value.slice(1))]!.codigo;
      } else {
        const nombre = el.value.slice(1);
        const g = this.guardados()[nombre];
        if (g) {
          this.v.codigo = g.codigo;
          this.v.compases = String(g.compases);
          this.v.nombre = nombre;
        }
      }
      this.pintar();
    } else if (el.name === "compases" || el.name === "bpm" || el.name === "codigo") {
      // Not a repaint: it would stop the render that may be playing. Only Add follows the change.
      const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="anadir"]');
      if (boton) boton.disabled = this.ocupada || this.cambiado();
    }
  }

  private async alPulsar(evento: Event): Promise<void> {
    const accion = (evento.target as HTMLElement).closest<HTMLElement>("[data-accion]")?.dataset.accion;
    if (accion === "cerrar") this.dialogo.close();
    else if (accion === "renderizar") await this.renderizar();
    else if (accion === "anadir") await this.anadir();
  }

  private bpm(): number {
    return this.a.proyecto()?.bpm ?? numero(this.v.bpm) ?? 120;
  }

  private async renderizar(): Promise<void> {
    const compases = numero(this.v.compases);
    const codigo = this.v.codigo ?? "";
    this.mensaje = "";
    if (!(compases !== null && Number.isInteger(compases) && compases >= 1 && compases <= 64)) {
      this.mensaje = "Bars: a whole number from 1 to 64.";
      this.pintar();
      return;
    }
    if (!(this.bpm() >= 20 && this.bpm() <= 300)) {
      this.mensaje = "BPM: from 20 to 300.";
      this.pintar();
      return;
    }
    this.ocupada = true;
    this.pintar();
    try {
      const p = this.a.proyecto();
      const r = await renderStrudelAudio(codigo, compases, this.bpm(), p ? beatsPerBar(p) : 4);
      this.soltarRender();
      this.render = { r, url: URL.createObjectURL(r.blob), codigo, compases, bpm: this.bpm() };
      if (!(r.picoDb >= SILENCIO_DBFS)) this.mensaje = `The render is silent (peak ${Number.isFinite(r.picoDb) ? r.picoDb.toFixed(1) : "-∞"} dBFS): check the pattern and the sound names.`;
    } catch (error) {
      this.mensaje = `Strudel: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.ocupada = false;
      this.pintar();
    }
  }

  private async anadir(): Promise<void> {
    const r = this.render;
    if (!r || this.cambiado()) return;
    if (!(r.r.picoDb >= SILENCIO_DBFS)) {
      this.mensaje = "A silent render is not added.";
      this.pintar();
      return;
    }
    const nombre = nombreDeArchivo(this.v.nombre ?? "") || "strudel";
    const inicio = Math.max(1, Math.round(numero(this.v.inicio) ?? 1));
    this.ocupada = true;
    this.pintar();
    try {
      const carpeta = await carpetaDestino(this.a, nombre, "strudel");
      const { path } = await subirAudio(new File([r.r.blob], `${nombre}.wav`, { type: "audio/wav" }), carpeta);
      const hecha = await this.a.entregarAudio({
        carpeta,
        nombreProyecto: this.a.proyecto()?.name ?? nombre,
        bpm: r.bpm,
        tonalidad: "",
        inicioCompas: inicio,
        compases: r.compases,
        tomas: [{ ruta: path, nombre, silenciada: false }],
      });
      if (!hecha) return;
      this.guardar(nombre, { codigo: r.codigo, compases: r.compases });
      this.a.avisos.info(`Strudel “${nombre}”: ${r.r.durationSeconds.toFixed(1)} s (${r.compases} bars) added at bar ${inicio}, file ${path}.`);
      // Turning a loud render down is information, not a failure.
      for (const w of r.r.warnings.slice(0, 5)) (w.startsWith("It peaked") ? this.a.avisos.info : this.a.avisos.error).call(this.a.avisos, `Strudel “${nombre}”: ${w}`);
      this.dialogo.close();
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : String(error);
    } finally {
      this.ocupada = false;
      if (this.dialogo.open) this.pintar();
    }
  }
}

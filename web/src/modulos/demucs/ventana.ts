/**
 * The Demucs module's window (8-Nov-2026, the user: "adelante con demucs"): separates a mix (tracks of the project
 * or a file) into stems, each delivered as a track. Proposed on 7-Nov for drums, where ACE-Step's extract failed.
 */

import { DEMUCS_VERSION, MODELOS, leerResultado, parametrosParaEnviar, pistasDe, validarParametros, type Modelo, type Parametros } from "../../../../src/modulos/demucs/receta.ts";
import { nombreDeArchivo } from "../../../../src/modulos/ace-step/receta.ts";
import type { BarraGpu } from "../../gpu-barra.ts";
import type { Anfitrion } from "../anfitrion.ts";
import { causaDeFallo, iniciarEnGpu, esc, fila, numero, prepararAudio, seguirEnGpu } from "../comun.ts";

type Fuente = "pistas" | "archivo";

const COSTE =
  "Experimental: separation is never perfect, stems keep traces of the rest. Free software provided as is, without any warranty (AGPL-3.0; " +
  "Demucs is MIT). The GPU is rented with your account: it bills its time whether the result is useful or not, until you press Off. " +
  "A first run on a new machine also installs Demucs and downloads its model.";

export class VentanaDemucs {
  private readonly dialogo: HTMLDialogElement;
  private vista: "form" | "review" = "form";
  // htdemucs_ft by default since 8-Nov. The user, on the same cover: "mc-ghosts-ft es más limpio que stems" (htdemucs); 86 s, about the same.
  private v: Record<string, string> = { modelo: "htdemucs_ft", shifts: "1" };
  private fuente: Fuente = "archivo";
  private pistas = new Set<string>();
  private archivo: File | null = null;
  private preparado: { audio: string; descripcion: string; carpeta: string } | null = null;
  private mensaje = "";
  private ocupada = false;
  private enMarcha = false;
  private readonly a: Anfitrion;
  private readonly gpu: BarraGpu;

  constructor(anfitrion: Anfitrion, gpu: BarraGpu) {
    this.a = anfitrion;
    this.gpu = gpu;
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho acestep";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("input", (e) => this.alEscribir(e));
    this.dialogo.addEventListener("change", (e) => this.alCambiar(e));
    this.dialogo.addEventListener("click", (e) => void this.alPulsar(e));
  }

  async abrir(): Promise<void> {
    const p = this.a.proyecto();
    this.fuente = p && p.tracks.length > 0 ? this.fuente : "archivo";
    this.vista = "form";
    this.preparado = null;
    this.mensaje = "";
    await this.gpu.refrescar();
    this.pintar();
    this.dialogo.showModal();
  }

  private parametros(): Parametros {
    return { nombre: this.v.nombre ?? "", modelo: (this.v.modelo ?? "htdemucs_ft") as Modelo, audio: this.preparado?.audio ?? null, shifts: numero(this.v.shifts) ?? 1 };
  }

  private pintar(): void {
    this.dialogo.innerHTML = this.vista === "form" ? this.htmlFormulario() : this.htmlRevision();
  }

  private htmlFormulario(): string {
    const p = this.a.proyecto();
    const conPistas = !!p && p.tracks.length > 0;
    const opciones: [Fuente, string][] = [...(conPistas ? ([["pistas", "Tracks of this project"]] as [Fuente, string][]) : []), ["archivo", "A file"]];
    const radios = opciones.map(([v, t]) => `<label class="ace-opcion"><input type="radio" name="fuente" value="${v}"${v === this.fuente ? " checked" : ""}> ${t}</label>`).join("");
    const detalle =
      this.fuente === "pistas" && p
        ? fila("Tracks", `<div class="ace-lista">${p.tracks.map((t) => `<label class="ace-opcion"><input type="checkbox" data-pista="${esc(t.id)}"${this.pistas.has(t.id) ? " checked" : ""}> ${esc(t.name)}</label>`).join("")}</div>`, "Rendered whole, mixed into one WAV.")
        : fila("File", `<label class="file"><input type="file" data-archivo accept="audio/*,.wav,.mp3" hidden>${this.archivo ? "Change…" : "Choose a file…"}</label> ${this.archivo ? esc(this.archivo.name) : "none chosen"}`);
    const modelos = MODELOS.map((m) => `<option value="${m.nombre}"${m.nombre === this.v.modelo ? " selected" : ""}>${m.nombre} · ${m.pistas.length} stems</option>`).join("");
    const nota = MODELOS.find((m) => m.nombre === this.v.modelo)?.nota ?? "";
    return `
      <div class="dialogo-cabeza"><strong>Demucs</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Separates a mix into stems: drums, bass, vocals and the rest (six with htdemucs_6s). Each stem comes in as a muted track: unmute the ones you want.</p>
      <div class="ace-cuerpo">
        ${fila("Name", `<input type="text" name="nombre" value="${esc(this.v.nombre ?? "")}" placeholder="the stems' file prefix">`)}
        ${fila("Source", radios)}
        ${detalle}
        ${fila("Model", `<select name="modelo">${modelos}</select>`, esc(nota))}
        ${fila("Shifts", `<input type="number" name="shifts" value="${esc(this.v.shifts ?? "1")}" min="1" max="10">`, "Averaged passes: a little better, proportionally slower.")}
      </div>
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones"><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const motivo = validarParametros(p);
    return `
      <div class="dialogo-cabeza"><strong>Demucs · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <div class="ace-cuerpo">
        ${fila("name", `<code>${esc(p.nombre)}</code>`)}
        ${fila("source", `<code>${esc(this.preparado?.descripcion ?? "")}</code>`)}
        ${fila("model", `<code>${esc(p.modelo)}</code> → ${pistasDe(p.modelo).join(", ")}`)}
        ${fila("shifts", `<code>${p.shifts}</code>`)}
        ${fila("version", `<code>demucs ${DEMUCS_VERSION}</code>`)}
      </div>
      <p class="ace-aviso-coste"><strong>No warranty.</strong> ${esc(COSTE)}</p>
      <p class="ace-error">${esc(motivo ?? this.mensaje)}</p>
      <div class="dialogo-acciones">
        <button type="button" data-accion="volver">Back</button>
        <button type="button" class="primario" data-accion="lanzar"${motivo || this.enMarcha ? " disabled" : ""}>Run</button>
      </div>`;
  }

  private alEscribir(evento: Event): void {
    const el = evento.target as HTMLInputElement;
    if (!el.name || el.type === "radio" || el.type === "file") return;
    this.v[el.name] = el.value;
  }

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLInputElement;
    if (el.name === "fuente") {
      this.fuente = el.value as Fuente;
      this.pintar();
    } else if (el.name === "modelo") {
      this.v.modelo = el.value;
      this.pintar();
    } else if (el.dataset.pista) {
      if (el.checked) this.pistas.add(el.dataset.pista);
      else this.pistas.delete(el.dataset.pista);
    } else if (el.hasAttribute("data-archivo")) {
      this.archivo = el.files?.[0] ?? this.archivo;
      this.pintar();
    }
  }

  private async alPulsar(evento: Event): Promise<void> {
    const accion = (evento.target as HTMLElement).closest<HTMLElement>("[data-accion]")?.dataset.accion;
    if (accion === "cerrar") this.dialogo.close();
    else if (accion === "volver") {
      this.vista = "form";
      this.pintar();
    } else if (accion === "revisar") await this.revisar();
    else if (accion === "lanzar") await this.lanzar();
  }

  private async revisar(): Promise<void> {
    this.mensaje = "";
    this.ocupada = true;
    this.pintar();
    try {
      const base = this.fuente === "archivo" ? (this.archivo?.name.replace(/\.[^.]+$/, "") ?? "") : "pistas";
      this.v.nombre = nombreDeArchivo(this.v.nombre || `${base}-stems`) || "stems";
      this.preparado = await prepararAudio(this.a, { tipo: this.fuente, pistas: [...this.pistas], archivo: this.archivo, nombre: this.v.nombre, porDefecto: "demucs" });
      this.vista = "review";
    } catch (error) {
      this.mensaje = error instanceof Error ? error.message : String(error);
    } finally {
      this.ocupada = false;
      this.pintar();
    }
  }

  private async lanzar(): Promise<void> {
    const p = this.parametros();
    if (validarParametros(p) || this.enMarcha || !this.preparado) return;
    // Marked at once: a second click on Run while the server answers does nothing (a double click could pay two runs).
    this.enMarcha = true;
    this.mensaje = "";
    const carpeta = this.preparado.carpeta;
    const receta = { modulo: "demucs", parametros: parametrosParaEnviar(p), fuente: { descripcion: this.preparado.descripcion }, entrega: { inicioCompas: 1 } };
    const control = new AbortController();
    const etiqueta = `Demucs “${p.nombre}”`;
    // The window waits for the server's answer and closes only if it accepts: a refusal is said here, the form kept.
    let cuerpo: ReadableStream<Uint8Array>;
    try {
      cuerpo = await iniciarEnGpu({ script: "separar_demucs.py", nombre: p.nombre, receta, entradas: [p.audio!], carpeta, senal: control.signal });
    } catch (error) {
      this.enMarcha = false;
      this.mensaje = `The server did not start the run: ${error instanceof Error ? error.message : String(error)}`;
      this.pintar();
      return;
    }
    this.dialogo.close();
    this.vista = "form";
    this.preparado = null;
    this.v.nombre = "";
    this.gpu.fijarTarea(`${etiqueta}: starting…`, () => control.abort());
    try {
      const r = await seguirEnGpu(cuerpo, { etiqueta, gpu: this.gpu });
      const leido = leerResultado(r.salida);
      if (!r.ok || !leido) {
        this.a.avisos.error(`${etiqueta} failed: ${causaDeFallo(r)}`);
        return;
      }
      if (r.traida_fallo) {
        this.a.avisos.error(`${etiqueta} finished, but ${r.traida_fallo}. The files are on the instance until it is shut down.`);
        return;
      }
      // Muted: they add up to the source, which may still be playing in the project.
      const tomas = leido.ficheros.map((f) => ({ ruta: `generado/${f}`, nombre: f.replace(/\.wav$/i, ""), silenciada: true }));
      const nombreProyecto = this.a.proyecto()?.name ?? p.nombre;
      const hecha = await this.a.entregarAudio({ carpeta, nombreProyecto, bpm: null, tonalidad: "", inicioCompas: 1, tomas });
      if (!hecha) return;
      this.a.avisos.info(`${etiqueta}: ${tomas.map((t) => t.nombre).join(", ")} in, muted. Separation ${leido.separate_s ?? "?"} s, whole run ${Math.round(r.ms / 1000)} s. Nobody has heard them yet.`);
    } catch (error) {
      if (control.signal.aborted) this.a.avisos.info(`${etiqueta} cancelled: no track was added. The GPU stays on until you press Off.`);
      else this.a.avisos.error(`${etiqueta}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.enMarcha = false;
      this.gpu.fijarTarea(null);
      await this.gpu.refrescar();
    }
  }
}

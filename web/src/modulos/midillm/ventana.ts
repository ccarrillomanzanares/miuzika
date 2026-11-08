/**
 * The MIDI-LLM module's window (8-Nov-2026, Carlos: "vamos primero con proponer_midi", named MIDI-LLM). A description becomes
 * multitrack MIDI on the GPU; each proposal comes in as MIDI tracks, one per instrument, with notes to edit in the piano roll.
 * Review shows the prompt exactly as it travels, the licence and the cost before anything is spent.
 */

import {
  EJEMPLOS, LICENCIA, MIDILLM_COMMIT, POR_DEFECTO, TEMPOS, componerPrompt, leerResultado, parametrosParaEnviar, validarParametros,
  type Parametros, type Tempo,
} from "../../../../src/modulos/midillm/receta.ts";
import { nombreDeArchivo } from "../../../../src/modulos/ace-step/receta.ts";
import { carpetaDeProyecto } from "../../../../src/core/project.ts";
import type { BarraGpu } from "../../gpu-barra.ts";
import type { Anfitrion } from "../anfitrion.ts";
import { areaDeTexto, causaDeFallo, ejecutarEnGpu, esc, fila, numero } from "../comun.ts";

const COSTE =
  "Experimental: results vary from proposal to proposal. Free software provided as is, without any warranty (AGPL-3.0). The GPU is " +
  "rented with your account: it bills its time whether the proposals are useful or not, failed and cancelled runs included, until you " +
  "press Off. A first run on a new machine also installs MIDI-LLM (torch and its packages) and downloads its weights (~2.5 GB).";

/** proponer_midi on 2-Nov, A10: 4 proposals in 38 s, model loading included. */
const AYUDA_TIEMPO = "On an A10, four proposals took about 40 s, plus the machine's boot if it is off and the install on a new machine.";

const COMPASES = ["", "4/4", "3/4", "6/8", "2/4", "5/4", "7/8", "12/8"];

export class VentanaMidiLlm {
  private readonly dialogo: HTMLDialogElement;
  private vista: "form" | "review" = "form";
  private v: Record<string, string> = {
    nombre: "", descripcion: "", instrumentos: "", tonalidad: "", compas: "4/4", tempo: "", acordes: "",
    propuestas: String(POR_DEFECTO.propuestas), inicio: "1", bpm: "120",
    temperatura: String(POR_DEFECTO.temperatura), top_p: String(POR_DEFECTO.top_p), max_tokens: String(POR_DEFECTO.max_tokens), semilla: "",
  };
  private avanzado = false;
  private carpeta = "";
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
    this.dialogo.addEventListener("toggle", (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLDetailsElement && el.dataset.avanzado !== undefined) this.avanzado = el.open;
    }, true);
  }

  async abrir(): Promise<void> {
    const p = this.a.proyecto();
    if (p) {
      this.v.bpm = String(p.bpm);
      // An empty project's key and metre are only defaults (D minor): they are offered once it has tracks.
      if (p.tracks.length > 0 && !this.v.tonalidad) this.v.tonalidad = `${p.key.tonic} ${p.key.mode}`;
      if (p.tracks.length > 0) this.v.compas = `${p.timeSignature.numerator}/${p.timeSignature.denominator}`;
    }
    this.vista = "form";
    this.mensaje = "";
    await this.gpu.refrescar();
    this.pintar();
    this.dialogo.showModal();
  }

  private bpm(): number | null {
    return this.a.proyecto()?.bpm ?? numero(this.v.bpm);
  }

  private parametros(): Parametros {
    return {
      nombre: this.v.nombre ?? "",
      prompt: this.v.prompt ?? this.promptCompuesto(),
      propuestas: numero(this.v.propuestas) ?? POR_DEFECTO.propuestas,
      temperatura: numero(this.v.temperatura) ?? POR_DEFECTO.temperatura,
      top_p: numero(this.v.top_p) ?? POR_DEFECTO.top_p,
      max_tokens: numero(this.v.max_tokens) ?? POR_DEFECTO.max_tokens,
      semilla: numero(this.v.semilla) ?? -1,
      bpm: this.bpm(),
    };
  }

  private promptCompuesto(): string {
    return componerPrompt({
      texto: this.v.descripcion ?? "", instrumentos: this.v.instrumentos ?? "", tonalidad: this.v.tonalidad ?? "",
      compas: this.v.compas ?? "", tempo: (this.v.tempo ?? "") as Tempo, acordes: this.v.acordes ?? "",
    });
  }

  // ---------------------------------------------------------------- painting

  private pintar(): void {
    this.dialogo.innerHTML = this.vista === "form" ? this.htmlFormulario() : this.htmlRevision();
  }

  private campo(nombre: string, placeholder = "", tipo = "text"): string {
    return `<input type="${tipo}" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" placeholder="${esc(placeholder)}" step="any">`;
  }

  private selector(nombre: string, opciones: [string, string][]): string {
    return `<select name="${nombre}">${opciones.map(([v, t]) => `<option value="${esc(v)}"${v === (this.v[nombre] ?? "") ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>`;
  }

  private htmlFormulario(): string {
    const p = this.a.proyecto();
    const ejemplos: [string, string][] = [["", "— start from one of its README's prompts —"], ...EJEMPLOS.map((e, i): [string, string] => [String(i), e.titulo])];
    const tokens = numero(this.v.max_tokens) ?? POR_DEFECTO.max_tokens;
    return `
      <div class="dialogo-cabeza"><strong>MIDI-LLM</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Multitrack MIDI from a description: each proposal comes in as MIDI tracks, one per instrument, with notes you can edit in the piano roll. The instruments are General MIDI. Built with Llama.</p>
      <div class="ace-cuerpo">
        ${fila("Name", this.campo("nombre", "the proposals' file and tracks"))}
        ${fila("Example", this.selector("ejemplo", ejemplos), "Fills the description; change it as you like.")}
        ${fila("Description", areaDeTexto('name="descripcion"', 4, this.v.descripcion ?? ""), "Genre, mood, what it is for. It was trained on captions like its examples; free prompts work too. English.")}
        ${fila("Instruments", this.campo("instrumentos", "e.g. synth bass, drums, string ensemble"), "General MIDI names work best: piano, distortion guitar, synth strings, church organ, French horn, drums…")}
        ${fila("Key", this.campo("tonalidad", "e.g. D minor"), p ? "The project's, if it has one." : "")}
        ${fila("Time signature", this.selector("compas", COMPASES.map((c): [string, string] => [c, c || "—"])))}
        ${fila("Tempo", this.selector("tempo", TEMPOS.map((t): [string, string] => [t.id, t.etiqueta])), "In words, as its captions say it: the model has no BPM control.")}
        ${fila("Chords", this.campo("acordes", "e.g. Dm, Bb, F, C"), "A progression to follow, comma-separated.")}
        ${p ? fila("BPM", `<code>${p.bpm}</code>`, "The project's: stamped on each MIDI so the notes land on the grid.") : fila("BPM", this.campo("bpm", "120", "number"), "Stamped on each MIDI; a new project is made with it.")}
        ${fila("Proposals", this.campo("propuestas", "4", "number"), "1 to 8 in one run (4 is its default). The first comes in sounding, the rest muted.")}
        ${fila("At bar", this.campo("inicio", "1", "number"), "Where the notes start in the timeline.")}
      </div>
      <details class="ace-avanzado" data-avanzado${this.avanzado ? " open" : ""}>
        <summary>Advanced</summary>
        <div class="ace-cuerpo">
          ${fila("Length", `${this.campo("max_tokens", String(POR_DEFECTO.max_tokens), "number")} tokens`, `3 per note: ~${Math.floor(tokens / 3)} notes across all instruments. 2046 is its default and the maximum here.`)}
          ${fila("Temperature", this.campo("temperatura", "1.0", "number"), "1.0 is its default; lower is safer and more repetitive, higher more adventurous.")}
          ${fila("Top-p", this.campo("top_p", "0.98", "number"), "0.98 is its default.")}
          ${fila("Seed", this.campo("semilla", "random", "number"), "The same seed and settings give the same proposals.")}
        </div>
      </details>
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones"><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const motivo = validarParametros(p);
    const n = (nombre: string): string => `<input type="number" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" step="any">`;
    return `
      <div class="dialogo-cabeza"><strong>MIDI-LLM · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">This is exactly what will be sent. Anything you change here is what the model receives.</p>
      <div class="ace-cuerpo">
        ${fila("name", `<code>${esc(p.nombre)}</code>`, p.propuestas > 1 ? `files ${esc(p.nombre)}-1.mid … ${esc(p.nombre)}-${p.propuestas}.mid in generado/` : `file ${esc(p.nombre)}.mid in generado/`)}
        ${fila("prompt", areaDeTexto('name="prompt"', 5, p.prompt), "MIDI-LLM puts its own line before it: “You are a world-class composer. Please compose some music according to the following description:”.")}
        ${fila("proposals", n("propuestas"))}
        ${fila("BPM stamped", `<code>${p.bpm ?? "none (120)"}</code>`)}
        ${fila("at bar", `<code>${esc(this.v.inicio ?? "1")}</code>`)}
        ${fila("length", `${n("max_tokens")}`, "tokens, 3 per note")}
        ${fila("temperature", n("temperatura"))}
        ${fila("top-p", n("top_p"))}
        ${fila("seed", n("semilla"), "empty or -1 = random; the one used is recorded")}
        ${fila("version", `<code>MIDI-LLM ${MIDILLM_COMMIT}</code> · <code>slseanwu/MIDI-LLM_Llama-3.2-1B</code>`)}
      </div>
      <p class="ace-aviso-coste"><strong>Licence.</strong> ${esc(LICENCIA)}</p>
      <p class="ace-aviso-coste"><strong>No warranty.</strong> ${esc(COSTE)}</p>
      <p class="ace-nota">${esc(AYUDA_TIEMPO)}</p>
      <p class="ace-error">${esc(motivo ?? this.mensaje)}</p>
      <div class="dialogo-acciones">
        <button type="button" data-accion="volver">Back</button>
        <button type="button" class="primario" data-accion="lanzar"${motivo || this.enMarcha ? " disabled" : ""}>Run</button>
      </div>`;
  }

  // ---------------------------------------------------------------- events

  private alEscribir(evento: Event): void {
    const el = evento.target as HTMLInputElement | HTMLTextAreaElement;
    if (!el.name || el instanceof HTMLSelectElement) return;
    this.v[el.name] = el.value;
    if (this.vista === "review") {
      const motivo = validarParametros(this.parametros());
      const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
      if (boton) boton.disabled = !!motivo || this.enMarcha;
      const error = this.dialogo.querySelector<HTMLElement>(".ace-error");
      if (error) error.textContent = motivo ?? "";
    }
  }

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLSelectElement | HTMLInputElement;
    if (el.name === "ejemplo") {
      const e = EJEMPLOS[Number(el.value)];
      if (el.value !== "" && e) {
        // The in-domain examples already carry key, metre, tempo and chords: the separate fields are cleared.
        this.v.descripcion = e.texto;
        for (const k of ["instrumentos", "tonalidad", "tempo", "acordes"]) this.v[k] = "";
        this.v.compas = "";
      }
      this.pintar();
    } else if (el instanceof HTMLSelectElement && el.name) {
      this.v[el.name] = el.value;
    }
  }

  private async alPulsar(evento: Event): Promise<void> {
    const accion = (evento.target as HTMLElement).closest<HTMLElement>("[data-accion]")?.dataset.accion;
    if (accion === "cerrar") this.dialogo.close();
    else if (accion === "volver") {
      delete this.v.prompt;
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
      this.v.nombre = nombreDeArchivo(this.v.nombre || (this.v.descripcion ?? "").slice(0, 24)) || "midi-llm";
      const p = this.a.proyecto();
      this.carpeta = p ? carpetaDeProyecto(p) : await this.a.carpetaParaNuevo(this.v.nombre);
      this.v.prompt = this.promptCompuesto();
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
    if (validarParametros(p) || this.enMarcha) return;
    const proyecto = this.a.proyecto();
    const carpeta = proyecto ? carpetaDeProyecto(proyecto) : this.carpeta || (await this.a.carpetaParaNuevo(p.nombre));
    const inicio = Math.max(1, Math.round(numero(this.v.inicio) ?? 1));
    const receta = { modulo: "midillm", parametros: parametrosParaEnviar(p), fuente: { descripcion: "" }, entrega: { inicioCompas: inicio } };
    const control = new AbortController();
    const etiqueta = `MIDI-LLM “${p.nombre}”`;
    this.enMarcha = true;
    this.dialogo.close();
    this.vista = "form";
    delete this.v.prompt;
    this.v.nombre = "";
    this.gpu.fijarTarea(`${etiqueta}: starting…`, () => control.abort());
    try {
      const r = await ejecutarEnGpu({ script: "generar_midillm.py", nombre: p.nombre, receta, entradas: [], carpeta, etiqueta, gpu: this.gpu, senal: control.signal });
      const leido = leerResultado(r.salida);
      if (!r.ok || !leido) {
        this.a.avisos.error(`${etiqueta} failed: ${causaDeFallo(r)}`);
        return;
      }
      if (r.traida_fallo) {
        this.a.avisos.error(`${etiqueta} finished, but ${r.traida_fallo}. The files are on the instance until it is shut down.`);
        return;
      }
      const hechas = await this.a.entregarMidi({
        carpeta, rutas: leido.ficheros.map((f) => `generado/${f}`), inicioCompas: inicio, porPropuesta: true,
        nombreProyecto: this.a.proyecto()?.name ?? p.nombre, bpm: p.bpm,
      });
      if (hechas.length === 0) return;
      const detalle = leido.detalle.map((d) => `${d.file.replace(/\.mid$/, "")} ${d.tracks} tracks, ${d.notes} notes, ${d.seconds} s`).join("; ");
      this.a.avisos.info(
        `${etiqueta}: ${detalle}. ${leido.descartadas ? `${leido.descartadas} dropped by its own check (too many notes at once). ` : ""}` +
          `Seed ${leido.semilla ?? "?"}. Generation ${leido.generate_s ?? "?"} s, whole run ${Math.round(r.ms / 1000)} s. Recipe: generado/${p.nombre}.lineage.json. Nobody has heard it yet.`,
      );
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

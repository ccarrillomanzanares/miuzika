/**
 * The MuLaCover module's window (8-Nov-2026, the user: "adelante con mulacover"). A cover from an audio source (tracks
 * of the project or a file) or from his own melody/chord MIDI, with new lyrics and a style. Review shows exactly
 * what the script reads, the licence (non-commercial) and the cost notice, before anything is spent.
 */

import { ESTILO_EJEMPLO, LETRA_EJEMPLO, LICENCIA, MULACOVER_COMMIT, POR_DEFECTO, entradasDe, leerResultado, parametrosParaEnviar, validarParametros, type Parametros } from "../../../../src/modulos/mulacover/receta.ts";
import { nombreDeArchivo } from "../../../../src/modulos/ace-step/receta.ts";
import type { BarraGpu } from "../../gpu-barra.ts";
import type { Anfitrion } from "../anfitrion.ts";
import { areaDeTexto, causaDeFallo, ejecutarEnGpu, esc, fila, numero, prepararAudio, subirMidi, ComprobadorNombre, nombreTomado } from "../comun.ts";

type Fuente = "pistas" | "archivo" | "midi";
type Midi = "melodia" | "acordes" | "bateria";

/** Cost and warranty, like ACE-Step's: what a rented GPU means, said before Run. */
const COSTE =
  "Experimental: the result varies from take to take and may not be usable. This is free software provided as is, without any warranty " +
  "(AGPL-3.0). The GPU is rented with your account: it bills its time whether the take is useful or not, failed and cancelled runs included, " +
  "until you press Off. A first run on a new machine also installs MuLaCover and downloads ~16 GB of models.";

/** Measured 8-Nov on an A10: a 3 min 16 s cover took 397 s; the first try was cut at 320 s while still generating. */
const AYUDA_TIEMPO = "On an A10 a 3-minute song took about 7 minutes, plus the machine's boot if it is off.";

export class VentanaMulaCover {
  private readonly dialogo: HTMLDialogElement;
  private vista: "form" | "review" = "form";
  private v: Record<string, string> = { letra: "", estilo: ESTILO_EJEMPLO, semilla: "", temperatura: String(POR_DEFECTO.temperatura), topk: String(POR_DEFECTO.topk), cfg: String(POR_DEFECTO.cfg) };
  private fuente: Fuente = "archivo";
  private pistas = new Set<string>();
  private archivo: File | null = null;
  private midis: Record<Midi, File | null> = { melodia: null, acordes: null, bateria: null };
  /** Ready on Review: what travels. */
  private preparado: { audio: string | null; midis: Partial<Record<Midi, string>>; descripcion: string; carpeta: string } | null = null;
  private mensaje = "";
  private ocupada = false;
  private enMarcha = false;
  private readonly a: Anfitrion;
  private nombre!: ComprobadorNombre;
  private readonly gpu: BarraGpu;

  constructor(anfitrion: Anfitrion, gpu: BarraGpu) {
    this.a = anfitrion;
    this.nombre = new ComprobadorNombre(anfitrion, () => {
      if (this.vista === "review") this.pintar();
    });
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
    if (!p || p.tracks.length === 0) this.fuente = this.fuente === "pistas" ? "archivo" : this.fuente;
    this.vista = "form";
    this.preparado = null;
    this.mensaje = "";
    await this.gpu.refrescar();
    this.pintar();
    this.dialogo.showModal();
  }

  private parametros(): Parametros {
    const tipo = this.fuente === "midi" ? "midi" : "audio";
    return {
      nombre: this.v.nombre ?? "",
      tipo,
      audio: tipo === "audio" ? (this.preparado?.audio ?? null) : null,
      bpm: tipo === "audio" ? numero(this.v.bpm) : null,
      melodia: tipo === "midi" ? (this.preparado?.midis.melodia ?? null) : null,
      acordes: tipo === "midi" ? (this.preparado?.midis.acordes ?? null) : null,
      bateria: tipo === "midi" ? (this.preparado?.midis.bateria ?? null) : null,
      letra: this.v.letra ?? "",
      estilo: this.v.estilo ?? "",
      semilla: numero(this.v.semilla) ?? -1,
      temperatura: numero(this.v.temperatura) ?? POR_DEFECTO.temperatura,
      topk: numero(this.v.topk) ?? POR_DEFECTO.topk,
      cfg: numero(this.v.cfg) ?? POR_DEFECTO.cfg,
    };
  }

  // ---------------------------------------------------------------- painting

  /** A taken take name, said on Review (asked to the server once per name). */
  private motivoNombre(nombre: string): string | null {
    this.nombre.revisar(nombre);
    return this.nombre.motivo;
  }

  private pintar(): void {
    this.dialogo.innerHTML = this.vista === "form" ? this.htmlFormulario() : this.htmlRevision();
  }

  private campo(nombre: string, placeholder = "", tipo = "text"): string {
    return `<input type="${tipo}" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" placeholder="${esc(placeholder)}" step="any">`;
  }

  private htmlFuente(): string {
    const p = this.a.proyecto();
    const conPistas = !!p && p.tracks.length > 0;
    const opciones: [Fuente, string][] = [...(conPistas ? ([["pistas", "Tracks of this project"]] as [Fuente, string][]) : []), ["archivo", "A file"], ["midi", "My MIDI (melody + chords)"]];
    const radios = opciones.map(([v, t]) => `<label class="ace-opcion"><input type="radio" name="fuente" value="${v}"${v === this.fuente ? " checked" : ""}> ${t}</label>`).join("");
    let detalle = "";
    if (this.fuente === "pistas" && p) {
      detalle = fila("Tracks", `<div class="ace-lista">${p.tracks
        .map((t) => `<label class="ace-opcion"><input type="checkbox" data-pista="${esc(t.id)}"${this.pistas.has(t.id) ? " checked" : ""}> ${esc(t.name)}${t.muted ? " <small>(muted)</small>" : ""}</label>`)
        .join("")}</div>`, "Rendered whole, mixed into one WAV.");
    } else if (this.fuente === "archivo") {
      detalle = fila("File", `<label class="file"><input type="file" data-archivo accept="audio/*,.wav,.mp3" hidden>${this.archivo ? "Change…" : "Choose a file…"}</label> ${this.archivo ? esc(this.archivo.name) : "none chosen"}`, "MuLaCover transcribes its melody, chords and drums to MIDI and builds the cover on them. The MIDI come back too.");
    } else if (this.fuente === "midi") {
      const selector = (clave: Midi, etiqueta: string): string =>
        fila(etiqueta, `<label class="file"><input type="file" data-midi="${clave}" accept=".mid,.midi,audio/midi" hidden>${this.midis[clave] ? "Change…" : "Choose…"}</label> ${this.midis[clave] ? esc(this.midis[clave]!.name) : "none chosen"}`);
      detalle = selector("melodia", "Melody .mid") + selector("acordes", "Chords .mid") + selector("bateria", "Drums .mid (optional)");
    }
    return fila("Source", radios) + detalle;
  }

  private htmlFormulario(): string {
    const audio = this.fuente !== "midi";
    return `
      <div class="dialogo-cabeza"><strong>MuLaCover</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">A cover with your lyrics and style, over the melody and chords of a song (audio) or of your own MIDI. Heard: it follows the melody and sings the lyrics; the voice comes out conventional, closer to pop than the style asked. <strong>Non-commercial use only</strong> (CC BY-NC 4.0).</p>
      <div class="ace-cuerpo">
        ${fila("Name", this.campo("nombre", "the take's file and track"))}
        ${this.htmlFuente()}
        ${audio ? fila("BPM", this.campo("bpm", "empty = estimated", "number"), "Only with an audio source; a MIDI carries its own tempo.") : ""}
        ${fila("Lyrics", areaDeTexto('name="letra"', 8, this.v.letra ?? ""), `Section markers on their own lines, a blank line between sections, e.g.<br><code>${esc(LETRA_EJEMPLO).replace(/\n/g, "<br>")}</code>`)}
        ${fila("Style", this.campo("estilo", ESTILO_EJEMPLO), "One line of named fields: topic, genre, instrument, mood.")}
        ${fila("Seed", this.campo("semilla", "random", "number"))}
      </div>
      <p class="ace-error">${esc(this.mensaje)}</p>
      <div class="dialogo-acciones"><button type="button" class="primario" data-accion="revisar"${this.ocupada ? " disabled" : ""}>${this.ocupada ? "Preparing…" : "Review…"}</button></div>`;
  }

  private htmlRevision(): string {
    const p = this.parametros();
    const motivo = validarParametros(p) ?? this.motivoNombre(p.nombre);
    const n = (nombre: string): string => `<input type="number" name="${nombre}" value="${esc(this.v[nombre] ?? "")}" step="any">`;
    return `
      <div class="dialogo-cabeza"><strong>MuLaCover · Review before running</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">This is exactly what will be sent. Anything you change here is what the model receives.</p>
      <div class="ace-cuerpo">
        ${fila("name", `<code>${esc(p.nombre)}</code>`)}
        ${fila("source", `<code>${esc(this.preparado?.descripcion ?? "")}</code>`)}
        ${p.tipo === "audio" ? fila("bpm", n("bpm"), "empty = estimated by MuLaCover") : ""}
        ${fila("lyrics", areaDeTexto('name="letra"', 6, p.letra))}
        ${fila("style", `<input type="text" name="estilo" value="${esc(p.estilo)}">`)}
        ${fila("seed", n("semilla"), "empty or -1 = random; the one used is recorded")}
        ${fila("temperature", n("temperatura"))}
        ${fila("top-k", n("topk"))}
        ${fila("cfg scale", n("cfg"))}
        ${fila("version", `<code>MuLaCover ${MULACOVER_COMMIT}</code>`)}
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
    if (!el.name || el.type === "radio" || el.type === "file") return;
    this.v[el.name] = el.value;
    // Review's Run follows the edits without repainting (that would take the focus).
    if (this.vista === "review") {
      const motivo = validarParametros(this.parametros()) ?? this.motivoNombre(this.parametros().nombre);
      const boton = this.dialogo.querySelector<HTMLButtonElement>('[data-accion="lanzar"]');
      if (boton) boton.disabled = !!motivo || this.enMarcha;
      const error = this.dialogo.querySelector<HTMLElement>(".ace-error");
      if (error) error.textContent = motivo ?? "";
    }
  }

  private alCambiar(evento: Event): void {
    const el = evento.target as HTMLInputElement;
    if (el.name === "fuente") {
      this.fuente = el.value as Fuente;
      this.pintar();
    } else if (el.dataset.pista) {
      if (el.checked) this.pistas.add(el.dataset.pista);
      else this.pistas.delete(el.dataset.pista);
    } else if (el.hasAttribute("data-archivo")) {
      this.archivo = el.files?.[0] ?? this.archivo;
      this.pintar();
    } else if (el.dataset.midi) {
      this.midis[el.dataset.midi as Midi] = el.files?.[0] ?? this.midis[el.dataset.midi as Midi];
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

  /** The files go up here, before Review, so Review shows what will travel. */
  private async revisar(): Promise<void> {
    this.mensaje = "";
    this.ocupada = true;
    this.pintar();
    try {
      if (!this.v.nombre) this.v.nombre = nombreDeArchivo(this.archivo?.name.replace(/\.[^.]+$/, "") ?? "") || "cover";
      this.v.nombre = nombreDeArchivo(this.v.nombre);
      const nombre = this.v.nombre;
      if (this.fuente === "midi") {
        if (!this.midis.melodia || !this.midis.acordes) throw new Error("Choose the melody and the chords .mid.");
        const midis: Partial<Record<Midi, string>> = {};
        let carpeta = "";
        for (const clave of ["melodia", "acordes", "bateria"] as const) {
          const f = this.midis[clave];
          if (!f) continue;
          const r = await subirMidi(this.a, f, nombre, "mulacover");
          midis[clave] = r.ruta;
          carpeta = r.carpeta;
        }
        const descripcion = (["melodia", "acordes", "bateria"] as const).filter((k) => this.midis[k]).map((k) => this.midis[k]!.name).join(" + ");
        this.preparado = { audio: null, midis, descripcion, carpeta };
      } else {
        const r = await prepararAudio(this.a, { tipo: this.fuente, pistas: [...this.pistas], archivo: this.archivo, nombre, porDefecto: "mulacover" });
        this.preparado = { audio: r.audio, midis: {}, descripcion: r.descripcion, carpeta: r.carpeta };
      }
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
    // Asked again here: a take may have been made since Review opened. Said on Review, the form kept.
    const tomado = await nombreTomado(this.a, p.nombre);
    if (tomado) {
      this.nombre.fijar(p.nombre, tomado);
      this.pintar();
      return;
    }
    this.nombre.olvidar();
    const carpeta = this.preparado.carpeta;
    const receta = { modulo: "mulacover", parametros: parametrosParaEnviar(p), fuente: { descripcion: this.preparado.descripcion }, entrega: { inicioCompas: 1 } };
    const control = new AbortController();
    const etiqueta = `MuLaCover “${p.nombre}”`;
    this.enMarcha = true;
    this.dialogo.close();
    // The form stays for the next idea; the name does not, because a take is never overwritten.
    this.vista = "form";
    this.preparado = null;
    this.v.nombre = "";
    this.a.avisos.info(`${etiqueta}: ${p.tipo === "audio" ? "from audio" : "from MIDI"}, non-commercial licence (CC BY-NC 4.0).`);
    this.gpu.fijarTarea(`${etiqueta}: starting…`, () => control.abort());
    try {
      const r = await ejecutarEnGpu({ script: "generar_mulacover.py", nombre: p.nombre, receta, entradas: entradasDe(p), carpeta, etiqueta, gpu: this.gpu, senal: control.signal });
      const leido = leerResultado(r.salida);
      if (!r.ok || !leido) {
        this.a.avisos.error(`${etiqueta} failed: ${causaDeFallo(r)}`);
        return;
      }
      if (r.traida_fallo) {
        this.a.avisos.error(`${etiqueta} finished, but ${r.traida_fallo}. The files are on the instance until it is shut down.`);
        return;
      }
      const nombreProyecto = this.a.proyecto()?.name ?? p.nombre;
      const hecha = await this.a.entregarAudio({
        carpeta, nombreProyecto, bpm: p.bpm, tonalidad: "", inicioCompas: 1,
        tomas: [{ ruta: `generado/${leido.wav}`, nombre: leido.wav.replace(/\.wav$/i, ""), silenciada: false }],
      });
      if (!hecha) return;
      const midis = leido.midi.length > 0 ? await this.a.entregarMidi({ carpeta, rutas: leido.midi.map((m) => `generado/${m}`) }) : [];
      this.a.avisos.info(
        `${etiqueta} in. Seed ${leido.semilla ?? "?"}. Generation ${leido.generate_s ?? "?"} s, whole run ${Math.round(r.ms / 1000)} s.` +
          (midis.length > 0 ? ` Transcribed MIDI: ${midis.join(", ")}.` : "") +
          ` Recipe: generado/${p.nombre}.lineage.json. Non-commercial use only. Nobody has heard it yet.`,
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

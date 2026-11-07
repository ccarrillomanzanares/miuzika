/**
 * The open project: its state, undo history and autosave to disk.
 * The only owner of `project`; everything else reads it from here and changes it through
 * `setProject` (restarts the engine) or `commitLive` (does not).
 */

import type { Project } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { rutaDeProyecto, serializarProyecto } from "../../src/core/proyecto-archivo.ts";
import { audioAssets, hidratarAssets } from "./audio-store.ts";
import { guardarProyectoEnDisco } from "./proyecto-disco.ts";
import { locale } from "./i18n.ts";
import type { Avisos } from "./avisos.ts";

const HISTORY_LIMIT = 60;
/** Writing on every drag would be a POST per movement; 1.5 s after the last change is invisible. */
const RETARDO_GUARDADO = 1500;
/** The only thing left in the browser: which project is open. */
const CLAVE_ABIERTO = "miuzika-new.proyecto-abierto";

export interface EventosSesion {
  /** The project was replaced: the engine has to stop and the view repaint. */
  alAplicar(next: Project | null): void;
  /** A live change (mute, clip moved): the engine keeps running. */
  alEnVivo(next: Project, estructura: boolean): void;
  /** Something the buttons depend on changed. */
  alCambiarEstado(): void;
  estado(texto: string): void;
  avisarFaltan(faltan: string[]): void;
}

export class Sesion {
  project: Project | null = null;
  busy = false;
  ready = false;
  restoring = false;
  private history: Project[] = [];
  private future: Project[] = [];
  private guardadoTimer: number | null = null;
  private guardando = false;
  private guardadoPendiente = false;
  private persistenciaAvisada = false;
  private readonly avisos: Avisos;
  private readonly ev: EventosSesion;

  constructor(avisos: Avisos, ev: EventosSesion) {
    this.avisos = avisos;
    this.ev = ev;
  }

  get puedeDeshacer(): boolean {
    return this.history.length > 0;
  }

  get puedeRehacer(): boolean {
    return this.future.length > 0;
  }

  setBusy(value: boolean, text = ""): void {
    this.busy = value;
    this.ev.estado(text);
    this.ev.alCambiarEstado();
  }

  setProject(next: Project | null, record = true): void {
    // The history belongs to ONE project: undo must never resurrect another project
    // inside the current one's folder.
    if (!this.project || !next || carpetaDeProyecto(this.project) !== carpetaDeProyecto(next)) {
      // Before `project` changes: the pending write looks at it when it fires. Reproduced 6-Nov:
      // mute + New within 1.5 s left the file unmuted.
      this.volcarPendiente();
      this.history = [];
      this.future = [];
      record = false;
    }
    if (record && this.project) this.recordHistory();
    this.aplicar(next);
    this.ev.alCambiarEstado();
  }

  /** `estructura`: clips moved, copied or deleted, which the running engine does not pick up. */
  commitLive(next: Project, estructura = false): void {
    if (!this.project) return;
    this.recordHistory();
    this.project = next;
    this.persist();
    this.ev.alEnVivo(next, estructura);
    this.ev.alCambiarEstado();
  }

  async undo(): Promise<void> {
    await this.viajar(this.history, this.future);
  }

  async redo(): Promise<void> {
    await this.viajar(this.future, this.history);
  }

  private async viajar(desde: Project[], hacia: Project[]): Promise<void> {
    if (!this.ready || this.restoring || this.busy) return;
    const destino = desde.pop();
    if (!destino) return;
    if (this.project) {
      hacia.push(this.project);
      if (hacia.length > HISTORY_LIMIT) hacia.shift();
    }
    this.restoring = true;
    this.setBusy(true, "Loading audio…");
    try {
      const { faltan } = await hidratarAssets(destino, carpetaDeProyecto(destino));
      this.aplicar(destino);
      this.ev.avisarFaltan(faltan);
    } finally {
      this.restoring = false;
      this.setBusy(false);
    }
    // Here and not in `aplicar`, where `restoring` still blocks it. Reproduced 6-Nov: mute, undo,
    // and 2.5 s later the screen said unmuted and the file muted.
    this.programarGuardado();
  }

  private recordHistory(): void {
    if (!this.project) return;
    this.history.push(structuredClone(this.project));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  private aplicar(next: Project | null): void {
    this.project = next;
    this.ev.alAplicar(next);
    this.persist();
  }

  /** The folder of the project open when the page was left, read before anything can overwrite it. */
  static ultimoAbierto(): string | null {
    try {
      return localStorage.getItem(CLAVE_ABIERTO);
    } catch {
      return null;
    }
  }

  private persist(): void {
    try {
      if (this.project) localStorage.setItem(CLAVE_ABIERTO, carpetaDeProyecto(this.project));
      else localStorage.removeItem(CLAVE_ABIERTO);
    } catch {
      if (!this.persistenciaAvisada) {
        this.persistenciaAvisada = true;
        this.avisos.error("Could not record the open project in localStorage.");
      }
    }
    this.programarGuardado();
  }

  private programarGuardado(): void {
    if (!this.ready || this.restoring || !this.project) return;
    if (this.guardadoTimer !== null) window.clearTimeout(this.guardadoTimer);
    this.guardadoTimer = window.setTimeout(() => {
      this.guardadoTimer = null;
      void this.guardarEnDisco(true);
    }, RETARDO_GUARDADO);
  }

  get hayCambiosSinGuardar(): boolean {
    return this.guardadoTimer !== null || this.guardando || this.guardadoPendiente;
  }

  /** Writes now, without waiting, what the autosave had pending. */
  volcarPendiente(): void {
    const vista = this.project;
    if (!vista || !this.ready || (this.guardadoTimer === null && !this.guardadoPendiente)) return;
    if (this.guardadoTimer !== null) window.clearTimeout(this.guardadoTimer);
    this.guardadoTimer = null;
    this.guardadoPendiente = false;
    const ruta = rutaDeProyecto(carpetaDeProyecto(vista));
    // Serialized now, in this same tick: the caller is about to free this project's assets.
    const { datos } = serializarProyecto(vista, audioAssets);
    void guardarProyectoEnDisco(ruta, JSON.stringify(datos, null, 2)).catch((error: unknown) => {
      this.avisos.error(`Could not save “${vista.name}” to disk: ${error instanceof Error ? error.message : String(error)}.`);
    });
  }

  /** The "Save" button and Ctrl+S: write now, without waiting for the autosave. */
  guardarAhora(): void {
    if (this.guardadoTimer !== null) {
      window.clearTimeout(this.guardadoTimer);
      this.guardadoTimer = null;
    }
    void this.guardarEnDisco(false);
  }

  /** `silencioso` (autosave) only leaves the notice in the status bar. */
  private async guardarEnDisco(silencioso: boolean): Promise<void> {
    const vista = this.project;
    if (!vista) {
      if (!silencioso) this.avisos.info("There is no open project to save.");
      return;
    }
    if (!this.ready) return;
    if (this.guardando) {
      // There is already a write in flight: when it finishes it is relaunched with the new state.
      this.guardadoPendiente = true;
      return;
    }
    this.guardando = true;
    const ruta = rutaDeProyecto(carpetaDeProyecto(vista));
    try {
      const { datos, sinRuta } = serializarProyecto(vista, audioAssets);
      await guardarProyectoEnDisco(ruta, JSON.stringify(datos, null, 2));
      this.ev.estado(`✓ saved ${ruta} · ${horaActual()} · ${datos.proyecto.tracks.length} tracks`);
      if (!silencioso) {
        const conRuta = datos.proyecto.audioAssets?.filter((asset) => asset.ruta).length ?? 0;
        this.avisos.info(
          `Saved to ${ruta}: ${datos.proyecto.tracks.length} track(s), ${datos.proyecto.bpm} BPM, ` +
            `${datos.proyecto.lengthBars} bars, ${conRuta} WAV from the folder` +
            (sinRuta.length > 0
              ? `. ${sinRuta.length} without a file on disk (${sinRuta.slice(0, 3).join(", ")}): those do not travel with the project.`
              : "."),
        );
      }
    } catch (error) {
      this.avisos.error(
        `Could not save to disk: ${error instanceof Error ? error.message : String(error)}. ` +
          "The changes are on screen, but not in the project file.",
      );
      this.ev.estado("✗ could not save to disk");
    } finally {
      this.guardando = false;
      if (this.guardadoPendiente) {
        this.guardadoPendiente = false;
        this.programarGuardado();
      }
    }
  }
}

function horaActual(): string {
  return new Date().toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * Rendering the project offline with openDAW to write the mix (WAV, MP3) and the notes
 * (MIDI) in the project's salida/ folder. The WAV is rendered by the same engine as Play.
 */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { midiDeProyecto } from "../../src/core/midi-export.ts";
import { segundosPorTiempo } from "../../src/core/tiempo.ts";
import { audioAssets, hidratarAssets, rutaEnProyecto } from "./audio-store.ts";
import { mezclarStem, motorDebeSonar, stemsDeProyecto } from "./stems.ts";
import { convertirMp3, subirAudio } from "./proyecto-disco.ts";
import { audioBufferToWav } from "./wav.ts";

/** What `exportar` writes. `mp3` renders the WAV too: the MP3 is encoded from it. */
export interface Formatos {
  midi: boolean;
  wav: boolean;
  mp3?: boolean;
}

type SoundfontCargado = { uuid: Uint8Array; name: string; bytes: ArrayBuffer };

export interface DependenciasRender {
  proyecto(): Project | null;
  cargarSoundfonts(view: Project): Promise<Map<string, SoundfontCargado>>;
  cargarGm(view: Project): Promise<SoundfontCargado | null>;
  /** WAVs the project references that are not in its folder. */
  avisarFaltan(faltan: string[]): void;
}

/** Under this the mix counts as silence. */
const SILENCIO_DBFS = -60;

export interface ResultadoExport {
  ok: boolean;
  texto: string;
  /** What the person has to read even if the file was written. */
  avisos: string[];
}

/** Some tracks rendered for a module: chosen by id, whatever their mute or solo. */
export interface OpcionesFuente {
  pistas: string[];
  /** File name without extension, written to entrada/. */
  nombre: string;
  /** From 1 and inclusive; omitted = the whole render. */
  desdeCompas?: number;
  hastaCompas?: number;
}

export interface FuenteRenderizada {
  ruta: string;
  segundos: number;
  picoDb: number;
  bytes: number;
  avisos: string[];
}

function picoDe(canales: readonly Float32Array[]): number {
  let pico = 0;
  for (const datos of canales) for (let i = 0; i < datos.length; i += 1) pico = Math.max(pico, Math.abs(datos[i]!));
  return pico;
}

export function crearExportador(d: DependenciasRender): {
  exportar(formatos: Formatos, senal?: AbortSignal): Promise<ResultadoExport>;
  renderizarFuente(opciones: OpcionesFuente): Promise<FuenteRenderizada>;
} {
  /**
   * Long WAVs are outside openDAW, so the engine's mix does not have them: they are added here,
   * decoded one at a time, with the same mute, solo, gain, pan and master as in Play. One at a
   * time is what keeps this inside the memory that made them streaming in the first place.
   */
  async function sumarStems(view: Project, slug: string, render: { sampleRate: number; canales: Float32Array[] }): Promise<{ mezcla: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>]; avisos: string[] }> {
    const sr = render.sampleRate;
    const izq = render.canales[0]!;
    const der = render.canales[1] ?? izq;
    const stems = stemsDeProyecto(view, audioAssets);
    const porTiempo = segundosPorTiempo(view.bpm) * sr;
    const largo = Math.max(izq.length, ...stems.map((s) => Math.ceil((s.startBeat + s.lengthBeat) * porTiempo)));
    // Plain copies: the offline render hands back channels backed by SharedArrayBuffer, and
    // copyToChannel refuses shared memory.
    const mezcla: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(largo), new Float32Array(largo)];
    mezcla[0].set(izq);
    mezcla[1].set(der);
    const avisos: string[] = [];
    const master = Math.pow(10, view.master.gainDb / 20);
    for (const stem of stems) {
      const res = await fetch(`/api/audio?path=${encodeURIComponent(rutaEnProyecto(stem.src, slug))}`);
      if (!res.ok) throw new Error(`could not read ${stem.src} (HTTP ${res.status})`);
      const audio = await new OfflineAudioContext(2, 1, sr).decodeAudioData(await res.arrayBuffer());
      const fuente = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
      mezclarStem(mezcla, fuente, {
        inicio: Math.round(stem.startBeat * porTiempo),
        desdeFuente: Math.round(stem.offsetBeat * porTiempo),
        muestras: Math.round(stem.lengthBeat * porTiempo),
        ganancia: Math.pow(10, stem.gainDb / 20) * master,
        pan: stem.pan,
      });
      if (stem.sinSusEfectos) avisos.push(`“${stem.nombrePista}” is too long for the engine's memory: it was exported without its effects and sends.`);
    }
    return { mezcla, avisos };
  }

  /**
   * Export: the project to MIDI and/or the mix to WAV, in
   * `proyectos/<carpeta>/salida/`. The WAV is rendered by the same engine as Play.
   */
  async function exportarProyecto(formatos: Formatos, senal?: AbortSignal): Promise<ResultadoExport> {
    const avisos: string[] = [];
    const view = d.proyecto();
    if (!view) return { ok: false, texto: "There is no open project.", avisos };
    // Seen 2-Nov on "vidrio-4": an empty project exported 10 s of silence (the render's tail)
    // and reported "peak -Infinity dBFS" as if it were a song.
    const sonido = view.tracks.some((t) => t.clips.some((c) => c.audio !== undefined || c.notes.length > 0));
    if (!sonido) return { ok: false, texto: "The project has no notes and no audio clips: there is nothing to export yet.", avisos };
    const slug = carpetaDeProyecto(view);
    const hechos: string[] = [];
    // Cancel used to be ignored here: the turn waited for the whole render (28-Oct). The
    // offline renderer has no abort, so the check is before each costly step.
    const cancelado = (): ResultadoExport => ({
      ok: false,
      texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}Cancelled by the user before finishing the export.`,
      avisos,
    });
    try {
      if (senal?.aborted) return cancelado();
      if (formatos.midi) {
        const bytes = midiDeProyecto(view);
        const fichero = new File([bytes as unknown as BlobPart], `${slug}.mid`, { type: "audio/midi" });
        const { path } = await subirAudio(fichero, slug, "salida");
        const pistas = view.tracks.filter((t) => t.kind === "midi").length;
        hechos.push(`MIDI: proyectos/${slug}/${path} (${pistas} track(s), ${view.bpm} BPM).`);
      }
      if (formatos.wav || formatos.mp3) {
        if (senal?.aborted) return cancelado();
        const render = await prepararRender(view, slug);
        if (senal?.aborted) return cancelado();
        let motor = await render.renderizar(view);
        if (motor.canales.length === 0 || motor.canales[0]!.length === 0) throw new Error("the render came out empty");
        // A silent mix over tracks that should sound: seen twice in miuzika on 3-Nov and never
        // reproduced headless (13 renders), so it is treated as intermittent: once more.
        const silencio = 10 ** (SILENCIO_DBFS / 20);
        const debeSonar = motorDebeSonar(view, audioAssets);
        if (debeSonar && picoDe(motor.canales.slice(0, 2)) < silencio) {
          motor = await render.renderizar(view);
          if (picoDe(motor.canales.slice(0, 2)) >= silencio) avisos.push("The first render came out silent and a second one did not: this file is the second. Listen to it.");
        }
        const sumado = await sumarStems(view, slug, motor);
        avisos.push(...sumado.avisos);
        const canales = sumado.mezcla;
        const buffer = new AudioBuffer({ length: canales[0].length, numberOfChannels: 2, sampleRate: motor.sampleRate });
        canales.forEach((datos, i) => buffer.copyToChannel(datos, i));
        const pico = picoDe(canales);
        if (pico < silencio) {
          avisos.push(
            debeSonar
              ? "The exported mix is SILENT although tracks should sound (rendered twice). Do not trust this file."
              : "The exported mix is silent: every track with material is muted or left out by solo.",
          );
        }
        const fichero = new File([audioBufferToWav(buffer)], `${slug}.wav`, { type: "audio/wav" });
        const { path } = await subirAudio(fichero, slug, "salida");
        const segundos = buffer.length / buffer.sampleRate;
        const picoDb = pico > 0 ? 20 * Math.log10(pico) : -Infinity;
        hechos.push(
          `WAV: proyectos/${slug}/${path} (${Math.floor(segundos / 60)}:${String(Math.round(segundos % 60)).padStart(2, "0")}, ` +
            `peak ${picoDb.toFixed(1)} dBFS${pico > 1 ? " — CLIPPING: lower the master" : ""})` +
            (formatos.wav ? "." : ", kept as the MP3's source."),
        );
        if (formatos.mp3) {
          if (senal?.aborted) return cancelado();
          const r = await convertirMp3(path, slug, view.name, senal);
          const mb = (r.bytes / (1024 * 1024)).toFixed(1);
          const picoMp3 = r.mp3.picoDb === null ? "?" : r.mp3.picoDb.toFixed(1);
          hechos.push(
            `MP3: ${r.ruta} (${r.kbps} kbps, ${mb} MB, peak ${picoMp3} dBFS, title "${view.name}")` +
              (r.problemas.length > 0 ? ` — CHECK: ${r.problemas.join(" ")}` : "."),
          );
        }
      }
      return { ok: true, texto: hechos.join("\n") || "No format was requested.", avisos };
    } catch (error) {
      return {
        ok: false,
        texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}Could not export: ${error instanceof Error ? error.message : String(error)}`,
        avisos,
      };
    }
  }

  /**
   * What the engine needs to render the project without playing it: WAVs, the project's
   * SoundFonts and the GM.
   */
  async function prepararRender(view: Project, slug: string) {
    const { faltan } = await hidratarAssets(view, slug);
    d.avisarFaltan(faltan);
    const paraEngine = new Map<string, { name: string; buffer: AudioBuffer }>();
    for (const [id, asset] of audioAssets) {
      if (asset.buffer) paraEngine.set(id, { name: asset.name, buffer: asset.buffer });
    }
    const soundfonts = await d.cargarSoundfonts(view);
    const gm = await d.cargarGm(view);
    const { renderizarMezcla } = await import("./opendaw-engine.ts");
    return { renderizar: (vista: Project) => renderizarMezcla(vista, paraEngine, soundfonts, gm) };
  }

  /**
   * The chosen tracks as a WAV in entrada/, for a module to send to a model. Unmuted and with the
   * master at 0 dB, because what is sent depends only on what was chosen. Reproduced 5-Nov: with
   * the project muted to compare two takes, 220 s of digital silence went up (42 MB, 190 s of GPU);
   * with the master at -6 dB every source peaked 6 dB low and the repaint came back 6 dB under
   * the original. Long WAVs are mixed in too: on 5-Nov the source left them out.
   */
  async function renderizarFuente(o: OpcionesFuente): Promise<FuenteRenderizada> {
    const view = d.proyecto();
    if (!view) throw new Error("There is no open project.");
    const slug = carpetaDeProyecto(view);
    const elegidas = view.tracks.filter((t) => o.pistas.includes(t.id));
    if (elegidas.length === 0) throw new Error("None of the chosen tracks exists any more.");
    const vista: Project = {
      ...view,
      master: { ...view.master, gainDb: 0 },
      tracks: elegidas.map((t) => ({ ...t, muted: false, solo: false })),
    };
    const render = await prepararRender(vista, slug);
    const motor = await render.renderizar(vista);
    if (motor.canales.length === 0 || motor.canales[0]!.length === 0) throw new Error("the render came out empty");
    const { mezcla, avisos } = await sumarStems(vista, slug, motor);
    const muestrasPorCompas = beatsPerBar(view) * segundosPorTiempo(view.bpm) * motor.sampleRate;
    const largo = mezcla[0].length;
    const desde = Math.min(largo, Math.round(((o.desdeCompas ?? 1) - 1) * muestrasPorCompas));
    const hasta = o.hastaCompas === undefined ? largo : Math.min(largo, Math.round(o.hastaCompas * muestrasPorCompas));
    if (hasta <= desde) throw new Error(`Those bars fall after the end of the render (${(largo / motor.sampleRate).toFixed(1)} s): nothing to send.`);
    const trozos: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [mezcla[0].slice(desde, hasta), mezcla[1].slice(desde, hasta)];
    const buffer = new AudioBuffer({ length: hasta - desde, numberOfChannels: 2, sampleRate: motor.sampleRate });
    trozos.forEach((datos, i) => buffer.copyToChannel(datos, i));
    const pico = picoDe(trozos);
    const fichero = new File([audioBufferToWav(buffer)], `${o.nombre}.wav`, { type: "audio/wav" });
    const { path, bytes } = await subirAudio(fichero, slug);
    return { ruta: path, segundos: buffer.length / buffer.sampleRate, picoDb: pico > 0 ? 20 * Math.log10(pico) : -Infinity, bytes, avisos };
  }

  return { exportar: exportarProyecto, renderizarFuente };
}

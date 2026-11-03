/**
 * Rendering the project offline with openDAW, for the two tools that need it:
 * `exportar` (MIDI and the mix as WAV in salida/) and `escuchar_mezcla` (levels of the mix
 * and of each track alone, by bar ranges).
 *
 * Moved out of main.ts on 3-Nov (review 3-Nov, step 3: main.ts had 2,187 lines and 23
 * responsibilities). The bodies are unchanged; what they used from main.ts arrives as
 * dependencies, like crearAcciones does.
 */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
import { midiDeProyecto } from "../../src/core/midi-export.ts";
import { informeEscucha, nivelesPorTramo, notasPorTramo, tramosMixMudo, type PistaEscuchada } from "../../src/core/escucha.ts";
import { assetsPorStreaming, audioAssets, hidratarAssets } from "./audio-store.ts";
import { convertirMp3, subirAudio } from "./proyecto-disco.ts";

/** What `exportar` writes. `mp3` renders the WAV too: the MP3 is encoded from it. */
export interface Formatos {
  midi: boolean;
  wav: boolean;
  mp3?: boolean;
}
import { audioBufferToWav } from "./wav.ts";

type SoundfontCargado = { uuid: Uint8Array; name: string; bytes: ArrayBuffer };

export interface DependenciasRender {
  proyecto(): Project | null;
  cargarSoundfonts(view: Project): Promise<Map<string, SoundfontCargado>>;
  cargarGm(view: Project): Promise<SoundfontCargado | null>;
  /** WAVs the project references that are not in its folder. */
  avisarFaltan(faltan: string[]): void;
  /** The status bar line. */
  estado(texto: string): void;
}

export function crearRenderEscucha(d: DependenciasRender): {
  exportar(formatos: Formatos, senal?: AbortSignal): Promise<{ ok: boolean; texto: string }>;
  escuchar(opciones: { pistas?: string[]; compasesPorTramo?: number }, senal?: AbortSignal): Promise<{ ok: boolean; texto: string }>;
} {
  /**
   * Brief export: the project to MIDI and/or the mix to WAV, in
   * `proyectos/<carpeta>/salida/`. The WAV is rendered by the same engine as Play.
   */
  async function exportarProyecto(formatos: Formatos, senal?: AbortSignal): Promise<{ ok: boolean; texto: string }> {
    const view = d.proyecto();
    if (!view) return { ok: false, texto: "There is no open project." };
    // Seen 2-Nov on "vidrio-4": an empty project exported 10 s of silence (the render's tail)
    // and reported "peak -Infinity dBFS" as if it were a song.
    const sonido = view.tracks.some((t) => t.clips.some((c) => c.audio !== undefined || c.notes.length > 0));
    if (!sonido) return { ok: false, texto: "The project has no notes and no audio clips: there is nothing to export yet." };
    const slug = carpetaDeProyecto(view);
    const hechos: string[] = [];
    // Cancel used to be ignored here: the turn waited for the whole render (28-Oct). The
    // offline renderer has no abort, so the check is before each costly step.
    const cancelado = (): { ok: false; texto: string } => ({
      ok: false,
      texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}Cancelled by the user before finishing the export.`,
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
        const mezcla = await render.renderizar(view);
        const canales = mezcla.canales.slice(0, 2);
        if (canales.length === 0 || canales[0]!.length === 0) throw new Error("the render came out empty");
        const buffer = new AudioBuffer({ length: canales[0]!.length, numberOfChannels: canales.length, sampleRate: mezcla.sampleRate });
        // The offline render hands back channels backed by SharedArrayBuffer, and copyToChannel
        // refuses shared memory ("The provided Float32Array value must not be shared"): measured
        // on 2-Nov night, every WAV export of "Vidrio" failed. Copy each one to a plain array.
        canales.forEach((datos, i) => buffer.copyToChannel(new Float32Array(datos), i));
        let pico = 0;
        for (const datos of canales) for (let i = 0; i < datos.length; i += 1) pico = Math.max(pico, Math.abs(datos[i]!));
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
      const fuera = formatos.wav || formatos.mp3 ? assetsPorStreaming(view) : [];
      if (fuera.length > 0) {
        hechos.push(`Not in the WAV/MP3 (long, played by streaming, outside openDAW): ${fuera.join(", ")}.`);
      }
      return { ok: true, texto: hechos.join("\n") || "No format was requested." };
    } catch (error) {
      return {
        ok: false,
        texto: `${hechos.join("\n")}${hechos.length ? "\n" : ""}Could not export: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * What the engine needs to render the project without playing it: WAVs, the project's
   * SoundFonts and the GM. It is loaded once and serves several renders (the mix and each
   * track alone in `escuchar_mezcla`).
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
    // `cargarSoundfontsDelProyecto` silently skips the .sf2 files that do not arrive: here
    // they are noted, because a track without its instrument is exactly what has to be diagnosed.
    const sinCargar = [
      ...new Set(
        view.tracks.flatMap((t) => (t.instrument.type === "soundfont" && t.instrument.archivo && !soundfonts.has(t.instrument.archivo) ? [t.instrument.archivo] : [])),
      ),
    ];
    const { renderizarMezcla } = await import("./opendaw-engine.ts");
    return { sinCargar, renderizar: (vista: Project) => renderizarMezcla(vista, paraEngine, soundfonts, gm) };
  }

  /**
   * `escuchar_mezcla`: the level of the mix and of each track alone, by bar ranges,
   * rendered with openDAW. It is what really sounds, not the agent's numpy render
   * (STATUS Oct 28, pending 7).
   */
  async function escucharMezcla(opciones: { pistas?: string[]; compasesPorTramo?: number }, senal?: AbortSignal): Promise<{ ok: boolean; texto: string }> {
    const view = d.proyecto();
    if (!view) return { ok: false, texto: "There is no open project." };
    // Cancel is checked between renders: with 8 tracks that is 9 renders and the turn
    // used to wait for all of them (28-Oct). A render in flight cannot be interrupted.
    const cancelado = (hechas: number, total: number): { ok: false; texto: string } => ({
      ok: false,
      texto: `Cancelled by the user while listening (${hechas} of ${total} tracks measured; no report).`,
    });
    try {
      const compasesPorTramo = Math.max(1, Math.min(16, Math.trunc(opciones.compasesPorTramo ?? 4)));
      const tiemposTramo = compasesPorTramo * beatsPerBar(view);
      const tramos = Math.max(1, Math.ceil(view.lengthBars / compasesPorTramo));
      const pedidas = (opciones.pistas ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean);
      const elegidas = view.tracks.filter(
        (t) => pedidas.length === 0 || pedidas.includes(t.id.toLowerCase()) || pedidas.includes(t.name.toLowerCase()),
      );
      if (pedidas.length > 0 && elegidas.length === 0) {
        // 2-Nov "vidrio": the agent asked for its reverb bus by name and read "No tracks named
        // sala" as a broken bus. A bus has no row of its own; its return is inside the MIX.
        const buses = (view.buses ?? []).filter((b) => pedidas.includes(b.id.toLowerCase()) || pedidas.includes(b.name.toLowerCase()));
        const deBus =
          buses.length > 0
            ? ` ${buses.map((b) => `"${b.name}"`).join(", ")} is a bus: buses are not rendered alone, their return is in the MIX row. ` +
              `To hear what it adds, listen without pistas and compare the MIX before and after set_send.`
            : "";
        return { ok: false, texto: `No tracks named ${pedidas.join(", ")}. Tracks: ${view.tracks.map((t) => t.name).join(", ")}.${deBus}` };
      }
      if (senal?.aborted) return cancelado(0, elegidas.length);
      const render = await prepararRender(view, carpetaDeProyecto(view));
      const medir = (r: { sampleRate: number; canales: Float32Array[] }) =>
        nivelesPorTramo(r.canales.slice(0, 2), r.sampleRate, view.bpm, tiemposTramo, tramos);
      if (senal?.aborted) return cancelado(0, elegidas.length);
      d.estado("Listening: rendering the mix…");
      let mezcla = medir(await render.renderizar(view));
      const pistas: PistaEscuchada[] = [];
      for (const [i, pista] of elegidas.entries()) {
        if (senal?.aborted) return cancelado(i, elegidas.length);
        d.estado(`Listening: track ${i + 1}/${elegidas.length} (${pista.name})…`);
        // The track alone, without mute or solo: it measures whether its instrument produces signal.
        const sola: Project = { ...view, tracks: [{ ...pista, muted: false, solo: false }] };
        // Streaming WAV clips do not go through openDAW: counting them would give a false MUTE.
        const enMotor = pista.clips.filter((clip) => !(clip.audio && audioAssets.get(clip.audio.assetId)?.streaming));
        pistas.push({
          nombre: pista.name,
          muted: pista.muted,
          notas: notasPorTramo({ clips: enMotor }, tiemposTramo, tramos),
          niveles: medir(await render.renderizar(sola)),
        });
      }
      // A silent MIX over tracks that sound alone: render the mix once more. Seen 3-Nov on
      // "cain-uriel" (compressor + eq on an audio track, another one muted) and NOT reproduced
      // the same night in headless Chrome: that project shape rendered fine 6 times (13 renders in all), also as
      // the first render of a fresh page. If the second render sounds it was a race in the
      // tab, and the report says so instead of sending the agent after the devices.
      let segundaVez = "";
      if (tramosMixMudo(mezcla, pistas).length > 0 && !senal?.aborted) {
        d.estado("Listening: the mix came out silent, rendering it again…");
        const otra = medir(await render.renderizar(view));
        if (tramosMixMudo(otra, pistas).length === 0) {
          mezcla = otra;
          segundaVez =
            "\nNote: the first render of the MIX came out silent and a second one did not; the MIX row is the second. " +
            "Intermittent engine issue, not your devices: say so to the person.";
        } else {
          segundaVez = "\nNote: the MIX was rendered twice and came out silent both times.";
        }
      }
      const fuera = assetsPorStreaming(view);
      const nota =
        segundaVez +
        (fuera.length > 0 ? `\nNOT measured (long WAVs through streaming, outside openDAW; they sound in Play): ${fuera.join(", ")}.` : "");
      return { ok: true, texto: informeEscucha({ compasesPorTramo, mezcla, pistas, sinCargar: render.sinCargar }) + nota };
    } catch (error) {
      return { ok: false, texto: `Could not listen to the mix: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  return { exportar: exportarProyecto, escuchar: escucharMezcla };
}

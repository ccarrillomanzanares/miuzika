/**
 * Agent actions on the open project.
 *
 * These are the tools that CHANGE or READ the project: they run in the tab because the
 * tab is the only one that writes `proyecto.json`. Before, they lived in `main.ts` (which
 * also painted, played, saved and booted the app); here they depend only on `Estudio`, a
 * small contract with what they need from the rest.
 *
 * They all change the project with ops (`applyOps`): they are transactional, they are
 * validated and they are undone with Ctrl+Z just like a manual edit.
 */

import type { InstrumentType, Mode, Note, Project } from "../../../src/core/types.ts";
import { INSTRUMENT_TYPES, beatsPerBar } from "../../../src/core/types.ts";
import { carpetaDeNombre, carpetaDeProyecto, createProject } from "../../../src/core/project.ts";
import { compasesDeAudio } from "../../../src/core/tiempo.ts";
import { normalizarReceta, rutaScriptDeSonido, rutaWavDeSonido, scriptDeSonido, vozPorClave } from "../../../src/core/sonidos.ts";
import type { RecetaSonido, VozSonido } from "../../../src/core/sonidos.ts";
import { aplicarPalabras } from "../../../src/core/palabras.ts";
import { OpError, applyOps } from "../../../src/core/ops.ts";
import type { Op } from "../../../src/core/ops.ts";
import { notasDeProgresion } from "../../../src/core/composicion.ts";
import { leerNotacion, tramosIrregulares } from "../../../src/core/notacion.ts";
import { notasDeBateria } from "../../../src/core/bateria.ts";
import { nombreDeNota, resumenParaAgente } from "../../../src/core/resumen.ts";
import { normalizarTexto, slugDe } from "../../../src/core/nombres.ts";
import { MODE_NAMES } from "../../../src/core/theory.ts";
import {
  SEGUNDOS_STREAMING,
  loadAudioFile,
  metadatosWav,
  registrarAssetStreaming,
  rutaEnProyecto,
} from "../audio-store.ts";
import { listarProyectos } from "../proyecto-disco.ts";
import { interpretarProyectoEnDisco } from "../proyecto-archivo.ts";
import { CARPETA_VERSIONES, describirVersion, restaurarVersion } from "../../../src/core/versiones.ts";
import { cabeceraDeProyecto, cabecerasProyecto } from "./tools.ts";
import type {
  AccionesEstudio,
  AjustePista,
  PeticionIgualar,
  PeticionPistas,
  PeticionBateriaPista,
  PeticionEscritura,
  PeticionNotas,
  PeticionProgresionPista,
  PeticionProyecto,
  PeticionSample,
  PeticionSonido,
  ResultadoAccion,
} from "./tools.ts";

/** What the actions need from the app. main.ts implements it. */
export interface Estudio {
  /** The open project (or null). */
  proyecto(): Project | null;
  /** New state with history; restarts the engine (new tracks or clips). */
  fijar(siguiente: Project): void;
  /** Live change (mix, lengths): with history, without restarting the engine. */
  enVivo(siguiente: Project): void;
  /** Notice in the chat for the person (not the model). */
  avisar(texto: string): void;
  /** Exports the project to MIDI and/or the mix to WAV in salida/. */
  exportar?(formatos: { midi: boolean; wav: boolean }): Promise<ResultadoAccion>;
  /** Renders with openDAW and measures the level per bar range of the mix and of each track alone. */
  escuchar?(opciones: { pistas?: string[]; compasesPorTramo?: number }): Promise<ResultadoAccion>;
}

/** Project name from the delivered file (salida/sacramento_multitrack.mid -> sacramento). */
export function nombreDesdeRuta(ruta: string): string {
  const base = (ruta.split("/").pop() ?? "proyecto").replace(/\.[^.]+$/, "");
  const limpio = base
    .replace(/^midi_/i, "")
    .replace(/_(multitrack|master|mix|stems?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return (limpio || base || "proyecto").slice(0, 40);
}

/** Track by id, by name (without accents or uppercase) or by part of the name if it is unique. */
function pistaPorNombre(project: Project, nombre: string) {
  const buscado = normalizarTexto(nombre);
  if (buscado === "") return undefined;
  const exacta =
    project.tracks.find((t) => t.id === nombre.trim()) ??
    project.tracks.find((t) => normalizarTexto(t.name) === buscado);
  if (exacta) return exacta;
  const parciales = project.tracks.filter(
    (t) => normalizarTexto(t.name).includes(buscado) || buscado.includes(normalizarTexto(t.name)),
  );
  return parciales.length === 1 ? parciales[0] : undefined;
}

const mensajeDe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function crearAcciones(e: Estudio): AccionesEstudio {
  /**
   * Creates real tracks in the project from files in workspace/: the .mid as MIDI tracks
   * with their notes and the .wav as audio tracks. It reuses the same path as the "Audio"
   * importer (loadAudioFile -> persistAudioAsset -> ops).
   */
  async function importarPistas(
    peticion: PeticionPistas,
  ): Promise<ResultadoAccion> {
    const inicio = Math.max(0, Math.min(511, Math.trunc(peticion.inicioCompas)));
    const MAX_NOTAS = 2000; // cap of the add_notes op
    const hechas: string[] = [];
    const fallos: string[] = [];
    /**
     * A take's duration is counted in BARS, not file seconds: that way the MIDI (which
     * ends at its last note) and the WAV (which has a tail) of the same instrument end in
     * the same bar. If the agent does not give it, the audio's is taken, which is how long
     * the material lasts.
     */
    const compasesToma = peticion.compases && peticion.compases > 0 ? Math.trunc(peticion.compases) : 0;
    const clipsMidi: { trackId: string; clipId: string }[] = [];
    let largoAudio = 0;
    const avisos: string[] = [];

    // 1) without a project the name is needed BEFORE reading anything: the project folder
    //    is what makes it possible to resolve 'salida/...'. It is created provisionally and
    //    then tempo and bars are adjusted with set_song.
    let creadoAqui = false;
    if (!e.proyecto()) {
      if (!peticion.nombreProyecto) {
        const sugerencia = nombreDesdeRuta(peticion.midis[0] ?? peticion.wavs[0] ?? "");
        return {
          ok: false,
          texto:
            "There is no open project and you have not given me a name. ASK the user what they want to " +
            "call the project" +
            (sugerencia ? ` (suggestion: "${sugerencia}")` : "") +
            " and call again with nombre_proyecto. Do not invent the name.",
        };
      }
      e.fijar(
        createProject({
          name: peticion.nombreProyecto.slice(0, 40),
          bpm: 120,
          lengthBars: 32,
        }),
      );
      creadoAqui = true;
    }

    // 2) read the MIDI files (the project folder already exists, so 'salida/...' resolves)
    interface PistaMidi {
      name: string;
      program?: number;
      channel?: number;
      notes: { pitch: number; start: number; duration: number; velocity: number }[];
    }
    const material: { ruta: string; bpm: number; tracks: PistaMidi[] }[] = [];
    for (const ruta of peticion.midis) {
      try {
        const res = await fetch(`/api/midi?path=${encodeURIComponent(ruta)}`, {
          headers: cabecerasProyecto(),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const datos = (await res.json()) as { bpm?: number; tracks?: PistaMidi[] };
        material.push({
          ruta,
          bpm: Number(datos.bpm) || 120,
          tracks: (datos.tracks ?? []).filter((pista) => (pista.notes?.length ?? 0) > 0),
        });
      } catch (error) {
        fallos.push(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 3) if there is no project, there is nowhere to hang the tracks
    const project = e.proyecto();
    if (!project) {
      return { ok: false, texto: "The project could not be created." };
    }

    let current: Project = project;

    // 4) if we created it here, adjust tempo and bars to the real material
    if (creadoAqui) {
      let finBeat = 0;
      for (const bloque of material) {
        for (const pista of bloque.tracks) {
          for (const nota of pista.notes) finBeat = Math.max(finBeat, nota.start + nota.duration);
        }
      }
      if (material.length > 0) {
        const bpm = material[0]?.bpm ?? project.bpm;
        const compases = Math.max(4, Math.min(512, Math.ceil(finBeat / 4) + 1));
        current = applyOps(current, [{ op: "set_song", bpm, lengthBars: compases }]).project;
      }
    }

    // A MIDI at 90 BPM inside a 120 BPM project does not sound "wrong": it sounds at 120,
    // because the notes are beats. Without this warning it looks like the file came broken.
    if (!creadoAqui && material.length > 0) {
      for (const bloque of material) {
        if (Math.abs(bloque.bpm - current.bpm) > 0.5) {
          avisos.push(
            `${bloque.ruta}: the MIDI is at ${bloque.bpm} BPM and the project at ${current.bpm}. ` +
              "The notes are placed in beats, so they will sound faster or slower; " +
              "if you want the file's tempo, change the project's.",
          );
        }
      }
    }

    let contador = current.tracks.length;

    for (const bloque of material) {
      {
        const pistas = bloque.tracks;
        for (const pista of pistas) {
          const prog = pista.program ?? 0;
          const canal = pista.channel ?? 0;
          // General MIDI families (program 0-127): basses 32-39, leads 80-87, pads 88-95.
        const tipo: InstrumentType =
          canal === 9
            ? "drumkit"
            : prog >= 32 && prog <= 39
              ? "bass"
              : prog >= 88 && prog <= 95
                ? "pad"
                : prog >= 80 && prog <= 87
                  ? "lead"
                  : "synth";
          const id = `trk_ag_${contador++}`;
          const nombre = pista.name.slice(0, 60);
          current = applyOps(current, [
            { op: "add_track", id, name: nombre, kind: "midi", instrument: { type: tipo, program: prog } },
          ]).project;
          for (let i = 0; i < pista.notes.length; i += MAX_NOTAS) {
            const trozo = pista.notes.slice(i, i + MAX_NOTAS);
            if (i === 0) {
              current = applyOps(current, [
                { op: "add_notes", trackId: id, startBar: inicio, name: nombre, notes: trozo },
              ]).project;
              const clipId = current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
              if (clipId) clipsMidi.push({ trackId: id, clipId });
            } else {
              // The chunks stay in the SAME clip: otherwise each chunk creates a new
              // clip from the start bar and they overlap (Drums: 2,376 notes).
              const clipId = current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
              current = applyOps(current, [
                { op: "add_notes", trackId: id, clipId, notes: trozo },
              ]).project;
            }
          }
          hechas.push(`${nombre} (MIDI, ${pista.notes.length} notes)`);
        }
      }
    }

    // common prefix of the WAVs, so the tracks are not called "tema_bateria"
    // Prefix to strip from the names: the common file's and, if there are not several,
    // the project's own ("sacramento_bajo.wav" -> "bajo").
    let prefijo = project ? `${carpetaDeProyecto(project)}_` : "";
    if (peticion.wavs.length > 1) {
      const bases = peticion.wavs.map((r) => (r.split("/").pop() ?? r).replace(/\.[^.]+$/, ""));
      let comun = bases[0] ?? "";
      for (const base of bases.slice(1)) {
        while (comun.length > 0 && !base.startsWith(comun)) comun = comun.slice(0, -1);
      }
      if (comun.includes("_")) prefijo = comun.slice(0, comun.lastIndexOf("_") + 1);
    }

    for (const ruta of peticion.wavs) {
      try {
        const fichero = ruta.split("/").pop() ?? "audio.wav";
        const sinExt = fichero.replace(/\.[^.]+$/, "");
        const recortado = prefijo && sinExt.startsWith(prefijo) ? sinExt.slice(prefijo.length) : sinExt;
        const nombre = (recortado || sinExt || "Audio").slice(0, 60);

        // Long stems are NOT decoded: streaming with <audio> and peaks from the
        // server. That way many fit at once (RAM does not grow with duration).
        const meta = await metadatosWav(rutaEnProyecto(ruta, carpetaDeProyecto(project)));
        if (meta.duracionSeg >= SEGUNDOS_STREAMING) {
          const durationBeats = (meta.duracionSeg * current.bpm) / 60;
          const assetId = `aud_st_${Date.now().toString(36)}_${contador++}`;
          registrarAssetStreaming({
            id: assetId,
            name: nombre,
            durationBeats,
            src: ruta,
            peaks: Float32Array.from(meta.picos),
          });
          const existente = current.tracks.find((t) => t.kind === "audio" && t.name === nombre);
          current = applyOps(current, [
            { op: "register_audio_asset", assetId, name: nombre, durationBeats, ruta },
            ...(existente
              ? [
                  // Reimporting REPLACES that track's clips: that way a badly trimmed
                  // batch is fixed without ending up with two identical tracks.
                  ...existente.clips.map((clip) => ({
                    op: "remove_clip" as const,
                    trackId: existente.id,
                    clipId: clip.id,
                  })),
                  {
                    op: "add_audio_clip" as const,
                    assetId,
                    startBar: inicio,
                    lengthBeats:
                      compasesToma > 0
                        ? compasesToma * beatsPerBar(current)
                        : compasesDeAudio(durationBeats, beatsPerBar(current)),
                    gainDb: 0,
                    name: nombre,
                    trackId: existente.id,
                  },
                ]
              : [
                  {
                    op: "add_audio_clip" as const,
                    assetId,
                    startBar: inicio,
                    lengthBeats:
                      compasesToma > 0
                        ? compasesToma * beatsPerBar(current)
                        : compasesDeAudio(durationBeats, beatsPerBar(current)),
                    gainDb: 0,
                    name: nombre,
                    track: { name: nombre },
                  },
                ]),
          ]).project;
          if (compasesToma > 0 && compasesToma * beatsPerBar(current) > durationBeats + 1e-6) {
            avisos.push(
              `${nombre}: you asked for ${compasesToma} bars but the WAV lasts ${durationBeats.toFixed(1)} beats ` +
                `(${(durationBeats / beatsPerBar(current)).toFixed(2)} bars). The clip stays at what there is.`,
            );
          }
          largoAudio = Math.max(
            largoAudio,
            compasesToma > 0 ? compasesToma * beatsPerBar(current) : compasesDeAudio(durationBeats, beatsPerBar(current)),
          );
          hechas.push(
            `${nombre} (streaming audio, ${durationBeats.toFixed(1)} beats, not decoded)`,
          );
          continue;
        }

        const res = await fetch(`/api/audio?path=${encodeURIComponent(rutaEnProyecto(ruta, carpetaDeProyecto(project)))}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], fichero, { type: "audio/wav" });
        // The asset points to its path on disk: the project is portable with no more.
        const asset = await loadAudioFile(file, current.bpm, ruta);
        current = applyOps(current, [
          {
            op: "register_audio_asset",
            assetId: asset.id,
            name: asset.name,
            durationBeats: asset.durationBeats,
            ruta,
          },
          {
            op: "add_audio_clip",
            assetId: asset.id,
            startBar: inicio,
            lengthBeats:
              compasesToma > 0
                ? compasesToma * beatsPerBar(current)
                : compasesDeAudio(asset.durationBeats, beatsPerBar(current)),
            gainDb: 0,
            name: nombre,
            track: { name: nombre },
          },
        ]).project;
        if (compasesToma > 0 && compasesToma * beatsPerBar(current) > asset.durationBeats + 1e-6) {
          avisos.push(
            `${nombre}: you asked for ${compasesToma} bars but the WAV lasts ${asset.durationBeats.toFixed(1)} beats. ` +
              "The clip stays at what there is.",
          );
        }
        largoAudio = Math.max(
          largoAudio,
          compasesToma > 0 ? compasesToma * beatsPerBar(current) : compasesDeAudio(asset.durationBeats, beatsPerBar(current)),
        );
        hechas.push(`${nombre} (audio, ${asset.durationBeats.toFixed(1)} beats)`);
      } catch (error) {
        fallos.push(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // The whole take measures the same: bars given by the agent or, if not, how long the
    // audio lasts. The MIDI clips are stretched to there (they are never trimmed: their
    // notes already fit inside).
    const barBeatsToma = beatsPerBar(current);
    const largoToma =
      compasesToma > 0 ? compasesToma * barBeatsToma : largoAudio;
    if (largoToma > 0) {
      const opsFinales: Op[] = [];
      for (const { trackId, clipId } of clipsMidi) {
        const pista = current.tracks.find((t) => t.id === trackId);
        const clip = pista?.clips.find((c) => c.id === clipId);
        if (clip && clip.length < largoToma - 1e-6) {
          opsFinales.push({ op: "set_clip_length", trackId, clipId, lengthBeats: largoToma });
        }
      }
      if (opsFinales.length > 0) current = applyOps(current, opsFinales).project;
      current = applyOps(current, [
        {
          op: "set_song",
          bpm: current.bpm,
          lengthBars: Math.max(
            current.lengthBars,
            inicio + Math.ceil(largoToma / barBeatsToma - 1e-6),
          ),
        },
      ]).project;
    }

    if (hechas.length > 0) {
      e.fijar(current);
      e.avisar(`Tracks added to the project: ${hechas.length}.`);
    }
    const texto = [
      hechas.length > 0 ? `Added ${hechas.length} tracks:` : "No track was added.",
      ...hechas.map((linea) => `- ${linea}`),
      ...(fallos.length > 0 ? ["Failures:", ...fallos.map((linea) => `- ${linea}`)] : []),
      ...avisos,
      // The same material twice sounds double: it warns on the spot, not afterwards.
      ...(peticion.midis.length > 0 && peticion.wavs.length > 0
        ? [
            "WARNING: you have added MIDI and WAV of the same song. They both sound at once (double level and phase). " +
              "Ask the user which one to keep and silence the other set with ajustar_pistas.",
          ]
        : []),
    ].join("\n");
    return { ok: hechas.length > 0, texto };
  }

  /**
   * Creates a sound from the chat: recipe -> script -> render -> measurement -> disk.
   *
   * The voice and its parameters come from the engine catalog (/api/voces), the words
   * from the human vocabulary, and the result is saved with its card in
   * proyectos/<slug>/sonidos/, so it can be repeated and listened to again.
   */
  async function crearSonido(
    peticion: PeticionSonido,
  ): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) {
      return { ok: false, texto: "There is no open project: create one first (its folder is where the sound lives)." };
    }
    const slug = carpetaDeProyecto(project);
    const avisos: string[] = [];

    let catalogo: VozSonido[] = [];
    try {
      const res = await fetch("/api/voces");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      catalogo = ((await res.json()) as { voces?: VozSonido[] }).voces ?? [];
    } catch (error) {
      return {
        ok: false,
        texto: `I could not read the engine catalog: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    let receta: RecetaSonido;
    try {
      const normalizada = normalizarReceta(
        { nombre: peticion.nombre || peticion.voz, voz: peticion.voz, args: peticion.args },
        catalogo,
      );
      receta = normalizada.receta;
      avisos.push(...normalizada.avisos);
    } catch (error) {
      return { ok: false, texto: error instanceof Error ? error.message : String(error) };
    }

    const voz = vozPorClave(catalogo, receta.voz);
    const destino: "cpu" | "gpu" = (voz as { destino?: string } | undefined)?.destino === "gpu" ? "gpu" : "cpu";
    receta = { ...receta, destino };
    if (destino === "gpu") {
      avisos.push("This voice renders on the GPU: it uses Lambda ($1.29/h while off, ~3 min to start).");
    }

    if (peticion.palabras && peticion.palabras.length > 0) {
      const conPalabras = aplicarPalabras(receta, peticion.palabras, vozPorClave(catalogo, receta.voz));
      receta = conPalabras.receta;
      avisos.push(...conPalabras.avisos, ...conPalabras.descartadas.map((d) => d.motivo));
    }

    const rutaScript = rutaScriptDeSonido(receta);
    // The slug is explicit: `cabecerasProyecto()` depends on the agent having called
    // setProyectoActivo before and, if not, the file ends up in "sin-proyecto".
    const escribir = (ruta: string, contenido: string): Promise<Response> =>
      fetch("/api/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(slug) },
        body: JSON.stringify({ path: ruta, contenido }),
      });

    try {
      const w = await escribir(rutaScript, scriptDeSonido(receta, { slug }));
      if (!w.ok) throw new Error(`could not write the script (${w.status})`);
      const r = await fetch(destino === "gpu" ? "/api/run/lambda" : "/api/run/python", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(slug) },
        body: JSON.stringify({
          path: rutaScript,
          timeout_segundos: destino === "gpu" ? 600 : 180,
        }),
      });
      const corrida = (await r.json()) as { codigo?: number; salida?: string; errores?: string };
      if (!r.ok || (corrida.codigo ?? 1) !== 0) {
        throw new Error(
          `the render failed: ${(corrida.errores || corrida.salida || `HTTP ${r.status}`).slice(-600)}`,
        );
      }

      // Card next to the WAV: it is what makes it possible to repeat it with other words.
      const rutaFicha = `proyectos/${slug}/${rutaWavDeSonido(receta).replace(/\.wav$/, ".json")}`;
      await escribir(rutaFicha, JSON.stringify(receta, null, 2));

      // Objective measurement: a sound is not delivered without knowing how it is.
      const rutaWav = `proyectos/${slug}/${rutaWavDeSonido(receta)}`;
      let informe = "";
      try {
        const v = await fetch("/api/verificar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: rutaWav }),
        });
        if (v.ok) informe = String(((await v.json()) as { informe?: string }).informe ?? "");
      } catch {
        /* measuring is optional: the sound is already made */
      }
      const medidas = informe
        .split("\n")
        .filter((l) => /pico|clipeadas/.test(l))
        .join(" ");

      const texto = [
        `Sound "${receta.nombre}" created (voice ${receta.voz} on ${destino.toUpperCase()}${receta.palabras?.length ? ` · ${receta.palabras.join(", ")}` : ""}).`,
        `WAV: ${rutaWav}`,
        medidas ? `Measurements: ${medidas}` : "",
        ...avisos.map((a) => `- ${a}`),
        // Path RELATIVE to the project (the convention of everything else): the server
        // resolves it inside proyectos/<slug>/. With "proyectos/<slug>/..." it also
        // worked, but the agent ended up mixing the two forms.
        `To hear it in the song: anadir_pistas(wavs=["${rutaWavDeSonido(receta)}"], compases=<the song's>).`,
      ]
        .filter((l) => l !== "")
        .join("\n");
      return { ok: true, texto };
    } catch (error) {
      return { ok: false, texto: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Puts a library sample into the project: it is converted and normalized on the
   * server (`codigo/importar_sample.py`) and left as an audio clip.
   *
   * The sample ends up copied inside the project: the project remains portable and does
   * not depend on the library staying where it is.
   */
  async function usarSample(
    peticion: PeticionSample,
  ): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: the sample has to go into one." };
    const archivo = peticion.archivo.trim();
    if (archivo === "") return { ok: false, texto: "Missing the sample path." };
    const nombre = slugDe((peticion.nombre ?? archivo.split("/").pop() ?? "sample").replace(/\.[^.]+$/, ""), {
      max: 40,
      defecto: "sample",
    });

    try {
      const res = await fetch("/api/catalogo/importar", {
        method: "POST",
        // The slug is explicit: `cabecerasProyecto()` depends on the agent having gone
        // through `setProyectoActivo`, and if not, the sample ends up in "sin-proyecto".
        headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(carpetaDeProyecto(project)) },
        body: JSON.stringify({ archivo, nombre }),
      });
      const datos = (await res.json()) as {
        ok?: boolean;
        ruta?: string;
        duracion_s?: number;
        pico_original_dbfs?: number;
        error?: string;
      };
      if (!res.ok || !datos.ok || !datos.ruta) {
        return { ok: false, texto: `I could not import the sample: ${datos.error ?? `HTTP ${res.status}`}` };
      }
      const puesto = await importarPistas({
        midis: [],
        wavs: [datos.ruta],
        inicioCompas: 0,
        ...(peticion.compases && peticion.compases > 0 ? { compases: peticion.compases } : {}),
      });
      return {
        ok: puesto.ok,
        texto:
          `Sample "${nombre}" in the project (${datos.duracion_s} s, peak ${datos.pico_original_dbfs} -> -1 dBFS).\n` +
          `File: proyectos/${carpetaDeProyecto(project)}/${datos.ruta}\n` +
          puesto.texto,
      };
    } catch (error) {
      return { ok: false, texto: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Matches the clip durations: all to the same number of bars.
   *
   * Clips are measured in bars, so the MIDI of an instrument and the WAV of the same
   * material have to end in the same bar. It goes through ops (undone with Ctrl+Z) and
   * touches neither notes, levels nor tempo.
   */
  function igualarClips(peticion: PeticionIgualar): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project." };
    const bar = beatsPerBar(project);
    const normal = normalizarTexto;

    const pedidas = (peticion.pistas ?? []).filter((n) => n.trim() !== "");
    const pistas =
      pedidas.length === 0
        ? project.tracks
        : project.tracks.filter((t) => pedidas.some((n) => normal(t.name).includes(normal(n))));
    if (pistas.length === 0) {
      return { ok: false, texto: `I cannot find any track called that: ${pedidas.join(", ")}` };
    }

    const masLargo = Math.max(0, ...pistas.flatMap((t) => t.clips.map((c) => c.length)));
    const objetivo =
      peticion.compases && peticion.compases > 0
        ? Math.trunc(peticion.compases) * bar
        : compasesDeAudio(masLargo, bar);
    if (!(objetivo > 0)) return { ok: false, texto: "There are no clips to match." };

    const ops: Op[] = [];
    for (const pista of pistas) {
      for (const clip of pista.clips) {
        if (Math.abs(clip.length - objetivo) > 1e-6) {
          ops.push({ op: "set_clip_length", trackId: pista.id, clipId: clip.id, lengthBeats: objetivo });
        }
      }
    }
    if (ops.length === 0) {
      return {
        ok: true,
        texto: `Nothing to match: the ${pistas.length} clips already last ${(objetivo / bar).toFixed(2)} bars.`,
      };
    }
    const siguiente = applyOps(project, [
      ...ops,
      {
        op: "set_song",
        bpm: project.bpm,
        lengthBars: Math.max(project.lengthBars, Math.ceil(objetivo / bar - 1e-6)),
      },
    ]).project;
    e.enVivo(siguiente);
    return {
      ok: true,
      texto:
        `Matched ${ops.length} clips to ${(objetivo / bar).toFixed(2)} bars (${objetivo} beats) ` +
        `across ${pistas.length} tracks. The project is now ${siguiente.lengthBars} bars long.`,
    };
  }


  /**
   * Empty project with the requested name (the agent calls it after asking). The folder
   * is chosen FREELY: if `proyectos/<slug>/` already exists, `<slug>-2` is used, and so
   * on. Before, two projects with the same name (or two names in a non-Latin alphabet,
   * which all gave "proyecto") wrote into the same folder.
   */
  async function crearProyecto(peticion: PeticionProyecto): Promise<ResultadoAccion> {
    const nombre = peticion.nombre.trim();
    if (!nombre) return { ok: false, texto: "Missing the project name." };
    const previo = e.proyecto()?.name ?? null;
    const bpm = Math.min(300, Math.max(20, Math.round(peticion.bpm)));
    const compases = Math.min(512, Math.max(4, Math.round(peticion.compases)));

    let ocupadas = new Set<string>();
    try {
      ocupadas = new Set((await listarProyectos()).map((p) => p.slug));
    } catch {
      /* no list: the folder for the name is used */
    }
    const base = carpetaDeNombre(nombre);
    let carpeta = base;
    for (let n = 2; ocupadas.has(carpeta); n += 1) carpeta = `${base}-${n}`;

    const modo = MODE_NAMES.find((m) => m.toLowerCase() === (peticion.modo ?? "").toLowerCase());
    let proyecto = createProject({ name: nombre.slice(0, 80), bpm, lengthBars: compases, carpeta });
    if (peticion.tonica) {
      try {
        proyecto = applyOps(proyecto, [
          { op: "set_song", key: { tonic: peticion.tonica, mode: (modo ?? proyecto.key.mode) as Mode } },
        ]).project;
      } catch (error) {
        return { ok: false, texto: mensajeDe(error) };
      }
    }
    e.fijar(proyecto);
    if (previo) e.avisar(`Closed “${previo}” (still saved on disk) and opened “${nombre}”.`);
    e.avisar(`Project “${nombre}” created (folder proyectos/${carpeta}/).`);
    return {
      ok: true,
      texto:
        `Project "${nombre}" created: ${bpm} BPM, ${proyecto.key.tonic} ${proyecto.key.mode}, ${compases} bars. ` +
        `Folder: proyectos/${carpeta}/` +
        (carpeta !== base ? ` (proyectos/${base}/ already existed)` : "") +
        ". Compose with escribir_progresion and editar_proyecto; the WAV/MIDI you generate with Python go to salida/ " +
        "and come in with anadir_pistas.",
    };
  }

  /** Project summary with ids: what the agent reads before editing. */
  function leerProyecto(peticion: { clipId?: string }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: create one with crear_proyecto." };
    return { ok: true, texto: resumenParaAgente(project, peticion) };
  }

  /** Domain ops, as they are: transactional (all or none) and undoable. */
  function editarProyecto(peticion: { ops: unknown[] }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: create one with crear_proyecto." };
    try {
      const { project: siguiente, results, warnings } = applyOps(project, peticion.ops as Op[]);
      // If only the mix or devices change, the engine does not need restarting.
      const estructural = (peticion.ops as { op?: string }[]).some(
        (op) => !["set_track", "set_master", "set_device", "set_clip_length"].includes(String(op.op)),
      );
      if (estructural) e.fijar(siguiente);
      else e.enVivo(siguiente);
      const avisos = warnings
        .filter((w) => !/Pista sin clips|Proyecto sin pistas/.test(w.message))
        .slice(0, 6)
        .map((w) => `warning ${w.path}: ${w.message}`);
      return { ok: true, texto: [...results, ...avisos].join("\n") };
    } catch (error) {
      const texto = error instanceof OpError ? error.message : `Error: ${mensajeDe(error)}`;
      return { ok: false, texto: `${texto}\nNothing has been changed. Use leer_proyecto to see the ids.` };
    }
  }

  /**
   * Writes notes on a track from a bar: creates it if it does not exist and, if there
   * are already clips in that range, REPLACES them (redoing a section is normal; stacking
   * clips on top sounded double). It is the common path of escribir_progresion,
   * escribir_notas and escribir_bateria: a single transaction, a single Ctrl+Z.
   */
  function escribirEnPista(
    peticion: PeticionEscritura,
    notas: Note[],
    beats: number,
    porDefecto: InstrumentType,
  ): { ok: false; texto: string } | { ok: true; texto: string; trackId: string; clipId: string; desde: number; compases: number; sustituidos: string[] } {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: create one with crear_proyecto." };
    if (notas.length === 0) return { ok: false, texto: "There is no note to write." };
    const barBeats = beatsPerBar(project);
    const startBar = Math.max(0, Math.round((peticion.desdeCompas ?? 1) - 1));
    const compases = Math.max(1, Math.ceil(beats / barBeats - 1e-6));
    const inicio = startBar * barBeats;
    const fin = inicio + compases * barBeats;

    const ops: Op[] = [];
    const pista = pistaPorNombre(project, peticion.pista);
    let trackId = pista?.id ?? "";
    if (pista && pista.kind !== "midi") {
      return { ok: false, texto: `“${pista.name}” is an audio track: choose a MIDI one or a new name.` };
    }
    const programa =
      typeof peticion.programa === "number" && Number.isInteger(peticion.programa) && peticion.programa >= 0 && peticion.programa <= 127
        ? peticion.programa
        : undefined;
    const tipoPedido = INSTRUMENT_TYPES.find((t) => t === peticion.instrumento);
    if (!pista) {
      const instrumento: InstrumentType = tipoPedido ?? porDefecto;
      trackId = `trk_${slugDe(peticion.pista, { separador: "_", max: 24, defecto: "pista" })}_${Date.now().toString(36)}`;
      ops.push({
        op: "add_track",
        id: trackId,
        name: peticion.pista.slice(0, 60),
        kind: "midi",
        instrument: { type: instrumento, ...(programa !== undefined ? { program: programa } : {}) },
      });
    } else if ((programa !== undefined || tipoPedido) && !pista.instrument.archivo) {
      // A track with a library instrument (.sf2 archive) is not overwritten with a GM
      // program: escribir_notas usually carries `programa` out of habit.
      ops.push({
        op: "set_instrument",
        trackId,
        instrument: { ...pista.instrument, ...(tipoPedido ? { type: tipoPedido } : {}), ...(programa !== undefined ? { program: programa } : {}) },
      });
    }
    // What was already in that range is replaced, but ONLY in that range: a clip that
    // starts before or ends after keeps its outer pieces. Before, the whole clip was
    // deleted and a one-bar drum roll ate 16 bars of drums (Oct 27).
    const sustituidos: string[] = [];
    const conservados: { startBar: number; length: number; notes: Note[]; name: string }[] = [];
    for (const clip of pista?.clips ?? []) {
      const finClip = clip.start + clip.length;
      if (!(clip.start < fin - 1e-6 && finClip > inicio + 1e-6)) continue;
      ops.push({ op: "remove_clip", trackId, clipId: clip.id });
      sustituidos.push(clip.id);
      const trozo = (desde: number, hasta: number): void => {
        if (hasta - desde < 1e-6) return;
        const startBar = Math.floor(desde / barBeats + 1e-9);
        const base = startBar * barBeats;
        const notes = clip.notes
          .filter((n) => clip.start + n.start >= desde - 1e-6 && clip.start + n.start < hasta - 1e-6)
          .map((n) => ({
            ...n,
            start: Number((clip.start + n.start - base).toFixed(4)),
            duration: Number(Math.min(n.duration, hasta - (clip.start + n.start)).toFixed(4)),
          }));
        if (notes.length > 0) conservados.push({ startBar, length: hasta - base, notes, name: clip.name });
      };
      trozo(clip.start, Math.min(finClip, inicio));
      trozo(Math.max(clip.start, fin), finClip);
    }
    // add_notes accepts 2000 notes per op: long ones go in chunks to the same clip.
    const trozos: Note[][] = [];
    for (let i = 0; i < notas.length; i += 2000) trozos.push(notas.slice(i, i + 2000));
    try {
      const nombreClip = `${(peticion.nombreClip ?? peticion.pista).slice(0, 40)} ${startBar + 1}`;
      let siguiente = applyOps(project, [
        ...ops,
        { op: "add_notes", trackId, startBar, name: nombreClip, notes: trozos[0]! },
      ]).project;
      const clipId = siguiente.tracks.find((t) => t.id === trackId)?.clips.at(-1)?.id ?? "";
      for (const resto of trozos.slice(1)) {
        siguiente = applyOps(siguiente, [{ op: "add_notes", trackId, clipId, notes: resto }]).project;
      }
      // The clip lasts what the phrase says (with its trailing rests), in bars.
      siguiente = applyOps(siguiente, [{ op: "set_clip_length", trackId, clipId, lengthBeats: compases * barBeats }]).project;
      // And the pieces that were left outside the range come back, each one in its clip.
      for (const c of conservados) {
        siguiente = applyOps(siguiente, [{ op: "add_notes", trackId, startBar: c.startBar, name: c.name.slice(0, 60), notes: c.notes }]).project;
        const nuevo = siguiente.tracks.find((t) => t.id === trackId)?.clips.at(-1)?.id ?? "";
        siguiente = applyOps(siguiente, [{ op: "set_clip_length", trackId, clipId: nuevo, lengthBeats: c.length }]).project;
      }
      e.fijar(siguiente);
      return { ok: true, texto: "", trackId, clipId, desde: startBar + 1, compases, sustituidos };
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}\nNothing has been changed.` };
    }
  }

  /** Common result line: where what was written ended up. */
  function dondeQueda(r: { trackId: string; clipId: string; desde: number; compases: number; sustituidos: string[] }, notas: number): string {
    const pista = e.proyecto()?.tracks.find((t) => t.id === r.trackId);
    const instrumento = pista
      ? `${pista.instrument.type}${pista.instrument.program !== undefined ? ` GM ${pista.instrument.program}` : ""}`
      : "";
    return (
      `${notas} notes on “${pista?.name ?? r.trackId}” (${r.trackId}, ${instrumento}), clip ${r.clipId}, ` +
      `bars ${r.desde}-${r.desde + r.compases - 1}` +
      (r.sustituidos.length > 0 ? ` (replaces what was in that range from ${r.sustituidos.join(", ")}; what is outside is kept)` : "") +
      "."
    );
  }

  /** A chord progression, written as notes on a track (created if missing). */
  function escribirProgresion(peticion: PeticionProgresionPista): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: create one with crear_proyecto." };
    let resultado;
    try {
      resultado = notasDeProgresion(project.key, beatsPerBar(project), peticion);
    } catch (error) {
      return { ok: false, texto: mensajeDe(error) };
    }
    const r = escribirEnPista(peticion, resultado.notas, resultado.beats, peticion.patron === "bajo" ? "bass" : "pad");
    if (!r.ok) return r;
    return {
      ok: true,
      texto:
        `${dondeQueda(r, resultado.notas.length)} ${resultado.acordes.join(" - ")}` +
        `${(peticion.repeticiones ?? 1) > 1 ? ` ×${peticion.repeticiones}` : ""} · pattern ${peticion.patron ?? "bloque"} · ` +
        `key ${project.key.tonic} ${project.key.mode}.`,
    };
  }

  /** Melody, bass or any line in compact notation (see src/core/notacion.ts). */
  function escribirNotas(peticion: PeticionNotas): ResultadoAccion {
    let leido;
    try {
      leido = leerNotacion(peticion.notas, peticion.velocidad ?? 90);
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}. Nothing has been changed.` };
    }
    const proyecto = e.proyecto();
    const irregulares = proyecto ? tramosIrregulares(leido.tramos, beatsPerBar(proyecto)) : [];
    if (irregulares.length > 0) {
      return {
        ok: false,
        texto:
          `The bars do not add up: ${irregulares.join("; ")}. Fix the durations (or remove the bar line if ` +
          "the range spans several bars). Nothing has been changed.",
      };
    }
    const repeticiones = Math.max(1, Math.min(64, Math.round(peticion.repeticiones ?? 1)));
    const notas: Note[] = [];
    for (let v = 0; v < repeticiones; v += 1) {
      for (const n of leido.notas) notas.push({ ...n, start: Number((n.start + v * leido.beats).toFixed(4)) });
    }
    const r = escribirEnPista(peticion, notas, leido.beats * repeticiones, "lead");
    if (!r.ok) return r;
    const alturas = notas.map((n) => n.pitch);
    return {
      ok: true,
      texto: `${dondeQueda(r, notas.length)} Range ${nombreDeNota(Math.min(...alturas))}-${nombreDeNota(Math.max(...alturas))}.`,
    };
  }

  /** Drums in a grid (see src/core/bateria.ts). */
  function escribirBateria(peticion: PeticionBateriaPista): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project: create one with crear_proyecto." };
    let resultado;
    try {
      resultado = notasDeBateria(peticion, beatsPerBar(project));
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}. Nothing has been changed.` };
    }
    const r = escribirEnPista({ ...peticion, instrumento: peticion.instrumento ?? "drumkit" }, resultado.notas, resultado.beats, "drumkit");
    if (!r.ok) return r;
    return { ok: true, texto: `${dondeQueda(r, resultado.notas.length)} Pieces: ${Object.keys(peticion.patrones).join(", ")}.` };
  }

  /**
   * Moves faders by track name: this is how the agent applies a mix.
   *
   * It goes through ops (set_track), so it is a normal project change: it enters the
   * history, it is undone with Ctrl+Z and it does not restart the engine (commitLive).
   */
  function ajustarPistas(peticion: { pistas: AjustePista[] }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project." };

    const ops: Op[] = [];
    const hechas: string[] = [];
    const faltan: string[] = [];

    for (const ajuste of peticion.pistas) {
      if (ajuste.nombre.trim() === "") continue;
      // A partial name only works if it belongs to ONE track: before, "Bajo" moved the
      // fader of the first one that contained it even if there were "Bajo 1" and "Bajo 2".
      const pista = pistaPorNombre(project, ajuste.nombre);
      if (!pista) {
        faltan.push(ajuste.nombre);
        continue;
      }
      const op: Op = { op: "set_track", trackId: pista.id };
      const cambios: string[] = [];
      if (typeof ajuste.gainDb === "number" && Number.isFinite(ajuste.gainDb)) {
        op.gainDb = Math.min(12, Math.max(-60, ajuste.gainDb));
        cambios.push(`${op.gainDb >= 0 ? "+" : ""}${op.gainDb.toFixed(1)} dB`);
      }
      if (typeof ajuste.pan === "number" && Number.isFinite(ajuste.pan)) {
        op.pan = Math.min(1, Math.max(-1, ajuste.pan));
        cambios.push(`pan ${op.pan.toFixed(2)}`);
      }
      if (typeof ajuste.muted === "boolean") {
        op.muted = ajuste.muted;
        cambios.push(ajuste.muted ? "mute" : "no mute");
      }
      if (typeof ajuste.solo === "boolean") {
        op.solo = ajuste.solo;
        cambios.push(ajuste.solo ? "solo" : "no solo");
      }
      if (cambios.length === 0) continue;
      ops.push(op);
      hechas.push(`${pista.name}: ${cambios.join(", ")}`);
    }

    if (ops.length > 0) {
      try {
        e.enVivo(applyOps(project, ops).project);
      } catch (error) {
        return {
          ok: false,
          texto: `Could not adjust: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const partes: string[] = [];
    if (hechas.length > 0) partes.push(`Adjusted ${hechas.length} track(s):\n${hechas.join("\n")}`);
    if (faltan.length > 0) {
      const nombres = project.tracks.map((t) => t.name).join(", ");
      partes.push(
        nombres === ""
          ? `I cannot find: ${faltan.join(", ")}. The project has no tracks yet.`
          : `I cannot find: ${faltan.join(", ")}. The tracks are: ${nombres}.`,
      );
    }
    if (partes.length === 0) partes.push("There was nothing to change.");
    return { ok: hechas.length > 0, texto: partes.join("\n\n") };
  }

  /**
   * A library instrument, converted to SoundFont and put as a track.
   * The .sf2 comes with its 46 regions and the root note declared by the SFZ, which is
   * what avoids the "sounds like a harmonic" of stretching a single sample.
   */
  async function instrumentar(peticion: { sfz: string; nombre: string; pista?: string }): Promise<ResultadoAccion> {
    // It is checked BEFORE converting: otherwise a 46-region SFZ was converted for
    // nothing and then it warned that there was no project.
    if (!e.proyecto()) return { ok: false, texto: "Open or create a project before adding an instrument." };
    try {
      const res = await fetch("/api/instrumentos/crear", {
        method: "POST",
        headers: cabecerasProyecto({ "Content-Type": "application/json" }),
        body: JSON.stringify(peticion),
      });
      const datos = (await res.json()) as {
        ok?: boolean;
        archivo?: string;
        zonas?: number;
        notas?: number[];
        error?: string;
        sfz?: string;
      };
      if (!datos.ok || !datos.archivo) {
        return { ok: false, texto: `Could not convert: ${datos.error ?? res.status}` };
      }
      const project = e.proyecto();
      if (!project) return { ok: false, texto: "The project was closed while the instrument was being converted." };
      const sonido = (datos.sfz ?? peticion.sfz).split("/").pop()!.replace(/\.sfz$/i, "");
      const instrumento = { type: "soundfont" as const, preset: sonido.slice(0, 64), archivo: datos.archivo };
      const notas = datos.notas ?? [];
      const rango = notas.length === 2 ? ` (sounds from ${nombreDeNota(notas[0]!)} to ${nombreDeNota(notas[1]!)})` : "";
      if (peticion.pista) {
        const despues = applyOps(project, [{ op: "set_instrument", trackId: peticion.pista, instrument: instrumento }]);
        e.fijar(despues.project);
        return {
          ok: true,
          texto: `${despues.results.join(" ")}: “${sonido}”, ${datos.zonas ?? 0} zones${rango}. The track's notes are kept.`,
        };
      }
      const nombre = (peticion.nombre || sonido).slice(0, 60);
      const despues = applyOps(project, [{ op: "add_track", name: nombre, kind: "midi", instrument: instrumento }]).project;
      e.fijar(despues);
      const pista = despues.tracks.at(-1);
      return {
        ok: true,
        texto:
          `Instrument “${sonido}” ready: ${datos.zonas ?? 0} zones${rango} in ${datos.archivo}. ` +
          `Track ${pista ? `“${pista.name}” (${pista.id})` : ""} created: write its notes with escribir_notas ` +
          `or escribir_progresion (pista = its id).`,
      };
    } catch (error) {
      return { ok: false, texto: `Could not convert: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  /**
   * Project snapshots taken at the start of each turn (main.ts, guardarVersion):
   * `listar` shows them; `restaurar` copies the requested tracks (or everything) from one.
   */
  async function versiones(peticion: { accion: string; version?: string; pistas?: string[] }): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "There is no open project." };
    const carpeta = `proyectos/${carpetaDeProyecto(project)}/${CARPETA_VERSIONES}`;
    try {
      const lista = await fetch(`/api/fs/list?carpeta=${encodeURIComponent(carpeta)}`, { headers: cabecerasProyecto() });
      const datos = (await lista.json()) as { ficheros?: { path: string }[] };
      const nombres = (datos.ficheros ?? [])
        .map((f) => f.path.split("/").pop() ?? "")
        .filter((n) => n.endsWith(".json"))
        .sort()
        .reverse();
      if (nombres.length === 0) {
        return { ok: true, texto: "There are no versions yet: one is saved at the start of each turn." };
      }
      if (peticion.accion !== "restaurar") {
        return {
          ok: true,
          texto:
            `${nombres.length} version(s), from the newest to the oldest. Each one is the project BEFORE the ` +
            `request shown:\n` +
            nombres.slice(0, 30).map((n, i) => `${i + 1}. ${n} (${describirVersion(n)})`).join("\n"),
        };
      }
      const pedida = (peticion.version ?? "").trim();
      const nombre = /^\d{1,2}$/.test(pedida) ? nombres[Number(pedida) - 1] : nombres.find((n) => n === pedida || n.startsWith(pedida));
      if (!nombre) {
        return { ok: false, texto: `I cannot find version “${pedida}”. Use versiones with accion=listar and pass its name or number.` };
      }
      const res = await fetch("/api/fs/read", {
        method: "POST",
        headers: cabecerasProyecto({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: `${carpeta}/${nombre}` }),
      });
      if (!res.ok) return { ok: false, texto: `Could not read ${nombre} (HTTP ${res.status}).` };
      const { contenido } = (await res.json()) as { contenido: string };
      const antigua = interpretarProyectoEnDisco(contenido).proyecto;
      const { project: siguiente, hechas } = restaurarVersion(project, antigua, peticion.pistas ?? []);
      e.fijar(siguiente);
      return {
        ok: true,
        texto: `From ${nombre} (${describirVersion(nombre)}):\n${hechas.join("\n")}\nIt is undone with Ctrl+Z.`,
      };
    } catch (error) {
      return { ok: false, texto: `Error with the versions: ${mensajeDe(error)}` };
    }
  }

  async function exportar(peticion: { midi: boolean; wav: boolean }): Promise<ResultadoAccion> {
    if (!e.exportar) return { ok: false, texto: "This tab does not know how to export." };
    if (!peticion.midi && !peticion.wav) return { ok: false, texto: "Ask for midi, wav or both." };
    return e.exportar(peticion);
  }

  async function escuchar(opciones: { pistas?: string[]; compasesPorTramo?: number }): Promise<ResultadoAccion> {
    if (!e.escuchar) return { ok: false, texto: "This tab does not know how to listen to the mix." };
    return e.escuchar(opciones);
  }

  return {
    exportar,
    escuchar,
    versiones,
    leerProyecto,
    editarProyecto,
    escribirProgresion,
    escribirNotas,
    escribirBateria,
    crearProyecto,
    anadirPistas: importarPistas,
    ajustarPistas,
    igualarClips,
    crearSonido,
    usarSample,
    usarInstrumento: instrumentar,
  };
}

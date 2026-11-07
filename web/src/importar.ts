/** Everything that enters from outside: project files, audio and MIDI, from "Open", "Audio" or drag and drop. */

import type { Project } from "../../src/core/types.ts";
import { beatsPerBar } from "../../src/core/types.ts";
import { carpetaDeNombre, carpetaDeProyecto, carpetaLibre, createProject } from "../../src/core/project.ts";
import { compasesDeAudio } from "../../src/core/tiempo.ts";
import { applyOps } from "../../src/core/ops.ts";
import { interpretarProyectoEnDisco, nombreDeProyectoDesdeFicheros, rutaDeProyecto } from "../../src/core/proyecto-archivo.ts";
import { audioAssets, cargarWavDeDisco, hidratarAssets, idDeAsset, opsDeAudio } from "./audio-store.ts";
import { importProjectBundle } from "./project-bundle.ts";
import { leerProyectoDeDisco, listarProyectos, subirAudio } from "./proyecto-disco.ts";
import { esAudio, esMidi } from "./clasificar.ts";
import { pistasDesdeMidi } from "./importar-midi.ts";
import type { Sesion } from "./sesion.ts";
import type { Avisos } from "./avisos.ts";

type DestinoAudio = "anadir" | "nuevo" | "cancelar";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** RAM taken up by the audio already decoded (interleaved Float32). */
function ramAudioBytes(): number {
  let total = 0;
  for (const asset of audioAssets.values()) {
    if (asset.buffer) total += asset.buffer.length * asset.buffer.numberOfChannels * 4;
  }
  return total;
}

export function crearImportador(d: {
  sesion: Sesion;
  avisos: Avisos;
  beatActual: () => number;
  avisarFaltan: (faltan: string[]) => void;
}) {
  const { sesion, avisos } = d;

  /** Folders taken: those on disk and the open project's, which may not be written yet. */
  async function carpetasOcupadas(): Promise<Set<string>> {
    const ocupadas = new Set((await listarProyectos()).map((p) => p.slug));
    if (sesion.project) ocupadas.add(carpetaDeProyecto(sesion.project));
    return ocupadas;
  }

  /** If the list cannot be read this throws: better no import than overwriting a project. */
  async function proyectoNuevo(nombre: string): Promise<Project> {
    const carpeta = carpetaLibre(carpetaDeNombre(nombre), await carpetasOcupadas());
    return createProject({ name: nombre, bpm: 120, lengthBars: 32, carpeta });
  }

  /**
   * A project file keeps its folder only if that folder is free or holds this same project
   * (same id: reopening your own file). Otherwise it would overwrite someone else's.
   */
  async function fijarCarpetaAlAbrir(parsed: Project): Promise<void> {
    const carpeta = carpetaDeProyecto(parsed);
    const ocupadas = await carpetasOcupadas();
    if (!ocupadas.has(carpeta)) return;
    if (sesion.project && carpetaDeProyecto(sesion.project) === carpeta) {
      if (sesion.project.id === parsed.id) return;
    } else {
      try {
        if (interpretarProyectoEnDisco(await leerProyectoDeDisco(rutaDeProyecto(carpeta))).proyecto.id === parsed.id) return;
      } catch {
        /* unreadable: treated as somebody else's, so it is not overwritten */
      }
    }
    const libre = carpetaLibre(carpeta, ocupadas);
    parsed.meta = { ...parsed.meta, carpeta: libre };
    avisos.info(`The folder proyectos/${carpeta}/ belongs to another project: “${parsed.name}” opens in proyectos/${libre}/.`);
  }

  /** Copies the .mid to entrada/, reads its tracks and adds them through ops, so it can be undone. */
  async function importarMidi(file: File): Promise<void> {
    if (!sesion.ready) return;
    sesion.setBusy(true, `Reading ${file.name}…`);
    try {
      // A new project opens only when the file has given tracks: a bad .mid leaves nothing open.
      const nuevo = !sesion.project;
      const base = sesion.project ?? (await proyectoNuevo(nombreDeProyectoDesdeFicheros([file]).slice(0, 40) || "MIDI"));
      const { path } = await subirAudio(file, carpetaDeProyecto(base));
      const { project, hechas, avisos: notas } = await pistasDesdeMidi(base, path, 0, nuevo);
      if (hechas.length > 0) {
        sesion.setProject(project);
        avisos.info(`MIDI “${file.name}” imported${nuevo ? ` at its tempo, ${project.bpm} BPM` : ""}.`);
        for (const nota of notas) avisos.error(nota);
      } else {
        avisos.error(`“${file.name}” has no tracks with notes.`);
      }
    } catch (error) {
      avisos.error(
        `Could not read “${file.name}”: ${error instanceof Error ? error.message : String(error)}. ` +
          "It has to be a standard MIDI file (.mid); if it is a .midi from some odd program, export it again.",
      );
    } finally {
      sesion.setBusy(false);
    }
  }

  /**
   * One track per file, at the current bar. Each file is first copied to
   * `proyectos/<slug>/entrada/`: the project references its WAVs by path, not by bytes.
   */
  async function importarAudio(files: File[], destino: "anadir" | "nuevo" = "anadir"): Promise<void> {
    if (!sesion.ready || files.length === 0) return;
    const nuevo = destino === "nuevo" || !sesion.project;
    const LIMITE_RAM = 900 * 1024 * 1024; // ~900 MB: above this the browser crashes
    const nombreNuevo = nombreDeProyectoDesdeFicheros(files);
    sesion.setBusy(true, nuevo ? `Creating “${nombreNuevo}”…` : "Importing audio…");
    try {
      let current: Project = nuevo ? await proyectoNuevo(nombreNuevo) : (sesion.project as Project);
      const slug = carpetaDeProyecto(current);
      let cortado = false;
      const sinDisco: string[] = [];
      let metidos = 0;
      const bar = nuevo ? 0 : Math.floor(d.beatActual() / beatsPerBar(current));

      for (const file of files) {
        if (ramAudioBytes() > LIMITE_RAM) {
          cortado = true;
          break;
        }
        let ruta = "";
        try {
          ruta = (await subirAudio(file, slug)).path;
        } catch (error) {
          sinDisco.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`);
          continue;
        }
        const nombre = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Audio";
        // The bytes in hand serve only for a WAV: anything else was converted by the server and is read back.
        const mismo = /\.wav$/i.test(file.name);
        const asset = await cargarWavDeDisco({ id: idDeAsset(nombre), name: nombre, ruta, slug, bpm: current.bpm, ...(mismo ? { fichero: file } : {}) });
        current = applyOps(
          current,
          opsDeAudio(current, {
            assetId: asset.id,
            nombre,
            durationBeats: asset.durationBeats,
            ruta,
            startBar: bar,
            lengthBeats: compasesDeAudio(asset.durationBeats, beatsPerBar(current)),
            reemplazar: false,
          }),
        ).project;
        metidos++;
      }

      // Nothing came in: a new project would open empty, over whatever the person had in mind.
      if (metidos === 0) {
        for (const fallo of sinDisco) avisos.error(`Could not import: ${fallo}`);
        return;
      }
      sesion.setProject(current);
      avisos.info(
        nuevo
          ? `New project “${current.name}” at ${current.bpm} BPM with ${metidos} audio file(s) copied to proyectos/${slug}/entrada/, one per track.`
          : `${metidos} audio file(s) copied to proyectos/${slug}/entrada/ and added at bar ${bar + 1}, one per track.`,
      );
      if (cortado) {
        avisos.error(`Stopped at ${Math.round(ramAudioBytes() / 1048576)} MB of audio in memory (~900 MB limit): import the remaining stems in another batch.`);
      }
      for (const fallo of sinDisco) avisos.error(`Could not copy to disk: ${fallo}`);
    } catch (error) {
      avisos.error(`Could not import: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      sesion.setBusy(false);
    }
  }

  function preguntarDestinoAudio(files: File[]): Promise<DestinoAudio> {
    const dialogo = $<HTMLDialogElement>("dialogo-audio");
    const nombre = nombreDeProyectoDesdeFicheros(files);
    $("audio-anadir").textContent = `Add to “${sesion.project?.name ?? "—"}”`;
    $("audio-nuevo").textContent = `New project “${nombre}”`;
    $("dialogo-audio-detalle").textContent =
      `${files.length} file(s). “Add” puts them in the open project, at the cursor bar; ` +
      `“New project” starts from scratch with the folder name (${nombre}).`;

    return new Promise((resolver) => {
      let contestado = false;
      const terminar = (valor: DestinoAudio): void => {
        if (contestado) return;
        contestado = true;
        dialogo.close();
        resolver(valor);
      };
      // onclick/oncancel are reassigned (not accumulated) on each opening.
      $("audio-anadir").onclick = () => terminar("anadir");
      $("audio-nuevo").onclick = () => terminar("nuevo");
      $("audio-cancelar").onclick = () => terminar("cancelar");
      dialogo.oncancel = (event) => {
        event.preventDefault();
        terminar("cancelar");
      };
      dialogo.onclose = () => {
        if (!contestado) {
          contestado = true;
          resolver("cancelar");
        }
      };
      dialogo.showModal();
    });
  }

  async function importarAudioDesdeSelector(files: File[]): Promise<void> {
    if (files.length === 0) return;
    const destino: DestinoAudio = sesion.project ? await preguntarDestinoAudio(files) : "nuevo";
    if (destino === "cancelar") return;
    await importarAudio(files, destino);
  }

  async function abrirFicheroDeProyecto(file: File): Promise<void> {
    sesion.setBusy(true, "Loading project…");
    sesion.restoring = true;
    try {
      let parsed: Project;
      const notas: string[] = [];
      if (/\.(miuzika\.)?zip$/i.test(file.name)) {
        // The bundle's WAVs are written into the project folder: it becomes an on-disk project.
        const imported = await importProjectBundle(file);
        parsed = imported.project;
        notas.push(...imported.warnings);
        await fijarCarpetaAlAbrir(parsed);
        const slug = carpetaDeProyecto(parsed);
        parsed.audioAssets ??= [];
        for (const wav of imported.wavs) {
          try {
            const ficha = new File([wav.data as unknown as BlobPart], wav.nombre, { type: "audio/wav" });
            const { path } = await subirAudio(ficha, slug);
            const asset = parsed.audioAssets.find((candidato) => candidato.id === wav.assetId);
            if (asset) asset.ruta = path;
            else parsed.audioAssets.push({ id: wav.assetId, name: wav.nombre, durationBeats: 1, ruta: path });
          } catch (error) {
            notas.push(`Could not copy ${wav.nombre} to the project: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      } else {
        // A .json can be a master file, a loose bundle or a Project.
        parsed = interpretarProyectoEnDisco(await file.text()).proyecto;
        await fijarCarpetaAlAbrir(parsed);
      }
      const { faltan } = await hidratarAssets(parsed, carpetaDeProyecto(parsed));
      sesion.setProject(parsed);
      avisos.info(`Opened “${parsed.name}”. Its WAVs are looked up in proyectos/${carpetaDeProyecto(parsed)}/ using each asset's path.`);
      for (const nota of notas) avisos.error(nota);
      d.avisarFaltan(faltan);
    } catch (error) {
      avisos.error(`Could not open: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      sesion.restoring = false;
      sesion.setBusy(false);
    }
  }

  /** Distributes a selection: the project first, because the tracks need somewhere to go. */
  async function abrirArchivos(todos: File[]): Promise<void> {
    if (!sesion.ready || todos.length === 0) return;
    const audios = todos.filter((file) => esAudio(file));
    const midis = todos.filter((file) => !esAudio(file) && esMidi(file));
    const proyectos = todos.filter((file) => !esAudio(file) && !esMidi(file));
    if (proyectos.length > 1) avisos.error(`Only one project can be opened at a time: using “${proyectos[0]!.name}”.`);
    if (proyectos.length > 0) await abrirFicheroDeProyecto(proyectos[0]!);
    for (const midi of midis) await importarMidi(midi);
    if (audios.length > 0) await importarAudioDesdeSelector(audios);
  }

  return { abrirArchivos };
}

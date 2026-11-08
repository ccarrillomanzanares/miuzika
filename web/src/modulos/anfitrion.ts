/**
 * What the main GUI offers a module, and all a module may do to the project: read it, render
 * some tracks and hand in audio. The GUI knows nothing of what a module generates. Carlos, 6-Nov:
 * the app is modular and the GUI is the ground where each module leaves its result.
 */

import type { Project } from "../../../src/core/types.ts";
import { beatsPerBar } from "../../../src/core/types.ts";
import { applyOps, type Op } from "../../../src/core/ops.ts";
import { carpetaDeNombre, carpetaDeProyecto, carpetaLibre, createProject } from "../../../src/core/project.ts";
import { largoDeClip } from "../../../src/core/tiempo.ts";
import { cargarWavDeDisco, idDeAsset, opsDeAudio } from "../audio-store.ts";
import { listarProyectos } from "../proyecto-disco.ts";
import { pistasDesdeMidi } from "../importar-midi.ts";
import type { Avisos } from "../avisos.ts";
import type { FuenteRenderizada, OpcionesFuente } from "../exportar.ts";
import type { Sesion } from "../sesion.ts";

export interface EntregaAudio {
  /** The project folder the files are in. */
  carpeta: string;
  /** For a project that does not exist yet. */
  nombreProyecto: string;
  /** The first generation in a project without tracks sets its tempo and key. */
  bpm: number | null;
  tonalidad: string;
  /** Bar where the audio starts, from 1. */
  inicioCompas: number;
  /**
   * Bars the clip lasts, when the module asked the model for more than it wants placed (the
   * margin, 7-Nov). The WAV keeps everything; only the clip is shorter. Null = the whole file.
   */
  compases?: number | null;
  tomas: { ruta: string; nombre: string; silenciada: boolean }[];
}

export interface Anfitrion {
  proyecto(): Project | null;
  avisos: Avisos;
  carpetaParaNuevo(nombre: string): Promise<string>;
  renderizarPistas(opciones: OpcionesFuente): Promise<FuenteRenderizada>;
  entregarAudio(entrega: EntregaAudio): Promise<boolean>;
  /** .mid files already in the project folder become MIDI tracks at bar 1 (8-Nov: MuLaCover's transcription). */
  entregarMidi(entrega: { carpeta: string; rutas: string[] }): Promise<string[]>;
  /** Settings, for a module that finds the GPU not configured. Resolves when it closes. */
  abrirAjustes(): Promise<void>;
}

export function crearAnfitrion(d: {
  sesion: Sesion;
  avisos: Avisos;
  renderizarFuente: (opciones: OpcionesFuente) => Promise<FuenteRenderizada>;
  abrirAjustes: () => Promise<void>;
}): Anfitrion {
  const { sesion, avisos } = d;

  /** The tempo and key of a project still without tracks; the audio placed after follows them. */
  function ajustarVacio(base: Project, entrega: EntregaAudio): Project {
    if (base.tracks.length > 0) return base;
    const ops: Op[] = [];
    if (entrega.bpm !== null) ops.push({ op: "set_song", bpm: entrega.bpm });
    if (entrega.tonalidad.trim() !== "") ops.push({ op: "set_song", key: entrega.tonalidad.trim() });
    try {
      return applyOps(base, ops).project;
    } catch (error) {
      avisos.error(`The project keeps its tempo and key: ${error instanceof Error ? error.message : String(error)}`);
      return base;
    }
  }

  return {
    proyecto: () => sesion.project,
    avisos,
    abrirAjustes: d.abrirAjustes,

    async carpetaParaNuevo(nombre) {
      const ocupadas = new Set((await listarProyectos()).map((p) => p.slug));
      return carpetaLibre(carpetaDeNombre(nombre), ocupadas);
    },

    renderizarPistas: (opciones) => d.renderizarFuente(opciones),

    async entregarAudio(entrega) {
      const abierto = sesion.project;
      // The person may have moved on during a run of minutes: their project is not touched.
      if (abierto && carpetaDeProyecto(abierto) !== entrega.carpeta) {
        avisos.error(
          `The take is in proyectos/${entrega.carpeta}/generado/, but another project is open now: ` +
            "open that project and import the WAV from there. Nothing was added here.",
        );
        return false;
      }
      const nuevo = !abierto;
      let actual = abierto ?? createProject({ name: entrega.nombreProyecto, bpm: 120, lengthBars: 8, carpeta: entrega.carpeta });
      actual = ajustarVacio(actual, entrega);
      for (const toma of entrega.tomas) {
        const asset = await cargarWavDeDisco({ id: idDeAsset(toma.nombre), name: toma.nombre, ruta: toma.ruta, slug: entrega.carpeta, bpm: actual.bpm });
        actual = applyOps(
          actual,
          opsDeAudio(actual, {
            assetId: asset.id,
            nombre: toma.nombre,
            durationBeats: asset.durationBeats,
            ruta: toma.ruta,
            startBar: Math.max(0, entrega.inicioCompas - 1),
            lengthBeats: largoDeClip(asset.durationBeats, beatsPerBar(actual), entrega.compases ?? null),
            reemplazar: false,
          }),
        ).project;
        if (toma.silenciada) {
          actual = applyOps(actual, [{ op: "set_track", trackId: actual.tracks.at(-1)!.id, muted: true }]).project;
        }
      }
      // A run ends while the person may be listening: the engine goes on from where it was.
      if (nuevo) sesion.setProject(actual);
      else sesion.commitLive(actual, true);
      return true;
    },

    async entregarMidi(entrega) {
      const abierto = sesion.project;
      // Called right after entregarAudio, which opened the project if there was none.
      if (!abierto || carpetaDeProyecto(abierto) !== entrega.carpeta) {
        avisos.error(`The MIDI files are in proyectos/${entrega.carpeta}/generado/, but that project is not open: import them from there.`);
        return [];
      }
      let actual = abierto;
      const hechas: string[] = [];
      for (const ruta of entrega.rutas) {
        try {
          const r = await pistasDesdeMidi(actual, ruta, 0, false);
          actual = r.project;
          hechas.push(...r.hechas);
          for (const nota of r.avisos) avisos.error(nota);
        } catch (error) {
          avisos.error(`${ruta}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (hechas.length > 0) sesion.commitLive(actual, true);
      return hechas;
    },
  };
}

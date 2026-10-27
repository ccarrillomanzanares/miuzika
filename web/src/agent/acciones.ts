/**
 * Acciones del agente sobre el proyecto abierto.
 *
 * Son las herramientas que CAMBIAN o LEEN el proyecto: se ejecutan en la pestaña
 * porque la pestaña es la única que escribe `proyecto.json`. Antes vivían en
 * `main.ts` (que además pintaba, reproducía, guardaba y arrancaba la app); aquí
 * dependen sólo de `Estudio`, un contrato pequeño con lo que necesitan del resto.
 *
 * Todas cambian el proyecto con ops (`applyOps`): son transaccionales, se validan
 * y se deshacen con Ctrl+Z igual que una edición a mano.
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

/** Lo que las acciones necesitan de la app. Lo implementa main.ts. */
export interface Estudio {
  /** El proyecto abierto (o null). */
  proyecto(): Project | null;
  /** Estado nuevo con historial; reinicia el engine (pistas o clips nuevos). */
  fijar(siguiente: Project): void;
  /** Cambio en vivo (mezcla, longitudes): con historial, sin reiniciar el engine. */
  enVivo(siguiente: Project): void;
  /** Aviso en el chat para la persona (no para el modelo). */
  avisar(texto: string): void;
}

/** Nombre de proyecto a partir del fichero entregado (salida/sacramento_multitrack.mid -> sacramento). */
export function nombreDesdeRuta(ruta: string): string {
  const base = (ruta.split("/").pop() ?? "proyecto").replace(/\.[^.]+$/, "");
  const limpio = base
    .replace(/^midi_/i, "")
    .replace(/_(multitrack|master|mix|stems?)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return (limpio || base || "proyecto").slice(0, 40);
}

/** Pista por id, por nombre (sin tildes ni mayúsculas) o por parte del nombre si es única. */
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
   * Crea pistas reales en el proyecto desde ficheros de workspace/: los .mid como
   * pistas MIDI con sus notas y los .wav como pistas de audio. Reutiliza el mismo
   * camino que el importador de «Audio» (loadAudioFile -> persistAudioAsset -> ops).
   */
  async function importarPistas(
    peticion: PeticionPistas,
  ): Promise<ResultadoAccion> {
    const inicio = Math.max(0, Math.min(511, Math.trunc(peticion.inicioCompas)));
    const MAX_NOTAS = 2000; // tope de la op add_notes
    const hechas: string[] = [];
    const fallos: string[] = [];
    /**
     * La duracion de una toma se cuenta en COMPASES, no en segundos de fichero: asi
     * el MIDI (que acaba en su ultima nota) y el WAV (que lleva cola) del mismo
     * instrumento acaban en el mismo compas. Si el agente no la dice, se toma la del
     * audio, que es lo que dura el material.
     */
    const compasesToma = peticion.compases && peticion.compases > 0 ? Math.trunc(peticion.compases) : 0;
    const clipsMidi: { trackId: string; clipId: string }[] = [];
    let largoAudio = 0;
    const avisos: string[] = [];

    // 1) sin proyecto hace falta el nombre ANTES de leer nada: la carpeta del
    //    proyecto es lo que permite resolver 'salida/...'. Se crea provisional y
    //    luego se ajustan tempo y compases con set_song.
    let creadoAqui = false;
    if (!e.proyecto()) {
      if (!peticion.nombreProyecto) {
        const sugerencia = nombreDesdeRuta(peticion.midis[0] ?? peticion.wavs[0] ?? "");
        return {
          ok: false,
          texto:
            "No hay proyecto abierto y no me has dado nombre. PREGUNTA al usuario como quiere llamar el " +
            "proyecto" +
            (sugerencia ? ` (sugerencia: "${sugerencia}")` : "") +
            " y vuelve a llamar con nombre_proyecto. No inventes el nombre.",
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

    // 2) leer los MIDI (la carpeta del proyecto ya existe, asi que 'salida/...' resuelve)
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

    // 3) si no hay proyecto, no hay donde colgar las pistas
    const project = e.proyecto();
    if (!project) {
      return { ok: false, texto: "No se pudo crear el proyecto." };
    }

    let current: Project = project;

    // 4) si lo hemos creado aqui, ajustamos tempo y compases al material real
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

    // Un MIDI a 90 BPM dentro de un proyecto a 120 no suena "mal": suena a 120, porque
    // las notas son beats. Sin este aviso parece que el fichero venia roto.
    if (!creadoAqui && material.length > 0) {
      for (const bloque of material) {
        if (Math.abs(bloque.bpm - current.bpm) > 0.5) {
          avisos.push(
            `${bloque.ruta}: el MIDI esta a ${bloque.bpm} BPM y el proyecto a ${current.bpm}. ` +
              "Las notas se colocan en beats, asi que sonaran mas rapidas o mas lentas; " +
              "si quieres el tempo del fichero, cambia el del proyecto.",
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
          // Familias de General MIDI (programa 0-127): bajos 32-39, solistas 80-87, pads 88-95.
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
              // Los trozos siguen en el MISMO clip: si no, cada trozo crea un clip
              // nuevo desde el compas inicial y se solapan (Bateria: 2376 notas).
              const clipId = current.tracks.find((t) => t.id === id)?.clips.at(-1)?.id;
              current = applyOps(current, [
                { op: "add_notes", trackId: id, clipId, notes: trozo },
              ]).project;
            }
          }
          hechas.push(`${nombre} (MIDI, ${pista.notes.length} notas)`);
        }
      }
    }

    // prefijo comun de los WAV, para que las pistas no se llamen "tema_bateria"
    // Prefijo a quitar de los nombres: el del fichero comun y, si no hay varios,
    // el del propio proyecto ("sacramento_bajo.wav" -> "bajo").
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

        // Los stems largos NO se decodifican: streaming con <audio> y picos del
        // servidor. Asi caben muchos a la vez (la RAM no crece con la duracion).
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
                  // Reimportar REEMPLAZA los clips de esa pista: asi se corrige una
                  // tanda mal recortada sin acabar con dos pistas iguales.
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
              `${nombre}: pediste ${compasesToma} compases pero el WAV dura ${durationBeats.toFixed(1)} beats ` +
                `(${(durationBeats / beatsPerBar(current)).toFixed(2)} compases). El clip se queda en lo que hay.`,
            );
          }
          largoAudio = Math.max(
            largoAudio,
            compasesToma > 0 ? compasesToma * beatsPerBar(current) : compasesDeAudio(durationBeats, beatsPerBar(current)),
          );
          hechas.push(
            `${nombre} (audio streaming, ${durationBeats.toFixed(1)} beats, sin decodificar)`,
          );
          continue;
        }

        const res = await fetch(`/api/audio?path=${encodeURIComponent(rutaEnProyecto(ruta, carpetaDeProyecto(project)))}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const file = new File([blob], fichero, { type: "audio/wav" });
        // El asset apunta a su ruta en disco: el proyecto es portable sin más.
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
            `${nombre}: pediste ${compasesToma} compases pero el WAV dura ${asset.durationBeats.toFixed(1)} beats. ` +
              "El clip se queda en lo que hay.",
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

    // La toma entera mide lo mismo: compases dichos por el agente o, si no, lo que
    // dura el audio. Los clips MIDI se estiran hasta ahi (nunca se recortan: sus
    // notas ya caben dentro).
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
      e.avisar(`Pistas anadidas al proyecto: ${hechas.length}.`);
    }
    const texto = [
      hechas.length > 0 ? `Anadidas ${hechas.length} pistas:` : "No se anadio ninguna pista.",
      ...hechas.map((linea) => `- ${linea}`),
      ...(fallos.length > 0 ? ["Fallos:", ...fallos.map((linea) => `- ${linea}`)] : []),
      ...avisos,
      // El mismo material dos veces suena doble: se avisa en el acto, no después.
      ...(peticion.midis.length > 0 && peticion.wavs.length > 0
        ? [
            "AVISO: has anadido MIDI y WAV del mismo tema. Suenan los dos a la vez (doble nivel y fase). " +
              "Pregunta al usuario cual dejar y silencia el otro juego con ajustar_pistas.",
          ]
        : []),
    ].join("\n");
    return { ok: hechas.length > 0, texto };
  }

  /**
   * Crea un sonido desde el chat: receta -> script -> render -> medida -> disco.
   *
   * La voz y sus parametros salen del catalogo del motor (/api/voces), las palabras
   * del vocabulario humano, y el resultado se guarda con su ficha en
   * proyectos/<slug>/sonidos/, asi que se puede repetir y volver a escuchar.
   */
  async function crearSonido(
    peticion: PeticionSonido,
  ): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) {
      return { ok: false, texto: "No hay proyecto abierto: crea uno primero (su carpeta es donde vive el sonido)." };
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
        texto: `No pude leer el catalogo del motor: ${error instanceof Error ? error.message : String(error)}`,
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
      avisos.push("Esta voz renderiza en la GPU: usa Lambda (1,29 $/h si esta apagada, ~3 min de arranque).");
    }

    if (peticion.palabras && peticion.palabras.length > 0) {
      const conPalabras = aplicarPalabras(receta, peticion.palabras, vozPorClave(catalogo, receta.voz));
      receta = conPalabras.receta;
      avisos.push(...conPalabras.avisos, ...conPalabras.descartadas.map((d) => d.motivo));
    }

    const rutaScript = rutaScriptDeSonido(receta);
    // El slug va explícito: `cabecerasProyecto()` depende de que el agente haya
    // llamado antes a setProyectoActivo y, si no, el fichero acaba en «sin-proyecto».
    const escribir = (ruta: string, contenido: string): Promise<Response> =>
      fetch("/api/fs/write", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...cabeceraDeProyecto(slug) },
        body: JSON.stringify({ path: ruta, contenido }),
      });

    try {
      const w = await escribir(rutaScript, scriptDeSonido(receta, { slug }));
      if (!w.ok) throw new Error(`no pude escribir el script (${w.status})`);
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
          `el render fallo: ${(corrida.errores || corrida.salida || `HTTP ${r.status}`).slice(-600)}`,
        );
      }

      // Ficha junto al WAV: es lo que permite repetirlo con otras palabras.
      const rutaFicha = `proyectos/${slug}/${rutaWavDeSonido(receta).replace(/\.wav$/, ".json")}`;
      await escribir(rutaFicha, JSON.stringify(receta, null, 2));

      // Medida objetiva: no se entrega un sonido sin saber como esta.
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
        /* medir es opcional: el sonido ya esta hecho */
      }
      const medidas = informe
        .split("\n")
        .filter((l) => /pico|clipeadas/.test(l))
        .join(" ");

      const texto = [
        `Sonido "${receta.nombre}" creado (voz ${receta.voz} en ${destino.toUpperCase()}${receta.palabras?.length ? ` · ${receta.palabras.join(", ")}` : ""}).`,
        `WAV: ${rutaWav}`,
        medidas ? `Medidas: ${medidas}` : "",
        ...avisos.map((a) => `- ${a}`),
        // Ruta RELATIVA al proyecto (la convención de todo lo demás): el servidor la
        // resuelve dentro de proyectos/<slug>/. Con "proyectos/<slug>/..." también
        // funcionaba, pero el agente acababa mezclando las dos formas.
        `Para oirlo en la cancion: anadir_pistas(wavs=["${rutaWavDeSonido(receta)}"], compases=<los del tema>).`,
      ]
        .filter((l) => l !== "")
        .join("\n");
      return { ok: true, texto };
    } catch (error) {
      return { ok: false, texto: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Mete un sample de la biblioteca en el proyecto: lo convierte y normaliza en el
   * servidor (`codigo/importar_sample.py`) y lo deja como clip de audio.
   *
   * El sample queda copiado dentro del proyecto: el proyecto sigue siendo portable y
   * no depende de que la biblioteca siga en su sitio.
   */
  async function usarSample(
    peticion: PeticionSample,
  ): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: el sample tiene que entrar en alguno." };
    const archivo = peticion.archivo.trim();
    if (archivo === "") return { ok: false, texto: "Falta la ruta del sample." };
    const nombre = slugDe((peticion.nombre ?? archivo.split("/").pop() ?? "sample").replace(/\.[^.]+$/, ""), {
      max: 40,
      defecto: "sample",
    });

    try {
      const res = await fetch("/api/catalogo/importar", {
        method: "POST",
        // El slug va explícito: `cabecerasProyecto()` depende de que el agente haya
        // pasado por `setProyectoActivo`, y si no, el sample acaba en "sin-proyecto".
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
        return { ok: false, texto: `No pude importar el sample: ${datos.error ?? `HTTP ${res.status}`}` };
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
          `Sample "${nombre}" en el proyecto (${datos.duracion_s} s, pico ${datos.pico_original_dbfs} -> -1 dBFS).\n` +
          `Fichero: proyectos/${carpetaDeProyecto(project)}/${datos.ruta}\n` +
          puesto.texto,
      };
    } catch (error) {
      return { ok: false, texto: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Iguala la duracion de los clips: todos al mismo numero de compases.
   *
   * Los clips se miden en compases, asi que el MIDI de un instrumento y el WAV del
   * mismo material tienen que acabar en el mismo compas. Va por ops (se deshace con
   * Ctrl+Z) y no toca notas, niveles ni tempo.
   */
  function igualarClips(peticion: PeticionIgualar): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay ningun proyecto abierto." };
    const bar = beatsPerBar(project);
    const normal = normalizarTexto;

    const pedidas = (peticion.pistas ?? []).filter((n) => n.trim() !== "");
    const pistas =
      pedidas.length === 0
        ? project.tracks
        : project.tracks.filter((t) => pedidas.some((n) => normal(t.name).includes(normal(n))));
    if (pistas.length === 0) {
      return { ok: false, texto: `No encuentro ninguna pista que se llame asi: ${pedidas.join(", ")}` };
    }

    const masLargo = Math.max(0, ...pistas.flatMap((t) => t.clips.map((c) => c.length)));
    const objetivo =
      peticion.compases && peticion.compases > 0
        ? Math.trunc(peticion.compases) * bar
        : compasesDeAudio(masLargo, bar);
    if (!(objetivo > 0)) return { ok: false, texto: "No hay clips que igualar." };

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
        texto: `Nada que igualar: los ${pistas.length} clips ya duran ${(objetivo / bar).toFixed(2)} compases.`,
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
        `Igualados ${ops.length} clips a ${(objetivo / bar).toFixed(2)} compases (${objetivo} beats) ` +
        `en ${pistas.length} pistas. El proyecto queda en ${siguiente.lengthBars} compases.`,
    };
  }


  /**
   * Proyecto vacío con el nombre pedido (lo llama el agente tras preguntar). La
   * carpeta se elige LIBRE: si ya existe `proyectos/<slug>/`, se usa `<slug>-2`, y
   * así. Antes dos proyectos con el mismo nombre (o dos nombres en un alfabeto no
   * latino, que daban todos «proyecto») escribían en la misma carpeta.
   */
  async function crearProyecto(peticion: PeticionProyecto): Promise<ResultadoAccion> {
    const nombre = peticion.nombre.trim();
    if (!nombre) return { ok: false, texto: "Falta el nombre del proyecto." };
    const previo = e.proyecto()?.name ?? null;
    const bpm = Math.min(300, Math.max(20, Math.round(peticion.bpm)));
    const compases = Math.min(512, Math.max(4, Math.round(peticion.compases)));

    let ocupadas = new Set<string>();
    try {
      ocupadas = new Set((await listarProyectos()).map((p) => p.slug));
    } catch {
      /* sin lista: se usa la carpeta del nombre */
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
    if (previo) e.avisar(`Cerrado «${previo}» (sigue guardado en disco) y abierto «${nombre}».`);
    e.avisar(`Proyecto «${nombre}» creado (carpeta proyectos/${carpeta}/).`);
    return {
      ok: true,
      texto:
        `Proyecto "${nombre}" creado: ${bpm} BPM, ${proyecto.key.tonic} ${proyecto.key.mode}, ${compases} compases. ` +
        `Carpeta: proyectos/${carpeta}/` +
        (carpeta !== base ? ` (proyectos/${base}/ ya existía)` : "") +
        ". Compón con escribir_progresion y editar_proyecto; los WAV/MIDI que generes con Python van a salida/ " +
        "y entran con anadir_pistas.",
    };
  }

  /** Resumen del proyecto con ids: lo que el agente lee antes de editar. */
  function leerProyecto(peticion: { clipId?: string }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: crea uno con crear_proyecto." };
    return { ok: true, texto: resumenParaAgente(project, peticion) };
  }

  /** Ops del dominio, tal cual: transaccionales (o todas o ninguna) y deshacibles. */
  function editarProyecto(peticion: { ops: unknown[] }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: crea uno con crear_proyecto." };
    try {
      const { project: siguiente, results, warnings } = applyOps(project, peticion.ops as Op[]);
      // Si sólo cambian mezcla o dispositivos no hace falta reiniciar el engine.
      const estructural = (peticion.ops as { op?: string }[]).some(
        (op) => !["set_track", "set_master", "set_device", "set_clip_length"].includes(String(op.op)),
      );
      if (estructural) e.fijar(siguiente);
      else e.enVivo(siguiente);
      const avisos = warnings
        .filter((w) => !/Pista sin clips|Proyecto sin pistas/.test(w.message))
        .slice(0, 6)
        .map((w) => `aviso ${w.path}: ${w.message}`);
      return { ok: true, texto: [...results, ...avisos].join("\n") };
    } catch (error) {
      const texto = error instanceof OpError ? error.message : `Error: ${mensajeDe(error)}`;
      return { ok: false, texto: `${texto}\nNo se ha cambiado nada. Usa leer_proyecto para ver los ids.` };
    }
  }

  /**
   * Escribe notas en una pista a partir de un compás: la crea si no existe y, si ya
   * hay clips en ese tramo, los SUSTITUYE (rehacer una sección es lo normal; apilar
   * clips encima sonaba doble). Es el camino común de escribir_progresion,
   * escribir_notas y escribir_bateria: una sola transacción, un solo Ctrl+Z.
   */
  function escribirEnPista(
    peticion: PeticionEscritura,
    notas: Note[],
    beats: number,
    porDefecto: InstrumentType,
  ): { ok: false; texto: string } | { ok: true; texto: string; trackId: string; clipId: string; desde: number; compases: number; sustituidos: string[] } {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: crea uno con crear_proyecto." };
    if (notas.length === 0) return { ok: false, texto: "No hay ninguna nota que escribir." };
    const barBeats = beatsPerBar(project);
    const startBar = Math.max(0, Math.round((peticion.desdeCompas ?? 1) - 1));
    const compases = Math.max(1, Math.ceil(beats / barBeats - 1e-6));
    const inicio = startBar * barBeats;
    const fin = inicio + compases * barBeats;

    const ops: Op[] = [];
    const pista = pistaPorNombre(project, peticion.pista);
    let trackId = pista?.id ?? "";
    if (pista && pista.kind !== "midi") {
      return { ok: false, texto: `«${pista.name}» es una pista de audio: elige una MIDI o un nombre nuevo.` };
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
      // Una pista con instrumento de la biblioteca (archivo .sf2) no se pisa con un
      // programa GM: escribir_notas suele llevar `programa` por costumbre.
      ops.push({
        op: "set_instrument",
        trackId,
        instrument: { ...pista.instrument, ...(tipoPedido ? { type: tipoPedido } : {}), ...(programa !== undefined ? { program: programa } : {}) },
      });
    }
    // Lo que ya había en ese tramo se sustituye, pero SÓLO en ese tramo: un clip que
    // empieza antes o acaba después conserva sus trozos de fuera. Antes se borraba el
    // clip entero y un redoble de un compás se comió 16 compases de batería (27-oct).
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
    // add_notes acepta 2000 notas por op: lo largo va en trozos al mismo clip.
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
      // El clip dura lo que dice la frase (con sus silencios del final), en compases.
      siguiente = applyOps(siguiente, [{ op: "set_clip_length", trackId, clipId, lengthBeats: compases * barBeats }]).project;
      // Y los trozos que quedaban fuera del tramo vuelven, cada uno en su clip.
      for (const c of conservados) {
        siguiente = applyOps(siguiente, [{ op: "add_notes", trackId, startBar: c.startBar, name: c.name.slice(0, 60), notes: c.notes }]).project;
        const nuevo = siguiente.tracks.find((t) => t.id === trackId)?.clips.at(-1)?.id ?? "";
        siguiente = applyOps(siguiente, [{ op: "set_clip_length", trackId, clipId: nuevo, lengthBeats: c.length }]).project;
      }
      e.fijar(siguiente);
      return { ok: true, texto: "", trackId, clipId, desde: startBar + 1, compases, sustituidos };
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}\nNo se ha cambiado nada.` };
    }
  }

  /** Línea común del resultado: dónde ha quedado lo escrito. */
  function dondeQueda(r: { trackId: string; clipId: string; desde: number; compases: number; sustituidos: string[] }, notas: number): string {
    const pista = e.proyecto()?.tracks.find((t) => t.id === r.trackId);
    const instrumento = pista
      ? `${pista.instrument.type}${pista.instrument.program !== undefined ? ` GM ${pista.instrument.program}` : ""}`
      : "";
    return (
      `${notas} notas en «${pista?.name ?? r.trackId}» (${r.trackId}, ${instrumento}), clip ${r.clipId}, ` +
      `compases ${r.desde}-${r.desde + r.compases - 1}` +
      (r.sustituidos.length > 0 ? ` (sustituye lo que había en ese tramo de ${r.sustituidos.join(", ")}; lo de fuera se conserva)` : "") +
      "."
    );
  }

  /** Una progresión de acordes, escrita como notas en una pista (que se crea si falta). */
  function escribirProgresion(peticion: PeticionProgresionPista): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: crea uno con crear_proyecto." };
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
        `${(peticion.repeticiones ?? 1) > 1 ? ` ×${peticion.repeticiones}` : ""} · patrón ${peticion.patron ?? "bloque"} · ` +
        `tonalidad ${project.key.tonic} ${project.key.mode}.`,
    };
  }

  /** Melodía, bajo o cualquier línea en notación compacta (ver src/core/notacion.ts). */
  function escribirNotas(peticion: PeticionNotas): ResultadoAccion {
    let leido;
    try {
      leido = leerNotacion(peticion.notas, peticion.velocidad ?? 90);
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}. No se ha cambiado nada.` };
    }
    const proyecto = e.proyecto();
    const irregulares = proyecto ? tramosIrregulares(leido.tramos, beatsPerBar(proyecto)) : [];
    if (irregulares.length > 0) {
      return {
        ok: false,
        texto:
          `Los compases no cuadran: ${irregulares.join("; ")}. Corrige las duraciones (o quita la barra si ` +
          "el tramo ocupa varios compases). No se ha cambiado nada.",
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
      texto: `${dondeQueda(r, notas.length)} Rango ${nombreDeNota(Math.min(...alturas))}-${nombreDeNota(Math.max(...alturas))}.`,
    };
  }

  /** Batería en rejilla (ver src/core/bateria.ts). */
  function escribirBateria(peticion: PeticionBateriaPista): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto: crea uno con crear_proyecto." };
    let resultado;
    try {
      resultado = notasDeBateria(peticion, beatsPerBar(project));
    } catch (error) {
      return { ok: false, texto: `${mensajeDe(error)}. No se ha cambiado nada.` };
    }
    const r = escribirEnPista({ ...peticion, instrumento: peticion.instrumento ?? "drumkit" }, resultado.notas, resultado.beats, "drumkit");
    if (!r.ok) return r;
    return { ok: true, texto: `${dondeQueda(r, resultado.notas.length)} Piezas: ${Object.keys(peticion.patrones).join(", ")}.` };
  }

  /**
   * Mueve faders por nombre de pista: es como el agente aplica una mezcla.
   *
   * Va por ops (set_track), asi que es un cambio normal del proyecto: entra en el
   * historial, se deshace con Ctrl+Z y no reinicia el engine (commitLive).
   */
  function ajustarPistas(peticion: { pistas: AjustePista[] }): ResultadoAccion {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay ningun proyecto abierto." };

    const ops: Op[] = [];
    const hechas: string[] = [];
    const faltan: string[] = [];

    for (const ajuste of peticion.pistas) {
      if (ajuste.nombre.trim() === "") continue;
      // Un nombre parcial sólo vale si es de UNA pista: antes «Bajo» movía el fader
      // de la primera que lo contuviera aunque hubiera «Bajo 1» y «Bajo 2».
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
        cambios.push(`paneo ${op.pan.toFixed(2)}`);
      }
      if (typeof ajuste.muted === "boolean") {
        op.muted = ajuste.muted;
        cambios.push(ajuste.muted ? "mute" : "sin mute");
      }
      if (typeof ajuste.solo === "boolean") {
        op.solo = ajuste.solo;
        cambios.push(ajuste.solo ? "solo" : "sin solo");
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
          texto: `No se pudo ajustar: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const partes: string[] = [];
    if (hechas.length > 0) partes.push(`Ajustadas ${hechas.length} pista(s):\n${hechas.join("\n")}`);
    if (faltan.length > 0) {
      const nombres = project.tracks.map((t) => t.name).join(", ");
      partes.push(
        nombres === ""
          ? `No encuentro: ${faltan.join(", ")}. El proyecto no tiene pistas todavía.`
          : `No encuentro: ${faltan.join(", ")}. Las pistas son: ${nombres}.`,
      );
    }
    if (partes.length === 0) partes.push("No habia nada que cambiar.");
    return { ok: hechas.length > 0, texto: partes.join("\n\n") };
  }

  /**
   * Un instrumento de la biblioteca, convertido a SoundFont y puesto como pista.
   * El .sf2 trae sus 46 regiones con la nota raíz que declara el SFZ, que es lo que
   * evita el «suena a armónica» de estirar un único sample.
   */
  async function instrumentar(peticion: { sfz: string; nombre: string; pista?: string }): Promise<ResultadoAccion> {
    // Se comprueba ANTES de convertir: si no, se convertía un SFZ de 46 regiones para
    // nada y luego se avisaba de que no había proyecto.
    if (!e.proyecto()) return { ok: false, texto: "Abre o crea un proyecto antes de añadir un instrumento." };
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
        return { ok: false, texto: `No se pudo convertir: ${datos.error ?? res.status}` };
      }
      const project = e.proyecto();
      if (!project) return { ok: false, texto: "El proyecto se cerró mientras se convertía el instrumento." };
      const sonido = (datos.sfz ?? peticion.sfz).split("/").pop()!.replace(/\.sfz$/i, "");
      const instrumento = { type: "soundfont" as const, preset: sonido.slice(0, 64), archivo: datos.archivo };
      const notas = datos.notas ?? [];
      const rango = notas.length === 2 ? ` (suena de ${nombreDeNota(notas[0]!)} a ${nombreDeNota(notas[1]!)})` : "";
      if (peticion.pista) {
        const despues = applyOps(project, [{ op: "set_instrument", trackId: peticion.pista, instrument: instrumento }]);
        e.fijar(despues.project);
        return {
          ok: true,
          texto: `${despues.results.join(" ")}: «${sonido}», ${datos.zonas ?? 0} zonas${rango}. Las notas de la pista se conservan.`,
        };
      }
      const nombre = (peticion.nombre || sonido).slice(0, 60);
      const despues = applyOps(project, [{ op: "add_track", name: nombre, kind: "midi", instrument: instrumento }]).project;
      e.fijar(despues);
      const pista = despues.tracks.at(-1);
      return {
        ok: true,
        texto:
          `Instrumento «${sonido}» listo: ${datos.zonas ?? 0} zonas${rango} en ${datos.archivo}. ` +
          `Pista ${pista ? `«${pista.name}» (${pista.id})` : ""} creada: escribe sus notas con escribir_notas ` +
          `o escribir_progresion (pista = su id).`,
      };
    } catch (error) {
      return { ok: false, texto: `No se pudo convertir: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  /**
   * Fotos del proyecto tomadas al empezar cada turno (main.ts, guardarVersion):
   * `listar` las enseña; `restaurar` copia las pistas pedidas (o todo) de una.
   */
  async function versiones(peticion: { accion: string; version?: string; pistas?: string[] }): Promise<ResultadoAccion> {
    const project = e.proyecto();
    if (!project) return { ok: false, texto: "No hay proyecto abierto." };
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
        return { ok: true, texto: "Aún no hay versiones: se guarda una al empezar cada turno." };
      }
      if (peticion.accion !== "restaurar") {
        return {
          ok: true,
          texto:
            `${nombres.length} versión(es), de la más nueva a la más vieja. Cada una es el proyecto ANTES del ` +
            `pedido que se indica:\n` +
            nombres.slice(0, 30).map((n, i) => `${i + 1}. ${n} (${describirVersion(n)})`).join("\n"),
        };
      }
      const pedida = (peticion.version ?? "").trim();
      const nombre = /^\d{1,2}$/.test(pedida) ? nombres[Number(pedida) - 1] : nombres.find((n) => n === pedida || n.startsWith(pedida));
      if (!nombre) {
        return { ok: false, texto: `No encuentro la versión «${pedida}». Usa versiones con accion=listar y pasa su nombre o su número.` };
      }
      const res = await fetch("/api/fs/read", {
        method: "POST",
        headers: cabecerasProyecto({ "Content-Type": "application/json" }),
        body: JSON.stringify({ path: `${carpeta}/${nombre}` }),
      });
      if (!res.ok) return { ok: false, texto: `No se pudo leer ${nombre} (HTTP ${res.status}).` };
      const { contenido } = (await res.json()) as { contenido: string };
      const antigua = interpretarProyectoEnDisco(contenido).proyecto;
      const { project: siguiente, hechas } = restaurarVersion(project, antigua, peticion.pistas ?? []);
      e.fijar(siguiente);
      return {
        ok: true,
        texto: `Desde ${nombre} (${describirVersion(nombre)}):\n${hechas.join("\n")}\nSe deshace con Ctrl+Z.`,
      };
    } catch (error) {
      return { ok: false, texto: `Error con las versiones: ${mensajeDe(error)}` };
    }
  }

  return {
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

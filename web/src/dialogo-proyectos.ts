/** "Projects": the list of what has a proyecto.json on disk, and opening one. */

import { carpetaDeRuta, interpretarProyectoEnDisco } from "../../src/core/proyecto-archivo.ts";
import { hidratarAssets } from "./audio-store.ts";
import { leerProyectoDeDisco, listarProyectos } from "./proyecto-disco.ts";
import { escapeHtml } from "./timeline.ts";
import { locale } from "./i18n.ts";
import type { Sesion } from "./sesion.ts";
import type { Avisos } from "./avisos.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function fechaCorta(iso: string): string {
  if (!iso) return "no date";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "no date";
  return fecha.toLocaleString(locale(), { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function initDialogoProyectos(d: { sesion: Sesion; avisos: Avisos; avisarFaltan: (faltan: string[]) => void }): {
  reabrir(carpeta: string): Promise<void>;
} {
  const { sesion, avisos } = d;
  const dialogo = $<HTMLDialogElement>("dialogo-proyectos");
  const lista = $("lista-proyectos");

  async function abrirLista(): Promise<void> {
    lista.innerHTML = `<p class="vacio">Reading workspace/proyectos/…</p>`;
    if (!dialogo.open) dialogo.showModal();
    try {
      const proyectos = await listarProyectos();
      if (proyectos.length === 0) {
        lista.innerHTML =
          `<p class="vacio">There is no <code>proyecto.json</code> in <code>workspace/proyectos/</code> yet. ` +
          "It is created with the “Save” button, or on its own 1.5 s after any change.</p>";
        return;
      }
      lista.innerHTML = proyectos
        .map((proyecto) => {
          const detalle = proyecto.error
            ? `unreadable: ${proyecto.error}`
            : `${proyecto.bpm} BPM · ${proyecto.compases} bars · ${proyecto.pistas} track(s)`;
          return (
            `<button class="proyecto-fila" data-ruta="${escapeHtml(proyecto.ruta)}"${proyecto.error ? ' data-error="1"' : ""}>` +
            `<strong>${escapeHtml(proyecto.nombre)}</strong><span>${escapeHtml(detalle)}</span>` +
            `<em>proyectos/${escapeHtml(proyecto.slug)}/ · ${fechaCorta(proyecto.actualizado)} · ${Math.round(proyecto.bytes / 1024)} KB</em>` +
            "</button>"
          );
        })
        .join("");
    } catch (error) {
      lista.innerHTML = `<p class="vacio">Could not read the list: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
    }
  }

  /** The master file rules and its WAVs load from the folder, decoded if short and streamed if long. */
  async function abrir(ruta: string): Promise<void> {
    sesion.setBusy(true, "Opening project from disk…");
    sesion.restoring = true;
    try {
      const disco = interpretarProyectoEnDisco(await leerProyectoDeDisco(ruta));
      const carpeta = carpetaDeRuta(ruta);
      // The folder it is opened from is the project's, whatever it is called: before, a project
      // from proyectos/stahl/ named "Stahl II" was saved in proyectos/stahl-ii/, without its WAVs.
      disco.proyecto.meta = { ...disco.proyecto.meta, carpeta };
      const { cargados, faltan } = await hidratarAssets(disco.proyecto, carpeta);
      // `restoring` is still true here: opening must not rewrite the master file.
      sesion.setProject(disco.proyecto);
      avisos.info(
        `Opened from disk “${disco.proyecto.name}” (proyectos/${carpeta}/): ${disco.proyecto.tracks.length} track(s), ` +
          `${disco.proyecto.bpm} BPM, ${disco.proyecto.lengthBars} bars${cargados > 0 ? `, ${cargados} WAV loaded from the folder.` : "."}`,
      );
      d.avisarFaltan(faltan);
    } catch (error) {
      avisos.error(`Could not open ${ruta}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      sesion.restoring = false;
      sesion.setBusy(false);
    }
  }

  lista.addEventListener("click", (event) => {
    const boton = (event.target as HTMLElement).closest<HTMLElement>("[data-ruta]");
    if (!boton) return;
    if (boton.dataset.error === "1") {
      avisos.error("That proyecto.json is unreadable: it cannot be opened.");
      return;
    }
    const ruta = boton.dataset.ruta ?? "";
    dialogo.close();
    if (ruta) void abrir(ruta);
  });
  $("proyectos-cerrar").addEventListener("click", () => dialogo.close());
  $("proyectos").addEventListener("click", () => void abrirLista());

  return {
    /**
     * Bug 26, 7-Nov: a reload (any edit to web/) left the app empty, and the next dropped WAV made a
     * new project at 120 BPM: the run `vein-cover-ref` went there. A folder deleted since is skipped.
     */
    async reabrir(carpeta: string): Promise<void> {
      try {
        const proyecto = (await listarProyectos()).find((p) => p.slug === carpeta && !p.error);
        if (proyecto) await abrir(proyecto.ruta);
      } catch {
        /* without the list the app starts empty, as before */
      }
    },
  };
}

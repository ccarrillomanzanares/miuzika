/**
 * "Projects": the list of what has a proyecto.json on disk. A click on a row opens it; the tick boxes choose rows for
 * Duplicate (the whole folder, audio included) and Delete, which always asks first and asks apart whether the folder
 * and its contents go too: unticked, only the project file is deleted and the audio stays on disk.
 */

import { carpetaDeRuta, interpretarProyectoEnDisco } from "../../src/core/proyecto-archivo.ts";
import { hidratarAssets } from "./audio-store.ts";
import { borrarProyectos, duplicarProyecto, leerProyectoDeDisco, listarProyectos, tamanoDeProyectos, type ProyectoListado } from "./proyecto-disco.ts";
import { carpetaDeProyecto } from "../../src/core/project.ts";
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
  const elegidosEl = $("proyectos-elegidos");
  const duplicarBoton = $<HTMLButtonElement>("proyectos-duplicar");
  const borrarBoton = $<HTMLButtonElement>("proyectos-borrar");
  /** The ticked folders. Kept across a refresh of the list, so a duplicate leaves its source ticked. */
  const elegidos = new Set<string>();
  let enLista: ProyectoListado[] = [];
  /** Duplicating or deleting, or the delete question on screen: the buttons wait. */
  let ocupado = false;

  const abierta = (): string | null => (sesion.project ? carpetaDeProyecto(sesion.project) : null);
  const tamano = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const mensaje = (error: unknown): string => (error instanceof Error ? error.message : String(error));

  function pintarAcciones(): void {
    const n = elegidos.size;
    elegidosEl.textContent = n === 0 ? "Tick projects to duplicate or delete them." : `${n} ticked`;
    duplicarBoton.disabled = ocupado || n === 0;
    borrarBoton.disabled = ocupado || n === 0;
  }

  async function abrirLista(): Promise<void> {
    lista.innerHTML = `<p class="vacio">Reading workspace/proyectos/…</p>`;
    if (!dialogo.open) dialogo.showModal();
    try {
      const proyectos = await listarProyectos();
      enLista = proyectos;
      // A folder that is gone cannot stay ticked.
      for (const slug of [...elegidos]) if (!proyectos.some((p) => p.slug === slug)) elegidos.delete(slug);
      pintarAcciones();
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
            `<div class="proyecto-linea${proyecto.slug === abierta() ? " abierto" : ""}">` +
            `<input type="checkbox" data-elegir="${escapeHtml(proyecto.slug)}" title="Tick to duplicate or delete"${elegidos.has(proyecto.slug) ? " checked" : ""}>` +
            `<button class="proyecto-fila" data-ruta="${escapeHtml(proyecto.ruta)}"${proyecto.error ? ' data-error="1"' : ""}>` +
            `<strong>${escapeHtml(proyecto.nombre)}</strong><span>${escapeHtml(detalle)}</span>` +
            `<em>proyectos/${escapeHtml(proyecto.slug)}/ · ${fechaCorta(proyecto.actualizado)} · ${Math.round(proyecto.bytes / 1024)} KB</em>` +
            "</button></div>"
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

  lista.addEventListener("change", (event) => {
    const casilla = event.target as HTMLInputElement;
    const slug = casilla.dataset.elegir;
    if (!slug) return;
    if (casilla.checked) elegidos.add(slug);
    else elegidos.delete(slug);
    pintarAcciones();
  });

  duplicarBoton.addEventListener("click", async () => {
    if (ocupado || elegidos.size === 0) return;
    ocupado = true;
    pintarAcciones();
    try {
      // The open project's last change may still be waiting for the autosave: the copy must have it.
      if (abierta() && elegidos.has(abierta()!)) await sesion.guardarYEsperar();
      for (const slug of enLista.map((p) => p.slug).filter((s) => elegidos.has(s))) {
        elegidosEl.textContent = `Copying proyectos/${slug}/…`;
        try {
          const copia = await duplicarProyecto(slug);
          avisos.info(`Duplicated proyectos/${slug}/ as “${copia.nombre}” (proyectos/${copia.slug}/): ${copia.ficheros} file(s), ${tamano(copia.bytes)}.`);
        } catch (error) {
          avisos.error(`Could not duplicate proyectos/${slug}/: ${mensaje(error)}`);
        }
      }
    } finally {
      ocupado = false;
      await abrirLista();
    }
  });

  /** The question, in the place of the list: what goes, how much it is, and the folder asked apart. */
  borrarBoton.addEventListener("click", async () => {
    if (ocupado || elegidos.size === 0) return;
    const proyectos = enLista.filter((p) => elegidos.has(p.slug));
    ocupado = true;
    pintarAcciones();
    let tamanos: { slug: string; ficheros: number; bytes: number }[];
    try {
      tamanos = await tamanoDeProyectos(proyectos.map((p) => p.slug));
    } catch (error) {
      avisos.error(`Could not measure the folders, nothing was deleted: ${mensaje(error)}`);
      ocupado = false;
      pintarAcciones();
      return;
    }
    const ficheros = tamanos.reduce((n, t) => n + t.ficheros, 0);
    const bytes = tamanos.reduce((n, t) => n + t.bytes, 0);
    const uno = proyectos.length === 1;
    lista.innerHTML =
      `<div class="proyectos-borrado">` +
      `<p><strong>Delete ${uno ? "this project" : `these ${proyectos.length} projects`}?</strong> This cannot be undone.</p>` +
      `<ul>${proyectos
        .map((p) => {
          const t = tamanos.find((x) => x.slug === p.slug);
          return `<li>${escapeHtml(p.nombre)} — proyectos/${escapeHtml(p.slug)}/ · ${t ? `${t.ficheros} file(s), ${tamano(t.bytes)}` : ""}${p.slug === abierta() ? " · open now: it will be closed" : ""}</li>`;
        })
        .join("")}</ul>` +
      `<label><input type="checkbox" data-con-carpeta><span>Also delete ${uno ? "its folder" : "their folders"} and everything inside: ${ficheros} file(s), ${tamano(bytes)}` +
      `<small>Audio, takes, exports and MIDI. Unticked, only the project file is deleted: the project leaves this list and the rest stays in ${uno ? "its folder" : "their folders"} on disk.</small></span></label>` +
      `<div class="dialogo-acciones"><button type="button" data-borrar-no>Cancel</button><button type="button" class="primario" data-borrar-si>Delete</button></div>` +
      `</div>`;
    lista.querySelector<HTMLButtonElement>("[data-borrar-no]")!.focus();
  });

  async function borrar(conCarpeta: boolean): Promise<void> {
    const slugs = enLista.map((p) => p.slug).filter((s) => elegidos.has(s));
    lista.innerHTML = `<p class="vacio">Deleting…</p>`;
    try {
      // Closed first and without saving: its autosave would write the project file back after it was deleted.
      if (abierta() && slugs.includes(abierta()!)) sesion.cerrarSinGuardar();
      for (const b of await borrarProyectos(slugs, conCarpeta)) {
        avisos.info(
          b.carpetaBorrada
            ? `Deleted proyectos/${b.slug}/ and everything in it.`
            : `Deleted the project file of proyectos/${b.slug}/; ${b.quedan} other file(s) stay in that folder.`,
        );
        elegidos.delete(b.slug);
      }
    } catch (error) {
      avisos.error(`Could not delete: ${mensaje(error)}`);
    } finally {
      ocupado = false;
      await abrirLista();
    }
  }

  // Closing the window with the question on screen is a Cancel.
  dialogo.addEventListener("close", () => {
    ocupado = false;
  });

  lista.addEventListener("click", (event) => {
    const objetivo = event.target as HTMLElement;
    if (objetivo.closest("[data-borrar-no]")) {
      ocupado = false;
      void abrirLista();
      return;
    }
    if (objetivo.closest("[data-borrar-si]")) {
      void borrar(lista.querySelector<HTMLInputElement>("[data-con-carpeta]")?.checked === true);
      return;
    }
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

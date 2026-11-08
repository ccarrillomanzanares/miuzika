/**
 * "New": asks for the project's name, creates it and opens it (the user, 8-Nov-2026: "si aprieto new ha de preguntar el
 * nombre del proyecto… y se abre… y a partir de ahí que se pueda ejecutar el pad"). Before, New only closed the current
 * project and left the app empty, and the Pad cannot open without a project.
 *
 * The folder comes from the name; if it is taken, the next free one (`name-2`), said in the window before creating, so no
 * project on disk is ever overwritten.
 */

import { carpetaDeNombre, carpetaLibre, createProject } from "../../src/core/project.ts";
import type { Project } from "../../src/core/types.ts";
import { listarProyectos } from "./proyecto-disco.ts";

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function crearDialogoNuevo(d: {
  /** The open project's folder, which may not be on disk yet. */
  carpetaAbierta(): string | null;
  /** Opens the new project and writes it to disk. */
  abrir(proyecto: Project): void;
  avisar(texto: string): void;
}) {
  const dialogo = document.createElement("dialog");
  dialogo.className = "dialogo";
  dialogo.innerHTML = `
    <form method="dialog" class="dialogo-nuevo">
      <div class="dialogo-cabeza"><strong>New project</strong></div>
      <label>Name <input name="nombre" type="text" maxlength="60" autocomplete="off" required></label>
      <p class="ace-nota" data-carpeta></p>
      <div class="dialogo-acciones">
        <button type="submit" value="crear" data-crear>Create</button>
        <button type="button" data-cancelar>Cancel</button>
      </div>
    </form>`;
  document.body.append(dialogo);
  const entrada = dialogo.querySelector<HTMLInputElement>('[name="nombre"]')!;
  const nota = dialogo.querySelector<HTMLElement>("[data-carpeta]")!;
  const crear = dialogo.querySelector<HTMLButtonElement>("[data-crear]")!;
  let ocupadas = new Set<string>();

  const carpeta = (): string => carpetaLibre(carpetaDeNombre(entrada.value.trim()), ocupadas);
  const pintar = (): void => {
    const nombre = entrada.value.trim();
    crear.disabled = nombre === "";
    if (!nombre) {
      nota.textContent = "";
      return;
    }
    const base = carpetaDeNombre(nombre);
    const destino = carpeta();
    nota.innerHTML =
      destino === base
        ? `Saved in <code>proyectos/${esc(destino)}/</code>. The open project stays saved on disk.`
        : `A project already uses <code>proyectos/${esc(base)}/</code>: this one goes to <code>proyectos/${esc(destino)}/</code>.`;
  };

  entrada.addEventListener("input", pintar);
  dialogo.querySelector("[data-cancelar]")!.addEventListener("click", () => dialogo.close());
  dialogo.querySelector("form")!.addEventListener("submit", (e) => {
    e.preventDefault();
    const nombre = entrada.value.trim();
    if (!nombre) return;
    dialogo.close();
    d.abrir(createProject({ name: nombre, bpm: 120, lengthBars: 32, carpeta: carpeta() }));
  });

  return {
    async abrir(): Promise<void> {
      try {
        ocupadas = new Set((await listarProyectos()).map((p) => p.slug));
      } catch (error) {
        // Without the list a taken folder could be overwritten: better no project.
        d.avisar(`Could not read the project list, so no new project was made: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const abierta = d.carpetaAbierta();
      if (abierta) ocupadas.add(abierta);
      entrada.value = "";
      pintar();
      dialogo.showModal();
      entrada.focus();
    },
  };
}

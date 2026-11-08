/**
 * The instrument picker of a MIDI track (8-Nov-2026). Opened from the instrument line of a track head. A click applies the
 * instrument at once (undoable, Ctrl+Z) and the dialog stays open, so several can be tried in a row; with Play running the
 * engine is mounted again from where it was, as when a clip moves (a short gap is heard).
 */

import type { Project, Track } from "../../src/core/types.ts";
import { buscar, esActual, etiquetaInstrumento, instrumentoDe, type Opcion } from "../../src/core/instrumentos.ts";

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class SelectorInstrumento {
  private readonly dialogo: HTMLDialogElement;
  private pista: string | null = null;
  private filtro = "";

  constructor(
    private readonly d: {
      proyecto(): Project | null;
      aplicar(trackId: string, instrumento: Track["instrument"]): void;
    },
  ) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho selector-instrumento";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name !== "buscar") return;
      this.filtro = el.value;
      this.pintarLista();
    });
    this.dialogo.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-opcion], [data-accion]");
      if (!el) return;
      if (el.dataset.accion === "cerrar") {
        this.dialogo.close();
        return;
      }
      const opcion = this.visibles()[Number(el.dataset.opcion)];
      if (!opcion || !this.pista) return;
      this.d.aplicar(this.pista, instrumentoDe(opcion));
      this.pintarCabeza();
      this.pintarLista();
    });
  }

  abrir(trackId: string): void {
    const pista = this.d.proyecto()?.tracks.find((t) => t.id === trackId);
    if (!pista || pista.kind !== "midi") return;
    this.pista = trackId;
    // Seen headless: a search kept from another track ("synth bass") hid the kits of a drum track.
    this.filtro = "";
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong class="si-titulo"></strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota si-actual"></p>
      <input type="search" name="buscar" placeholder="Search: bass, strings, organ, 808, pad…" value="${esc(this.filtro)}" autocomplete="off">
      <div class="si-lista"></div>`;
    this.pintarCabeza();
    this.pintarLista();
    if (!this.dialogo.open) this.dialogo.showModal();
    this.dialogo.querySelector<HTMLInputElement>('input[name="buscar"]')?.focus();
  }

  private actual(): Track | undefined {
    return this.d.proyecto()?.tracks.find((t) => t.id === this.pista);
  }

  private visibles(): Opcion[] {
    return buscar(this.filtro);
  }

  private pintarCabeza(): void {
    const t = this.actual();
    if (!t) return;
    this.dialogo.querySelector(".si-titulo")!.textContent = `Instrument · ${t.name}`;
    const notas = t.clips.reduce((s, c) => s + c.notes.length, 0);
    const aviso =
      t.instrument.type === "drumkit"
        ? " Its notes are drum hits: with a melodic instrument each one plays as a pitch."
        : " A drum kit maps each pitch to a drum (36 kick, 38 snare, 42 hi-hat…).";
    this.dialogo.querySelector(".si-actual")!.textContent =
      `Now: ${etiquetaInstrumento(t.instrument)}. ${notas} notes. A click applies it at once (Ctrl+Z undoes it).${notas ? aviso : ""}`;
  }

  private pintarLista(): void {
    const t = this.actual();
    const lista = this.dialogo.querySelector<HTMLElement>(".si-lista");
    if (!t || !lista) return;
    const opciones = this.visibles();
    const boton = (o: Opcion, i: number): string =>
      `<button type="button" data-opcion="${i}" class="${esActual(t.instrument, o) ? "actual" : ""}"${o.clase === "gm" ? ` title="GM program ${o.programa}"` : ""}>${esc(o.nombre)}</button>`;
    const grupos: { titulo: string; items: string[] }[] = [];
    const grupo = (titulo: string): string[] => {
      let g = grupos.find((x) => x.titulo === titulo);
      if (!g) grupos.push((g = { titulo, items: [] }));
      return g.items;
    };
    // Kits first for a drum track, synths last: the order a person looks in.
    const kitsPrimero = t.instrument.type === "drumkit";
    if (kitsPrimero) grupo("Drum kits");
    opciones.forEach((o, i) => {
      if (o.clase === "kit") grupo("Drum kits").push(boton(o, i));
      else if (o.clase === "gm") grupo(o.familia).push(boton(o, i));
      else grupo("openDAW synths (no SoundFont)").push(boton(o, i));
    });
    const html = grupos
      .filter((g) => g.items.length > 0)
      .map((g) => `<section><h4>${esc(g.titulo)}</h4><div class="si-botones">${g.items.join("")}</div></section>`)
      .join("");
    const scroll = lista.scrollTop;
    lista.innerHTML = html || `<p class="ace-nota">Nothing called “${esc(this.filtro)}”.</p>`;
    lista.scrollTop = scroll;
  }
}

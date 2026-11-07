/**
 * The rented GPU in the main bar, whichever module started it: a machine left on bills without
 * being seen (5-Nov: 14 h of A10, about 18 $), so its cost and its Off button stay in sight with
 * every module closed. The bar also shows a module's running task and its Cancel.
 */

import type { Avisos } from "./avisos.ts";

export interface EstadoGpu {
  configurado: boolean;
  faltan?: string[];
  ssh?: { ok: boolean; detalle: string };
  precio_hora?: number;
  moneda?: string;
  proveedor?: string;
  activo?: boolean;
  fase?: "apagada" | "arrancando" | "activa" | "apagandose";
  gastado?: number;
  tipo?: string;
}

const CADA_MS = 30_000;

export class BarraGpu {
  estado: EstadoGpu | null = null;
  private apagando = false;
  private readonly zona: HTMLElement;
  private readonly texto: HTMLElement;
  private readonly apagar: HTMLButtonElement;
  private readonly tarea: HTMLElement;
  private readonly cancelar: HTMLButtonElement;
  private readonly avisos: Avisos;
  private alCancelar: (() => void) | null = null;

  constructor(d: { zona: HTMLElement; texto: HTMLElement; apagar: HTMLButtonElement; tarea: HTMLElement; cancelar: HTMLButtonElement; avisos: Avisos }) {
    this.zona = d.zona;
    this.texto = d.texto;
    this.apagar = d.apagar;
    this.tarea = d.tarea;
    this.cancelar = d.cancelar;
    this.avisos = d.avisos;
    this.apagar.addEventListener("click", () => void this.apagarGpu());
    this.cancelar.addEventListener("click", () => this.alCancelar?.());
    void this.refrescar();
    window.setInterval(() => {
      if (!document.hidden) void this.refrescar();
    }, CADA_MS);
  }

  async refrescar(): Promise<EstadoGpu | null> {
    try {
      const res = await fetch("/api/gpu/estado");
      if (res.ok) this.estado = (await res.json()) as EstadoGpu;
    } catch {
      /* the server is restarting: the next poll fixes it */
    }
    this.pintar();
    return this.estado;
  }

  /** A module's task in the bar; `cancelar` is what its Cancel button does. Null clears it. */
  fijarTarea(texto: string | null, cancelar?: () => void): void {
    this.tarea.textContent = texto ?? "";
    this.tarea.hidden = texto === null;
    this.cancelar.hidden = texto === null;
    this.alCancelar = cancelar ?? this.alCancelar;
    this.pintar();
  }

  private pintar(): void {
    const e = this.estado;
    const fase = this.apagando ? "apagandose" : e?.fase;
    const encendida = fase === "activa" || fase === "arrancando" || fase === "apagandose";
    this.texto.hidden = !encendida;
    this.apagar.hidden = !(fase === "activa" || fase === "arrancando");
    this.zona.hidden = !encendida && this.tarea.hidden;
    if (!encendida || !e) return;
    const etiqueta = fase === "apagandose" ? "GPU shutting down" : fase === "arrancando" ? "GPU starting" : "GPU on";
    this.texto.textContent = `${etiqueta} · ${e.tipo ?? ""} · ${e.precio_hora ?? "?"} $/h · ${(e.gastado ?? 0).toFixed(2)} $`;
    this.texto.title = `${e.proveedor ?? "GPU"}: it bills by the hour until it is off`;
  }

  private async apagarGpu(): Promise<void> {
    this.apagando = true;
    this.pintar();
    try {
      const res = await fetch("/api/gpu/apagar", { method: "POST" });
      const datos = (await res.json()) as { ok?: boolean; error?: string; apagadas?: { segundos: number }[] };
      if (res.ok && datos.ok) this.avisos.info(`GPU off, confirmed by the provider in ${datos.apagadas?.[0]?.segundos ?? "?"} s.`);
      else this.avisos.error(`The GPU could not be confirmed off: ${datos.error ?? "the provider did not confirm it"}. Check it: it may still be billing.`);
    } catch (error) {
      this.avisos.error(`The GPU could not be shut down: ${error instanceof Error ? error.message : String(error)}. It may still be billing.`);
    } finally {
      this.apagando = false;
      await this.refrescar();
    }
  }
}

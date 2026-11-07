/**
 * Settings: the accounts the app rents from, so nobody has to edit a .env (Carlos, 6-Nov). It paints
 * whatever each provider declares (src/core/proveedores-gpu.ts). Which model to use stays in each
 * module. A key is typed here, kept on the server and never comes back: only its last digits.
 */

import type { BarraGpu } from "./gpu-barra.ts";

interface Campo {
  clave: string;
  etiqueta: string;
  ayuda: string;
  avanzado: boolean;
  secreto: boolean;
  origen: "ajustes" | "env" | "defecto" | "falta";
  porDefecto: string;
  valor?: string;
  tiene?: boolean;
  oculta?: string;
}

interface Estado {
  disponible: boolean;
  faltan: string[];
  proveedores: { id: string; nombre: string; ayuda: string; campos: Campo[] }[];
  error?: string;
}

interface Comprobacion {
  que: string;
  ok: boolean;
  detalle: string;
}

const esc = (texto: string): string => texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class VentanaAjustes {
  private readonly dialogo: HTMLDialogElement;
  private readonly gpu: BarraGpu;
  private estado: Estado | null = null;
  private alCerrar: (() => void) | null = null;

  constructor(gpu: BarraGpu) {
    this.gpu = gpu;
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho ajustes";
    document.body.append(this.dialogo);
    this.dialogo.addEventListener("click", (e) => void this.alPulsar(e));
    this.dialogo.addEventListener("close", () => {
      void this.gpu.refrescar().finally(() => {
        this.alCerrar?.();
        this.alCerrar = null;
      });
    });
  }

  /** Resolves when the window closes and the GPU's state has been read again. */
  async abrir(): Promise<void> {
    const res = await fetch("/api/ajustes/gpu");
    this.estado = (await res.json()) as Estado;
    this.pintar();
    this.dialogo.showModal();
    return new Promise((resolver) => {
      this.alCerrar = resolver;
    });
  }

  private origen(c: Campo): string {
    if (c.origen === "ajustes") return "Saved here.";
    if (c.origen === "env") return "From .env.";
    if (c.origen === "defecto") return `Default: ${c.porDefecto}.`;
    return "Missing.";
  }

  private campo(p: string, c: Campo): string {
    const atributos = `data-proveedor="${esc(p)}" data-campo="${esc(c.clave)}"`;
    const ayuda = `<small>${esc([c.ayuda, this.origen(c)].filter(Boolean).join(" "))}</small>`;
    const control = c.secreto
      ? `<input ${atributos} type="password" autocomplete="new-password" placeholder="${esc(c.tiene ? `saved: ${c.oculta ?? ""}. Paste another to replace it` : "paste it here")}">`
      : // Only a value saved here fills the box: saving must not copy .env or a default into the settings.
        `<input ${atributos} value="${esc(c.origen === "ajustes" ? (c.valor ?? "") : "")}" placeholder="${esc(c.origen === "env" ? (c.valor ?? "") : c.porDefecto)}" autocomplete="off">`;
    return `<div class="ace-fila"><label>${esc(c.etiqueta)}</label><div>${control}${ayuda}</div></div>`;
  }

  private pintar(mensaje = "", error = false): void {
    const e = this.estado;
    if (!e) return;
    const fichas = e.proveedores
      .map((p) => {
        const principales = p.campos.filter((c) => !c.avanzado).map((c) => this.campo(p.id, c)).join("");
        const avanzados = p.campos.filter((c) => c.avanzado).map((c) => this.campo(p.id, c)).join("");
        const borrar = p.campos.some((c) => c.secreto && c.origen === "ajustes")
          ? `<button type="button" data-accion="borrar" data-id="${esc(p.id)}">Remove key</button>`
          : "";
        return `<section class="ajustes-ficha">
          <h3>${esc(p.nombre)}</h3>
          <p class="ace-nota">${esc(p.ayuda)}</p>
          ${principales}
          ${avanzados ? `<details class="ace-tomas"><summary>Advanced</summary>${avanzados}</details>` : ""}
          <div class="dialogo-acciones">${borrar}
            <button type="button" data-accion="probar" data-id="${esc(p.id)}" title="Starts nothing and costs nothing">Test connection</button>
            <button type="button" class="primario" data-accion="guardar" data-id="${esc(p.id)}">Save</button>
          </div>
        </section>`;
      })
      .join("");
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>Settings · GPU</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">Keys stay on this machine, in a file outside git and outside your projects. Which model to use is chosen in each module.</p>
      <div class="ace-cuerpo">${fichas}</div>
      <div class="ajustes-mensaje${error ? " mal" : ""}" data-mensaje>${esc(mensaje)}</div>
      <div class="dialogo-acciones"><button type="button" data-accion="cerrar">Close</button></div>`;
  }

  private campos(id: string): Record<string, string> {
    const salida: Record<string, string> = {};
    for (const el of this.dialogo.querySelectorAll<HTMLInputElement>(`input[data-proveedor="${CSS.escape(id)}"]`)) {
      salida[el.dataset.campo!] = el.value;
    }
    return salida;
  }

  private async enviar(accion: string, id: string, conCampos: boolean): Promise<boolean> {
    try {
      const res = await fetch("/api/ajustes/gpu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion, id, ...(conCampos ? { campos: this.campos(id) } : {}) }),
      });
      const datos = (await res.json()) as Estado;
      if (!res.ok) throw new Error(datos.error ?? `HTTP ${res.status}`);
      this.estado = datos;
      return true;
    } catch (error) {
      this.decir(error instanceof Error ? error.message : String(error), true);
      return false;
    }
  }

  /** Only the message line: repainting would wipe what is being typed. */
  private decir(texto: string, error = false): void {
    const zona = this.dialogo.querySelector<HTMLElement>("[data-mensaje]");
    if (!zona) return;
    zona.textContent = texto;
    zona.classList.toggle("mal", error);
  }

  private resumen(): { texto: string; error: boolean } {
    const e = this.estado!;
    return e.disponible
      ? { texto: "Saved. Test connection checks it without starting anything.", error: false }
      : { texto: `Saved. Still missing: ${e.faltan.join(", ")}.`, error: true };
  }

  private async alPulsar(evento: Event): Promise<void> {
    const el = evento.target as HTMLElement;
    const id = el.dataset.id ?? "";
    switch (el.dataset.accion) {
      case "cerrar":
        this.dialogo.close();
        return;
      case "guardar":
        if (await this.enviar("guardar", id, true)) {
          const r = this.resumen();
          this.pintar(r.texto, r.error);
        }
        return;
      case "borrar":
        if (await this.enviar("borrarClave", id, false)) this.pintar("Key removed. If .env has one, that one is used.");
        return;
      case "probar":
        await this.probar(id);
        return;
    }
  }

  /** Saves first: what is tested is what is on the screen. */
  private async probar(id: string): Promise<void> {
    if (!(await this.enviar("guardar", id, true))) return;
    this.pintar("Testing…");
    try {
      const res = await fetch("/api/ajustes/gpu/probar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const datos = (await res.json()) as { ok?: boolean; comprobaciones?: Comprobacion[]; error?: string };
      if (!res.ok) throw new Error(datos.error ?? `HTTP ${res.status}`);
      const lineas = (datos.comprobaciones ?? []).map((c) => `${c.ok ? "✓" : "✗"} ${c.que}: ${c.detalle}`);
      this.decir(lineas.join("\n"), datos.ok !== true);
    } catch (error) {
      this.decir(error instanceof Error ? error.message : String(error), true);
    }
  }
}

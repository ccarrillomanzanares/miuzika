/**
 * Menú «Modelos»: con qué proveedor y qué modelo trabaja el agente.
 *
 * La clave se escribe aquí, pero se guarda en el servidor y no vuelve nunca al
 * navegador: el menú sólo sabe si hay clave y sus últimas cifras.
 */

import { fijarActivo } from "./llm.ts";
import { idioma } from "./i18n.ts";

interface ProveedorVista {
  id: string;
  nombre: string;
  base: string;
  baseEditable: boolean;
  necesitaClave: boolean;
  tieneClave: boolean;
  clave: string;
  claveDelEnv?: string;
  modelo: string;
  ayuda: string;
}

interface Estado {
  activo: string;
  modelo: string;
  proveedores: ProveedorVista[];
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export class AjustesModelos {
  private dialogo: HTMLDialogElement;
  private estado: Estado | null = null;
  private elegido = "";
  private modelos = new Map<string, string[]>();

  constructor(private alCambiar: (proveedor: string, modelo: string) => void = () => {}) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo dialogo-ancho dialogo-modelos";
    document.body.append(this.dialogo);
  }

  private tx(es: string, en: string): string {
    return idioma() === "es" ? es : en;
  }

  async abrir(): Promise<void> {
    await this.recargar();
    this.elegido = this.estado?.activo ?? "ollama-cloud";
    this.pintar();
    this.dialogo.showModal();
  }

  private async recargar(): Promise<void> {
    this.estado = (await (await fetch("/api/proveedores")).json()) as Estado;
  }

  private async enviar(cuerpo: Record<string, unknown>): Promise<void> {
    const res = await fetch("/api/proveedores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const datos = (await res.json()) as Estado & { error?: string };
    if (!res.ok) throw new Error(datos.error ?? `HTTP ${res.status}`);
    this.estado = datos;
  }

  private pintar(): void {
    const tx = (a: string, b: string): string => this.tx(a, b);
    const estado = this.estado;
    if (!estado) return;
    const p = estado.proveedores.find((x) => x.id === this.elegido) ?? estado.proveedores[0]!;
    const lista = this.modelos.get(p.id) ?? [];
    const esActivo = p.id === estado.activo;

    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza">
        <strong>${tx("Modelos", "Models")}</strong>
        <button type="button" class="icon" data-cerrar title="${tx("Cerrar", "Close")}">✕</button>
      </div>
      <p class="modelos-actual">${tx("El agente usa", "The agent uses")} <b>${escapar(
        estado.proveedores.find((x) => x.id === estado.activo)?.nombre ?? estado.activo,
      )}</b> · <code>${escapar(estado.modelo || "—")}</code></p>
      <div class="modelos">
        <ul class="modelos-lista">
          ${estado.proveedores
            .map(
              (x) => `<li><button type="button" data-prov="${x.id}" class="${x.id === p.id ? "activo" : ""}">
                <span>${escapar(x.nombre)}</span>
                <small>${x.id === estado.activo ? tx("en uso", "in use") : x.tieneClave || !x.necesitaClave ? "✓" : ""}</small>
              </button></li>`,
            )
            .join("")}
        </ul>
        <div class="modelos-detalle">
          <h3>${escapar(p.nombre)}</h3>
          <p class="ayuda">${escapar(p.ayuda)}</p>
          ${
            p.baseEditable
              ? `<label>${tx("URL base", "Base URL")}<input name="base" value="${escapar(p.base)}" placeholder="https://…/v1"></label>`
              : `<p class="ayuda"><code>${escapar(p.base)}</code></p>`
          }
          ${
            p.necesitaClave
              ? `<label>${tx("Clave", "API key")}
                  <input name="clave" type="password" autocomplete="off" placeholder="${
                    p.tieneClave
                      ? escapar(`${tx("guardada", "saved")}: ${p.clave}${p.claveDelEnv ? ` (${p.claveDelEnv} del .env)` : ""}`)
                      : tx("pega aquí la clave", "paste the key here")
                  }">
                </label>`
              : `<p class="ayuda">${tx("No necesita clave.", "No key needed.")}</p>`
          }
          <label>${tx("Modelo", "Model")}
            <div class="fila-modelo">
              <input name="modelo" list="modelos-${p.id}" value="${escapar(p.modelo)}" placeholder="${tx("nombre del modelo", "model name")}">
              <button type="button" data-cargar>${tx("Ver modelos", "List models")}</button>
            </div>
            <datalist id="modelos-${p.id}">${lista.map((m) => `<option value="${escapar(m)}"></option>`).join("")}</datalist>
          </label>
          ${lista.length > 0 ? `<small class="ayuda">${lista.length} ${tx("modelos disponibles", "models available")}</small>` : ""}
          <p class="modelos-mensaje" data-mensaje></p>
          <div class="dialogo-acciones">
            ${p.necesitaClave && p.tieneClave && !p.claveDelEnv ? `<button type="button" data-borrar>${tx("Borrar clave", "Remove key")}</button>` : ""}
            <button type="button" data-probar>${tx("Probar", "Test")}</button>
            <button type="button" data-guardar>${tx("Guardar", "Save")}</button>
            <button type="button" class="primario" data-usar>${esActivo ? tx("Guardar y seguir usando", "Save, keep using") : tx("Usar este", "Use this one")}</button>
          </div>
          <p class="ayuda nota-busqueda">${tx(
            "La búsqueda web del agente usa siempre la clave de Ollama Cloud.",
            "The agent's web search always uses the Ollama Cloud key.",
          )}</p>
        </div>
      </div>`;

    const q = <T extends Element>(sel: string): T | null => this.dialogo.querySelector<T>(sel);
    const mensaje = q<HTMLElement>("[data-mensaje]")!;
    const decir = (texto: string, error = false): void => {
      mensaje.textContent = texto;
      mensaje.classList.toggle("error", error);
    };
    const datos = (): { apiKey?: string; base?: string; modelo: string } => ({
      ...(q<HTMLInputElement>("[name=clave]")?.value.trim() ? { apiKey: q<HTMLInputElement>("[name=clave]")!.value.trim() } : {}),
      ...(q<HTMLInputElement>("[name=base]") ? { base: q<HTMLInputElement>("[name=base]")!.value.trim() } : {}),
      modelo: q<HTMLInputElement>("[name=modelo]")!.value.trim(),
    });
    const guardar = async (accion: "guardar" | "activar"): Promise<boolean> => {
      try {
        await this.enviar({ accion, id: p.id, ...datos() });
        return true;
      } catch (error) {
        decir(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    };

    this.dialogo.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => this.dialogo.close()));
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-prov]").forEach((b) =>
      b.addEventListener("click", () => {
        this.elegido = b.dataset.prov!;
        this.pintar();
      }),
    );
    q("[data-cargar]")?.addEventListener("click", async () => {
      decir(tx("Pidiendo la lista…", "Fetching the list…"));
      if (!(await guardar("guardar"))) return;
      const res = await fetch(`/api/proveedores/modelos?id=${encodeURIComponent(p.id)}`);
      const r = (await res.json()) as { ok?: boolean; modelos?: string[]; error?: string };
      if (!r.ok) {
        decir(r.error ?? "error", true);
        return;
      }
      this.modelos.set(p.id, r.modelos ?? []);
      this.pintar();
      this.dialogo.querySelector<HTMLInputElement>("[name=modelo]")?.focus();
    });
    q("[data-probar]")?.addEventListener("click", async () => {
      decir(tx("Probando…", "Testing…"));
      if (!(await guardar("guardar"))) return;
      const res = await fetch("/api/proveedores/probar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, modelo: datos().modelo }),
      });
      const r = (await res.json()) as { ok?: boolean; ms?: number; respuesta?: string; error?: string };
      decir(
        r.ok ? `✓ ${tx("Responde en", "Replies in")} ${((r.ms ?? 0) / 1000).toFixed(1)} s: «${r.respuesta ?? ""}»` : `✗ ${r.error ?? "error"}`,
        !r.ok,
      );
    });
    q("[data-guardar]")?.addEventListener("click", async () => {
      if (await guardar("guardar")) {
        this.pintar();
        this.dialogo.querySelector<HTMLElement>("[data-mensaje]")!.textContent = tx("Guardado.", "Saved.");
      }
    });
    q("[data-borrar]")?.addEventListener("click", async () => {
      try {
        await this.enviar({ accion: "borrarClave", id: p.id });
        this.pintar();
      } catch (error) {
        decir(error instanceof Error ? error.message : String(error), true);
      }
    });
    q("[data-usar]")?.addEventListener("click", async () => {
      if (!(await guardar("activar"))) return;
      const estado2 = this.estado!;
      fijarActivo(estado2.activo, estado2.modelo);
      this.alCambiar(estado2.activo, estado2.modelo);
      this.pintar();
      this.dialogo.querySelector<HTMLElement>("[data-mensaje]")!.textContent = this.tx(
        "Hecho: el próximo turno del agente usa este modelo.",
        "Done: the agent's next turn uses this model.",
      );
    });
  }
}

/**
 * "Models" menu: which provider and which model the agent works with.
 *
 * The key is typed here, but it is stored on the server and never returns to the
 * browser: the menu only knows whether a key exists and its last digits.
 */

import { fijarActivo } from "./llm.ts";
import { idioma } from "./i18n.ts";
import { textoTarifa } from "./coste-texto.ts";
import { guardarTope, leerTope } from "./tope-coste.ts";
import type { Tarifa } from "../../src/core/precios.ts";

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

/** /api/proveedores/gpu (4-Nov, docs/PLAN-PROVEEDORES-GPU.md): never carries the key itself. */
interface CampoGpuVista {
  clave: string;
  es: string;
  en: string;
  variableEnv: string;
  secreto: boolean;
  origen: "ajustes" | "env" | "defecto" | "falta";
  porDefecto: string;
  valor?: string;
  tiene?: boolean;
  oculta?: string;
}

interface EstadoGpu {
  activo: string;
  activoDesde: "ajustes" | "env";
  disponible: boolean;
  faltan: string[];
  proveedores: { id: string; nombre: string; ayuda: { es: string; en: string }; campos: CampoGpuVista[] }[];
}

/** List entries for GPU providers are "gpu:<id>", so they never clash with an LLM id. */
const PREFIJO_GPU = "gpu:";

function escapar(texto: string): string {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export class AjustesModelos {
  private dialogo: HTMLDialogElement;
  private estado: Estado | null = null;
  private estadoGpu: EstadoGpu | null = null;
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
    try {
      this.estadoGpu = (await (await fetch("/api/proveedores/gpu")).json()) as EstadoGpu;
    } catch {
      this.estadoGpu = null;
    }
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
    if (this.elegido.startsWith(PREFIJO_GPU) && this.estadoGpu) {
      this.pintarGpu(this.estadoGpu);
      return;
    }
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
      <label class="modelos-tope">${tx("Tope de coste por turno", "Cost cap per turn")}
        <span class="fila-modelo"><input name="tope" type="number" min="0" step="0.05" inputmode="decimal" value="${leerTope() ?? ""}" placeholder="${tx("sin tope", "no cap")}"> $</span>
        <small class="ayuda">${tx(
          "El turno se corta con un aviso al llegar a esta cifra (precios de OpenRouter). Vacío = sin tope.",
          "The turn stops with a notice when it reaches this amount (OpenRouter prices). Empty = no cap.",
        )}</small>
      </label>
      <div class="modelos">
        ${this.lista(p.id)}
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
          <p class="ayuda modelos-precio" data-precio>…</p>
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

    // The cap is global (one number for whichever model is active) and lives in this browser.
    q<HTMLInputElement>("[name=tope]")?.addEventListener("change", (ev) => {
      const valor = Number((ev.target as HTMLInputElement).value);
      guardarTope(Number.isFinite(valor) && valor > 0 ? valor : null);
    });

    // The rate of what is typed in the model field, so the choice is made knowing the price.
    const precio = q<HTMLElement>("[data-precio]");
    let pedidoPrecio = 0;
    const pintarPrecio = async (): Promise<void> => {
      const modelo = q<HTMLInputElement>("[name=modelo]")?.value.trim() ?? "";
      const n = ++pedidoPrecio;
      if (!precio) return;
      if (modelo === "" && p.necesitaClave) {
        precio.textContent = "";
        return;
      }
      try {
        const res = await fetch(`/api/precios?proveedor=${encodeURIComponent(p.id)}&modelo=${encodeURIComponent(modelo)}`, { cache: "no-store" });
        const datos = (await res.json()) as { tarifa?: Tarifa | null; fecha?: string | null };
        if (n !== pedidoPrecio) return;
        precio.textContent = textoTarifa(p.id, datos.tarifa ?? null, datos.fecha ?? null);
      } catch {
        if (n === pedidoPrecio) precio.textContent = "";
      }
    };
    void pintarPrecio();
    let esperaPrecio = 0;
    q<HTMLInputElement>("[name=modelo]")?.addEventListener("input", () => {
      window.clearTimeout(esperaPrecio);
      esperaPrecio = window.setTimeout(() => void pintarPrecio(), 400);
    });
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

  /** The left column: the LLM providers, then the GPU ones under their own heading. */
  private lista(elegido: string): string {
    const tx = (a: string, b: string): string => this.tx(a, b);
    const estado = this.estado!;
    const gpu = this.estadoGpu;
    return `<ul class="modelos-lista">
      ${estado.proveedores
        .map(
          (x) => `<li><button type="button" data-prov="${x.id}" class="${x.id === elegido ? "activo" : ""}">
            <span>${escapar(x.nombre)}</span>
            <small>${x.id === estado.activo ? tx("en uso", "in use") : x.tieneClave || !x.necesitaClave ? "✓" : ""}</small>
          </button></li>`,
        )
        .join("")}
      ${
        gpu
          ? `<li class="modelos-grupo"><small>${tx("GPU (alquiler por horas)", "GPU (rented by the hour)")}</small></li>` +
            gpu.proveedores
              .map(
                (g) => `<li><button type="button" data-prov="${PREFIJO_GPU}${g.id}" class="${PREFIJO_GPU + g.id === elegido ? "activo" : ""}">
                  <span>${escapar(g.nombre)}</span>
                  <small>${gpu.activo === g.id ? (gpu.disponible ? tx("encendida", "on") : tx("incompleta", "incomplete")) : tx("apagada", "off")}</small>
                </button></li>`,
              )
              .join("")
          : ""
      }
    </ul>`;
  }

  private pintarGpu(estado: EstadoGpu): void {
    const tx = (a: string, b: string): string => this.tx(a, b);
    const g = estado.proveedores.find((x) => PREFIJO_GPU + x.id === this.elegido) ?? estado.proveedores[0]!;
    const enUso = estado.activo === g.id;
    const origen = (c: CampoGpuVista): string =>
      c.origen === "ajustes"
        ? tx("guardado aquí", "saved here")
        : c.origen === "env"
          ? `${c.variableEnv} ${tx("del .env", "from .env")}`
          : c.origen === "defecto"
            ? `${tx("por defecto", "default")}: ${c.porDefecto}`
            : tx("falta", "missing");
    const campo = (c: CampoGpuVista): string => {
      const etiqueta = escapar(idioma() === "es" ? c.es : c.en);
      if (c.secreto) {
        return `<label>${etiqueta}
          <input name="gpu-${c.clave}" type="password" autocomplete="off" placeholder="${escapar(
            c.tiene ? `${tx("guardada", "saved")}: ${c.oculta ?? ""} (${origen(c)})` : tx("pega aquí la clave", "paste the key here"),
          )}">
        </label>`;
      }
      // Only a value saved here fills the box; one from .env or a default is the placeholder,
      // so saving does not copy .env into the settings.
      const propio = c.origen === "ajustes" ? (c.valor ?? "") : "";
      const sugerido = c.origen === "env" ? (c.valor ?? "") : c.porDefecto;
      return `<label>${etiqueta}
        <input name="gpu-${c.clave}" value="${escapar(propio)}" placeholder="${escapar(sugerido)}">
        <small class="ayuda">${escapar(origen(c))}</small>
      </label>`;
    };

    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza">
        <strong>${tx("Modelos", "Models")}</strong>
        <button type="button" class="icon" data-cerrar title="${tx("Cerrar", "Close")}">✕</button>
      </div>
      <p class="modelos-actual">GPU: <b>${
        estado.activo === "" ? tx("apagada", "off") : escapar(estado.proveedores.find((x) => x.id === estado.activo)?.nombre ?? estado.activo)
      }</b>${estado.activoDesde === "env" ? ` <small class="ayuda">(${tx("lo decide MIUZIKA_LAMBDA del .env", "set by MIUZIKA_LAMBDA in .env")})</small>` : ""}</p>
      <div class="modelos">
        ${this.lista(this.elegido)}
        <div class="modelos-detalle">
          <h3>${escapar(g.nombre)}</h3>
          <p class="ayuda">${escapar(idioma() === "es" ? g.ayuda.es : g.ayuda.en)}</p>
          ${g.campos.map(campo).join("")}
          ${enUso && !estado.disponible ? `<p class="modelos-mensaje error">${escapar(estado.faltan.join(" · "))}</p>` : ""}
          <p class="modelos-mensaje" data-mensaje></p>
          <div class="dialogo-acciones">
            ${g.campos.some((c) => c.secreto && c.origen === "ajustes") ? `<button type="button" data-borrar>${tx("Borrar clave", "Remove key")}</button>` : ""}
            <button type="button" data-probar>${tx("Probar", "Test")}</button>
            <button type="button" data-guardar>${tx("Guardar", "Save")}</button>
            ${
              enUso
                ? `<button type="button" data-apagar-gpu>${tx("No usar GPU", "Do not use the GPU")}</button>`
                : `<button type="button" class="primario" data-usar>${tx("Usar esta GPU", "Use this GPU")}</button>`
            }
          </div>
          <p class="ayuda">${tx(
            "Probar sólo lista las instancias: no enciende nada ni cuesta dinero. Con la GPU apagada, las herramientas de GPU no se pueden usar.",
            "Test only lists the instances: it starts nothing and costs nothing. With the GPU off, the GPU tools cannot be used.",
          )}</p>
        </div>
      </div>`;

    const q = <T extends Element>(sel: string): T | null => this.dialogo.querySelector<T>(sel);
    const mensaje = q<HTMLElement>("[data-mensaje]")!;
    const decir = (texto: string, error = false): void => {
      mensaje.textContent = texto;
      mensaje.classList.toggle("error", error);
    };
    const campos = (): Record<string, string> =>
      Object.fromEntries(g.campos.map((c) => [c.clave, q<HTMLInputElement>(`[name=gpu-${c.clave}]`)?.value.trim() ?? ""]));
    const enviar = async (accion: string, conCampos = true): Promise<boolean> => {
      try {
        const res = await fetch("/api/proveedores/gpu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion, id: g.id, ...(conCampos ? { campos: campos() } : {}) }),
        });
        const datos = (await res.json()) as EstadoGpu & { error?: string };
        if (!res.ok) throw new Error(datos.error ?? `HTTP ${res.status}`);
        this.estadoGpu = datos;
        return true;
      } catch (error) {
        decir(error instanceof Error ? error.message : String(error), true);
        return false;
      }
    };
    const repintar = (texto: string): void => {
      this.pintar();
      const m = this.dialogo.querySelector<HTMLElement>("[data-mensaje]");
      if (m) m.textContent = texto;
    };

    this.dialogo.querySelectorAll("[data-cerrar]").forEach((b) => b.addEventListener("click", () => this.dialogo.close()));
    this.dialogo.querySelectorAll<HTMLButtonElement>("[data-prov]").forEach((b) =>
      b.addEventListener("click", () => {
        this.elegido = b.dataset.prov!;
        this.pintar();
      }),
    );
    q("[data-guardar]")?.addEventListener("click", async () => {
      if (await enviar("guardar")) repintar(tx("Guardado.", "Saved."));
    });
    q("[data-usar]")?.addEventListener("click", async () => {
      if (await enviar("activar")) repintar(tx("Hecho: las herramientas de GPU usan este proveedor.", "Done: the GPU tools use this provider."));
    });
    q("[data-apagar-gpu]")?.addEventListener("click", async () => {
      if (await enviar("desactivar", false)) repintar(tx("GPU desactivada: no se encenderá ninguna instancia.", "GPU off: no instance will be started."));
    });
    q("[data-borrar]")?.addEventListener("click", async () => {
      if (await enviar("borrarClave", false)) repintar(tx("Clave borrada (si el .env tiene una, se usa esa).", "Key removed (the .env one is used if there is one)."));
    });
    q("[data-probar]")?.addEventListener("click", async () => {
      decir(tx("Probando…", "Testing…"));
      if (!(await enviar("guardar"))) return;
      try {
        const r = (await (await fetch("/api/gpu/estado", { cache: "no-store" })).json()) as {
          configurado?: boolean;
          faltan?: string[];
          fase?: string;
          instancias?: unknown[];
          ssh?: { ok: boolean; detalle: string };
          error?: string;
        };
        if (r.error) decir(`✗ ${r.error}`, true);
        else if (!r.configurado) decir(`✗ ${(r.faltan ?? []).join(" · ")}`, true);
        else
          decir(
            `✓ ${tx("Responde", "Replies")}: ${r.fase ?? "?"} · ${(r.instancias ?? []).length} ${tx("instancia(s) en la cuenta", "instance(s) on the account")} · ssh ${r.ssh?.ok ? "ok" : `✗ ${r.ssh?.detalle ?? ""}`}`,
            r.ssh?.ok === false,
          );
      } catch (error) {
        decir(`✗ ${error instanceof Error ? error.message : String(error)}`, true);
      }
    });
  }
}

/**
 * The effects of a track: its chain, opened from the "FX" of the track head. Add, remove, switch on and off, reorder,
 * and one slider per parameter (drawn from DEVICE_PARAMS through `src/core/efectos.ts`).
 *
 * A slider is heard while it moves: each movement is written on the running engine (`oir`), with no remount, and
 * releasing it records ONE set_device, so one Ctrl+Z undoes the whole drag. Measured headless: a reverb's wet from 0
 * to 0.8 with the project playing changed the level between hits from 0.00001 to 0.0086 on the same engine, and 40
 * writes in 1.2 s left no page error. Adding, removing or moving an effect changes the structure: a playing engine is
 * mounted again from where it was (a short gap), as when a clip moves.
 *
 * Not modal, unlike the instrument picker: Play, mute and solo have to stay in reach while a chain is being set.
 */

import type { Op } from "../../src/core/ops.ts";
import { DEVICE_TYPES, type Device, type DeviceType, type Project, type Track } from "../../src/core/types.ts";
import {
  NOMBRE_EFECTO,
  PASOS,
  controlesDe,
  formatearValor,
  posicionDeValor,
  valorDePosicion,
  type ControlEfecto,
} from "../../src/core/efectos.ts";

const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export class PanelEfectos {
  private readonly dialogo: HTMLDialogElement;
  private pista: string | null = null;
  /** The change in hand came from this panel: its own controls are already right, and redrawing them would drop the focus. */
  private propio = false;

  constructor(
    private readonly d: {
      proyecto(): Project | null;
      /** Writes a project that is not committed yet on the running engine: the slider being dragged. */
      oir(vista: Project): void;
      /** Commits the ops as one undo step. False if it could not (the app busy, or an op refused: already said in the Log). */
      aplicar(ops: Op[], estructura: boolean): boolean;
      /** The track's audio plays outside the engine (a WAV too long for its memory), so its chain is not heard. */
      fueraDelMotor(track: Track): boolean;
    },
  ) {
    this.dialogo = document.createElement("dialog");
    this.dialogo.className = "dialogo panel-efectos";
    document.body.append(this.dialogo);

    this.dialogo.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      if (el.type !== "range" || !el.dataset.param) return;
      const lugar = this.lugarDe(el);
      if (!lugar) return;
      const valor = valorDePosicion(lugar.control, Number(el.value));
      el.nextElementSibling!.textContent = formatearValor(lugar.control, valor);
      const vista = this.d.proyecto();
      if (vista) this.d.oir(conParametro(vista, lugar.pista.id, lugar.device.id, lugar.control.clave, valor));
    });

    this.dialogo.addEventListener("change", (e) => {
      const el = e.target as HTMLInputElement;
      const lugar = this.lugarDe(el);
      if (el.dataset.accion === "encender" && lugar) {
        this.cambiar([{ op: "set_device", trackId: lugar.pista.id, deviceId: lugar.device.id, enabled: el.checked }], false, true);
        el.closest(".fx-efecto")?.classList.toggle("apagado", !el.checked);
        return;
      }
      if (!el.dataset.param || !lugar) return;
      const valor = el.type === "checkbox" ? (el.checked ? 1 : 0) : valorDePosicion(lugar.control, Number(el.value));
      if (lugar.device.params[lugar.control.clave] === valor) return;
      this.cambiar(
        [{ op: "set_device", trackId: lugar.pista.id, deviceId: lugar.device.id, params: { [lugar.control.clave]: valor } }],
        false,
        true,
      );
    });

    this.dialogo.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("button[data-accion]");
      if (!el) return;
      const accion = el.dataset.accion;
      if (accion === "cerrar") {
        this.dialogo.close();
        return;
      }
      const pista = this.actual();
      if (!pista) return;
      if (accion === "anadir") {
        const tipo = this.dialogo.querySelector<HTMLSelectElement>('select[name="tipo"]')?.value as DeviceType | undefined;
        if (tipo) this.cambiar([{ op: "add_device", trackId: pista.id, device: { type: tipo } }], true, false);
        return;
      }
      const id = el.closest<HTMLElement>("[data-device]")?.dataset.device;
      const indice = pista.devices.findIndex((device) => device.id === id);
      if (!id || indice < 0) return;
      if (accion === "quitar") this.cambiar([{ op: "remove_device", trackId: pista.id, deviceId: id }], true, false);
      if (accion === "subir" && indice > 0) {
        this.cambiar([{ op: "move_device", trackId: pista.id, deviceId: id, index: indice - 1 }], true, false);
      }
      if (accion === "bajar" && indice < pista.devices.length - 1) {
        this.cambiar([{ op: "move_device", trackId: pista.id, deviceId: id, index: indice + 1 }], true, false);
      }
    });
  }

  abrir(trackId: string): void {
    if (!this.d.proyecto()?.tracks.some((t) => t.id === trackId)) return;
    this.pista = trackId;
    this.pintar();
    if (!this.dialogo.open) this.dialogo.show();
  }

  /** The project changed from outside (undo, another project, a track deleted): the chain shown may be stale. */
  proyectoCambiado(): void {
    if (!this.dialogo.open || this.propio) return;
    if (!this.actual()) {
      this.dialogo.close();
      return;
    }
    this.pintar();
  }

  private actual(): Track | undefined {
    return this.d.proyecto()?.tracks.find((t) => t.id === this.pista);
  }

  private lugarDe(el: HTMLElement): { pista: Track; device: Device; control: ControlEfecto } | null {
    const pista = this.actual();
    const id = el.closest<HTMLElement>("[data-device]")?.dataset.device;
    const device = pista?.devices.find((d) => d.id === id);
    if (!pista || !device) return null;
    const control = controlesDe(device.type).find((c) => c.clave === el.dataset.param) ?? controlesDe(device.type)[0]!;
    return { pista, device, control };
  }

  /** `conservar`: the controls on screen already show the change, so they are left alone (and the focus with them). */
  private cambiar(ops: Op[], estructura: boolean, conservar: boolean): void {
    this.propio = true;
    let hecho = false;
    try {
      hecho = this.d.aplicar(ops, estructura);
    } finally {
      this.propio = false;
    }
    // A slider dragged and not committed left its value on the engine: back to what the project says.
    const vista = this.d.proyecto();
    if (!hecho && vista) this.d.oir(vista);
    if (!hecho || !conservar) this.pintar();
    this.estado(hecho ? "" : "Not applied: the app is busy or the change was refused (see the Log). Try again in a moment.");
  }

  private estado(texto: string): void {
    const linea = this.dialogo.querySelector<HTMLElement>(".fx-estado");
    if (linea) linea.textContent = texto;
  }

  private pintar(): void {
    const pista = this.actual();
    if (!pista) return;
    const elegido = this.dialogo.querySelector<HTMLSelectElement>('select[name="tipo"]')?.value;
    const cadena = pista.devices
      .map((device, indice) => {
        const controles = controlesDe(device.type)
          .map((control) => {
            const valor = device.params[control.clave] ?? control.min;
            if (control.interruptor) {
              return `<label class="fx-control fx-interruptor"><input type="checkbox" data-param="${control.clave}"${valor >= 0.5 ? " checked" : ""}> <span>${esc(control.etiqueta)}</span></label>`;
            }
            return `<label class="fx-control"><span>${esc(control.etiqueta)}</span><input type="range" min="0" max="${PASOS}" step="1" data-param="${control.clave}" value="${posicionDeValor(control, valor)}"><output>${esc(formatearValor(control, valor))}</output></label>`;
          })
          .join("");
        return `<section class="fx-efecto${device.enabled ? "" : " apagado"}" data-device="${esc(device.id)}">
          <div class="fx-titulo">
            <label title="On / off: off, it keeps its values and does not sound"><input type="checkbox" data-accion="encender"${device.enabled ? " checked" : ""}> <strong>${indice + 1}. ${esc(NOMBRE_EFECTO[device.type])}</strong></label>
            <span class="fx-botones">
              <button type="button" data-accion="subir" title="Earlier in the chain"${indice === 0 ? " disabled" : ""}>↑</button>
              <button type="button" data-accion="bajar" title="Later in the chain"${indice === pista.devices.length - 1 ? " disabled" : ""}>↓</button>
              <button type="button" data-accion="quitar" title="Remove this effect">✕</button>
            </span>
          </div>
          <div class="fx-controles">${controles}</div>
        </section>`;
      })
      .join("");
    const opciones = DEVICE_TYPES.map(
      (tipo) => `<option value="${tipo}"${tipo === elegido ? " selected" : ""}>${esc(NOMBRE_EFECTO[tipo])}</option>`,
    ).join("");
    const scroll = this.dialogo.querySelector(".fx-cadena")?.scrollTop ?? 0;
    this.dialogo.innerHTML = `
      <div class="dialogo-cabeza"><strong>Effects · ${esc(pista.name)}</strong><button type="button" class="icon" data-accion="cerrar" title="Close">✕</button></div>
      <p class="ace-nota">The sound goes through the chain from top to bottom. A slider is heard while it moves. Adding, removing or moving an effect while playing leaves a short gap. Ctrl+Z undoes each change.</p>
      ${
        this.d.fueraDelMotor(pista)
          ? `<p class="ace-nota fx-aviso">This track's audio is too long for the engine's memory: it plays and exports with its gain and pan, but without these effects.</p>`
          : ""
      }
      <div class="fx-cadena">${cadena || `<p class="ace-nota">No effects on this track yet.</p>`}</div>
      <div class="fx-anadir"><select name="tipo" title="Effect to add">${opciones}</select><button type="button" data-accion="anadir">Add effect</button></div>
      <p class="ace-nota fx-estado" role="status"></p>`;
    const lista = this.dialogo.querySelector(".fx-cadena");
    if (lista) lista.scrollTop = scroll;
  }
}

/** The project with one parameter changed, sharing everything else: made on every movement of a slider. */
function conParametro(vista: Project, trackId: string, deviceId: string, clave: string, valor: number): Project {
  return {
    ...vista,
    tracks: vista.tracks.map((track) =>
      track.id !== trackId
        ? track
        : {
            ...track,
            devices: track.devices.map((device) =>
              device.id !== deviceId ? device : { ...device, params: { ...device.params, [clave]: valor } },
            ),
          },
    ),
  };
}

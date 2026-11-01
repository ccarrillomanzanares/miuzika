/**
 * Cost cap per turn (USD), set in "Models" and kept in this browser.
 *
 * Why (1-Nov): a composing turn is more than a million input tokens; with a frontier
 * model that is euros, not cents, and the paid tier cannot exist without a cap. The
 * agent loop asks `motivoDeTope` before every model call and stops with a notice when
 * the turn's cost (coste-llm.ts, priced with OpenRouter's list) reaches the cap.
 * 0 or empty = no cap. With an unknown rate nothing can be measured, so nothing stops.
 */

import { usd } from "./coste-texto.ts";
import { t } from "./i18n.ts";

const CLAVE = "miuzika.llm.topeTurno.v1";

export function leerTope(): number | null {
  try {
    const n = Number(localStorage.getItem(CLAVE));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export function guardarTope(valor: number | null): void {
  try {
    if (valor === null || !Number.isFinite(valor) || valor <= 0) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, String(valor));
  } catch {
    /* no persistence */
  }
}

/** The notice that ends the turn, or null while under the cap. Pure, with tests. */
export function motivoDeTope(gastado: number | null, tope: number | null): string | null {
  if (tope === null || gastado === null || gastado < tope) return null;
  return (
    `${t("tope.parado", "I stopped: this turn has already cost")} ${usd(gastado)} ` +
    `${t("tope.limite", "and the cap set in Models is")} ${usd(tope)}. ` +
    t("tope.cola", "Whatever was written to disk stays. Raise the cap in Models or tell me “continue”.")
  );
}

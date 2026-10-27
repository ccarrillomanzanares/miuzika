/**
 * Notación compacta de notas, para que el agente escriba música sin JSON.
 *
 * Medido el 27-oct: escribir 8 compases de bajo, batería y guitarra como listas
 * `{"pitch":38,"start":0,"duration":2,"velocity":96}` costó 10.348 tokens y 41 s
 * en UNA respuesta, y cada llamada siguiente reenviaba esas listas. En esta
 * notación lo mismo ocupa entre 5 y 10 veces menos y se lee como una partitura:
 *
 *     "D2:1.5 D2:.5 F2 Eb2 | D2 C2 D2 r | [D3 F3 A3]:4"
 *
 * Reglas (las mismas que lee el modelo en la descripción de escribir_notas):
 *  - nota = letra (A-G) o solfeo (do re mi fa sol la si), alteración (# b), octava
 *    con C4 = 60 (do4 = 60). También vale un número MIDI (38).
 *  - `:dur` en negras (1 = negra, .5 = corchea, 1/3 = tresillo, 4 = redonda en 4/4).
 *    Si falta, se repite la anterior (al principio, 1).
 *  - `!vel` velocidad 1-127 sólo para esa nota (`D2!115`).
 *  - `r` (o `-`) es silencio; `[D3 F3 A3]` o `D3+F3+A3` es un acorde.
 *  - `|` es una barra de compás: se ignora (sólo ayuda a leer).
 *  - `~` al final de una nota la liga con la siguiente si es la misma altura.
 *  - `( … )x4` repite el grupo 4 veces (se pueden anidar): un riff de un compás
 *    tocado cuatro veces ya no son 32 notas escritas, son 8 y un `x4`.
 */

import type { Note } from "./types.ts";

const LETRAS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SOLFEO: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };

export class ErrorNotacion extends Error {}

/** "D2" → 38, "Eb4" → 63, "do4" → 60, "sol#3" → 56, "38" → 38. */
export function alturaDe(texto: string): number {
  const limpio = texto.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  if (/^\d{1,3}$/.test(limpio)) {
    const n = Number(limpio);
    if (n > 127) throw new ErrorNotacion(`«${texto}» no es una nota MIDI (0-127)`);
    return n;
  }
  const m = /^(do|re|mi|fa|sol|la|si|[a-g])(#{1,2}|b{1,2})?(-?\d)$/i.exec(limpio);
  if (!m) throw new ErrorNotacion(`«${texto}» no es una nota: usa letra u solfeo, alteración y octava (D2, Eb4, sol3)`);
  const nombre = m[1]!.toLowerCase();
  const base = SOLFEO[nombre] ?? LETRAS[nombre]!;
  const alteracion = (m[2] ?? "").split("").reduce((suma, c) => suma + (c === "#" ? 1 : -1), 0);
  const pitch = (Number(m[3]) + 1) * 12 + base + alteracion;
  if (pitch < 0 || pitch > 127) throw new ErrorNotacion(`«${texto}» se sale del rango MIDI`);
  return pitch;
}

function duracionDe(texto: string, token: string): number {
  const fraccion = /^(\d+)\/(\d+)$/.exec(texto);
  const valor = fraccion ? Number(fraccion[1]) / Number(fraccion[2]) : Number(texto);
  if (!Number.isFinite(valor) || valor <= 0 || valor > 64) {
    throw new ErrorNotacion(`duración no válida en «${token}» (negras: 1, .5, 1/3, 4…)`);
  }
  return valor;
}

/** Separa en elementos respetando los corchetes de los acordes. */
function trocear(texto: string): string[] {
  const elementos: string[] = [];
  let actual = "";
  let dentro = false;
  for (const c of texto) {
    if (c === "[") dentro = true;
    if (c === "]") dentro = false;
    if (/\s/.test(c) && !dentro) {
      if (actual) elementos.push(actual);
      actual = "";
      continue;
    }
    actual += c;
  }
  if (dentro) throw new ErrorNotacion("falta cerrar un acorde con «]»");
  if (actual) elementos.push(actual);
  return elementos;
}

export interface ResultadoNotacion {
  notas: Note[];
  /** Negras que ocupa la frase (con los silencios). */
  beats: number;
  /** Negras de cada tramo entre barras «|», en orden (para comprobar los compases). */
  tramos: number[];
}

/**
 * Tramos entre barras que no cuadran con el compás: cada tramo tiene que medir un
 * número entero de compases. El último puede quedarse corto (la frase acaba antes).
 * Medido el 27-oct: dos compases de 5 negras en un estribillo desplazaron todo lo
 * que venía detrás.
 */
export function tramosIrregulares(tramos: readonly number[], beatsPorCompas: number): string[] {
  const avisos: string[] = [];
  tramos.forEach((beats, i) => {
    const compases = beats / beatsPorCompas;
    const entero = Math.abs(compases - Math.round(compases)) < 1e-3 && Math.round(compases) >= 1;
    const ultimo = i === tramos.length - 1;
    if (!entero && !(ultimo && beats < beatsPorCompas)) {
      avisos.push(`el tramo ${i + 1} (entre barras) mide ${Number(beats.toFixed(3))} negras y el compás tiene ${beatsPorCompas}`);
    }
  });
  return avisos;
}

/** Máximo de elementos tras desplegar las repeticiones (un `x1000` no cuelga nada). */
const MAX_ELEMENTOS = 8000;

/** Despliega `( … )xN` (también `*N` o `×N`), de dentro hacia fuera. */
export function desplegarRepeticiones(texto: string): string {
  let actual = texto;
  const grupo = /\(([^()]*)\)\s*[x×*]\s*(\d{1,3})/;
  for (let vuelta = 0; vuelta < 100 && grupo.test(actual); vuelta += 1) {
    actual = actual.replace(grupo, (_, dentro: string, veces: string) => {
      const n = Number(veces);
      if (n < 1) throw new ErrorNotacion("una repetición necesita x1 o más");
      // Unidas con espacio, no con barra: el grupo puede no medir un compás entero
      // («(E2:.5 B2 E3 B2)x4» son cuatro medios compases que forman dos compases).
      return Array.from({ length: n }, () => dentro.trim()).join(" ");
    });
    if (actual.length > MAX_ELEMENTOS * 12) throw new ErrorNotacion("demasiadas repeticiones: parte la frase");
  }
  if (/[()]/.test(actual)) throw new ErrorNotacion("paréntesis sin cerrar o sin «xN» detrás");
  return actual;
}

export function leerNotacion(texto: string, velocidad = 90): ResultadoNotacion {
  texto = desplegarRepeticiones(texto);
  const notas: Note[] = [];
  let t = 0;
  let duracion = 1;
  /** Notas que esperan ligadura: altura → índice en `notas`. */
  let ligadas = new Map<number, number>();
  const tramos: number[] = [];
  let inicioTramo = 0;
  for (const token of trocear(texto)) {
    if (token === "|") {
      if (t > inicioTramo + 1e-9) tramos.push(Number((t - inicioTramo).toFixed(4)));
      inicioTramo = t;
      continue;
    }
    const m = /^(\[[^\]]+\]|[^:!~]+)(?::([^!~]+))?(?:!(\d{1,3}))?(~)?$/.exec(token);
    if (!m) throw new ErrorNotacion(`no entiendo «${token}»`);
    const [, cabeza, dur, vel, liga] = m;
    if (dur !== undefined) duracion = duracionDe(dur, token);
    const v = vel !== undefined ? Math.min(127, Math.max(1, Number(vel))) : velocidad;
    const nombres = cabeza!.startsWith("[")
      ? cabeza!.slice(1, -1).trim().split(/\s+/)
      : cabeza!.split("+");
    const siguientesLigadas = new Map<number, number>();
    if (!(nombres.length === 1 && /^(r|-)$/i.test(nombres[0]!))) {
      for (const nombre of nombres) {
        const pitch = alturaDe(nombre);
        const previa = ligadas.get(pitch);
        if (previa !== undefined) {
          // Ligadura: la nota anterior se alarga en vez de repetirse.
          notas[previa]!.duration = Number((notas[previa]!.duration + duracion).toFixed(4));
          if (liga) siguientesLigadas.set(pitch, previa);
          continue;
        }
        notas.push({ pitch, start: Number(t.toFixed(4)), duration: Number(duracion.toFixed(4)), velocity: v });
        if (liga) siguientesLigadas.set(pitch, notas.length - 1);
      }
    }
    ligadas = siguientesLigadas;
    t += duracion;
  }
  if (notas.length === 0) throw new ErrorNotacion("la frase no tiene ninguna nota");
  if (t > inicioTramo + 1e-9) tramos.push(Number((t - inicioTramo).toFixed(4)));
  return { notas, beats: Number(t.toFixed(4)), tramos };
}

const NOMBRES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

function nombreCorto(pitch: number): string {
  return `${NOMBRES[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;
}

function numero(valor: number): string {
  const redondo = Number(valor.toFixed(3));
  return String(redondo).replace(/^0\./, ".");
}

/**
 * Notas → notación compacta, para que el agente LEA un clip igual que lo escribe.
 * Sólo si la línea es secuencial (cada nota o acorde empieza cuando acaba el
 * anterior, o después con un silencio). Si hay polifonía que se solapa, null.
 */
export function aNotacion(notas: readonly Note[]): string | null {
  const ordenadas = [...notas].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const grupos: Note[][] = [];
  for (const nota of ordenadas) {
    const ultimo = grupos.at(-1);
    if (ultimo && Math.abs(ultimo[0]!.start - nota.start) < 1e-6) ultimo.push(nota);
    else grupos.push([nota]);
  }
  const partes: string[] = [];
  let t = 0;
  let durAnterior = -1;
  for (const grupo of grupos) {
    const inicio = grupo[0]!.start;
    const dur = grupo[0]!.duration;
    if (grupo.some((n) => Math.abs(n.duration - dur) > 1e-6)) return null;
    if (inicio < t - 1e-6) return null;
    if (inicio > t + 1e-6) {
      const silencio = inicio - t;
      partes.push(`r${Math.abs(silencio - durAnterior) < 1e-6 ? "" : `:${numero(silencio)}`}`);
      durAnterior = silencio;
    }
    const cabeza = grupo.length === 1 ? nombreCorto(grupo[0]!.pitch) : `[${grupo.map((n) => nombreCorto(n.pitch)).join(" ")}]`;
    const vel = grupo[0]!.velocity;
    partes.push(`${cabeza}${Math.abs(dur - durAnterior) < 1e-6 ? "" : `:${numero(dur)}`}${vel !== 90 ? `!${vel}` : ""}`);
    durAnterior = dur;
    t = inicio + dur;
  }
  return partes.join(" ");
}

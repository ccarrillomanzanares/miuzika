/**
 * Finding a track from what a person or the model wrote: id, name, "pista 2", part of a name.
 *
 * Why one place (review of 3-Nov, section 4): five copies drifted apart. `ops` ignored case but
 * not accents ("Organo" did not find "Órgano"), restoring a version ignored accents but not
 * "pista 2", and the agent's actions found "batería oscura" from "Batería" while ops did not.
 *
 * Order: exact id, name (no accents or case), unique id prefix, 1-based index ("2", "pista 2",
 * "track 2", "trk 2"), and only with `parcial` a unique partial name in either direction.
 * A name shared by two tracks finds neither: guessing which one would edit the wrong track.
 */
import { normalizarTexto } from "./nombres.ts";

interface ConNombre {
  id: string;
  name: string;
}

export function buscarPista<T extends ConNombre>(pistas: readonly T[], ref: string, opciones: { parcial?: boolean } = {}): T | undefined {
  const limpia = ref.trim();
  if (limpia === "") return undefined;
  const porId = pistas.find((p) => p.id === limpia);
  if (porId) return porId;

  const buscado = normalizarTexto(limpia);
  const porNombre = pistas.filter((p) => normalizarTexto(p.name) === buscado);
  if (porNombre.length === 1) return porNombre[0];

  const porPrefijo = pistas.filter((p) => p.id.startsWith(limpia));
  if (porPrefijo.length === 1) return porPrefijo[0];

  const indice = /^(?:track|pista|trk)?\s*(\d+)$/i.exec(limpia);
  if (indice) {
    const i = Number(indice[1]) - 1;
    if (i >= 0 && i < pistas.length) return pistas[i];
  }

  if (opciones.parcial && porNombre.length === 0) {
    const parecidas = pistas.filter((p) => {
      const nombre = normalizarTexto(p.name);
      return nombre !== "" && (nombre.includes(buscado) || buscado.includes(nombre));
    });
    if (parecidas.length === 1) return parecidas[0];
  }
  return undefined;
}

/** "1:trk_bajo(Bajo), 2:…": what to show when a track is not found. */
export function listaDePistas(pistas: readonly ConNombre[]): string {
  return pistas.map((p, i) => `${i + 1}:${p.id}(${p.name})`).join(", ");
}

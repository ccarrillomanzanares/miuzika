/**
 * Plantilla de encargo: lo que el botón «Plantilla» escribe en el compositor.
 *
 * Dos partes y en este orden:
 *  1. Los huecos del encargo (proyecto, entrega, referencia, tempo…). Siempre iguales:
 *     así el agente recibe la misma estructura en cada petición.
 *  2. El CONTEXTO MEDIDO del proyecto que se pide: BPM, compás, compases, tonalidad y
 *     las pistas que ya tiene. Eso no se lo inventa el usuario: sale del proyecto.
 *
 * Lo que NO se pone aquí: el prompt del sistema (vive en agente-prompt.ts, con su
 * huella) ni las firmas del motor (van en el manifiesto).
 */

export interface PistaDeContexto {
  nombre: string;
  tipo: string;
  notas: number;
  silenciada?: boolean;
}

export interface ContextoProyecto {
  nombre: string;
  bpm: number;
  compas: string;
  compases: number;
  tonalidad: string;
  pistas: PistaDeContexto[];
  material: string[];
}

const HUECOS = [
  "Proyecto: ",
  "Entrega: MIDI",
  "Referencia: (enlace de YouTube o ruta de un audio) · modo: versión | inspiración",
  "Tempo: BPM en 4/4 · N compases · tonalidad",
  "Instrumentos: ",
  "Estructura: compases 1-8 … · 9-16 … · 17-24 …",
  "Carácter: ",
  "Qué NO quiero: ",
  "Final: cómo acaba y cuánta cola",
  "Comprobación: al terminar, dime BPM, compases y duración real del render",
];

/** Duración real del proyecto en segundos (4/4 asumido por compás). */
function segundosDe(compases: number, bpm: number, compas: string): number {
  const [numerador, denominador] = compas.split("/").map((valor) => Number(valor) || 4);
  const negrasPorCompas = (numerador / denominador) * 4;
  return Math.round((compases * negrasPorCompas * 60) / Math.max(bpm, 1));
}

function minutosYsegundos(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return `${minutos}:${String(resto).padStart(2, "0")}`;
}

function bloqueDeContexto(contexto: ContextoProyecto): string[] {
  const segundos = segundosDe(contexto.compases, contexto.bpm, contexto.compas);
  const lineas = [
    "",
    "Contexto medido del proyecto (no lo cambies sin decirlo):",
    `- ${contexto.bpm} BPM en ${contexto.compas} · ${contexto.compases} compases (${minutosYsegundos(segundos)}) · ${contexto.tonalidad}`,
  ];
  if (contexto.pistas.length === 0) {
    lineas.push("- pistas: ninguna todavía");
  } else {
    const detalle = contexto.pistas
      .map((pista) => `${pista.nombre} (${pista.tipo}${pista.notas > 0 ? `, ${pista.notas} n` : ""}${pista.silenciada ? ", silenciada" : ""})`)
      .join(" · ");
    lineas.push(`- pistas (${contexto.pistas.length}): ${detalle}`);
  }
  lineas.push(
    contexto.material.length > 0
      ? `- material en salida/: ${contexto.material.join(", ")}`
      : "- salida/: vacía",
  );
  return lineas;
}

/**
 * Texto completo para el compositor. Con proyecto, el campo «Proyecto» viene relleno
 * y se añade su contexto; sin proyecto, quedan los huecos y una nota de que no hay
 * ninguno abierto (el agente tiene que preguntar el nombre).
 */
export function plantillaEncargo(contexto: ContextoProyecto | null): string {
  const lineas = [...HUECOS];
  if (contexto) {
    lineas[0] = `Proyecto: ${contexto.nombre}`;
    lineas[3] = `Tempo: ${contexto.bpm} BPM en ${contexto.compas} · ${contexto.compases} compases · ${contexto.tonalidad}`;
    lineas.push(...bloqueDeContexto(contexto));
  } else {
    lineas.push("", "Contexto: no hay proyecto abierto (dime el nombre antes de empezar).");
  }
  return lineas.join("\n");
}

/** Cursor: al final de la primera línea, que es lo primero que se escribe. */
export const CURSOR_PLANTILLA = "Proyecto: ".length;

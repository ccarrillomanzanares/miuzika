/** HTTP access to the project's master file (only exists in the dev server). */

export interface ProyectoListado {
  slug: string;
  ruta: string;
  nombre: string;
  bpm: number;
  compases: number;
  pistas: number;
  guardadoEn: string;
  actualizado: string;
  bytes: number;
  error?: string;
}

async function pedirJson(ruta: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(ruta, init);
  let datos: Record<string, unknown> = {};
  try {
    datos = (await res.json()) as Record<string, unknown>;
  } catch {
    /* response without JSON: the status code is used */
  }
  if (!res.ok) {
    throw new Error(String(datos.error ?? `${res.status} ${res.statusText}`));
  }
  return datos;
}

/** Projects with a proyecto.json in workspace/proyectos/, most recent first. */
export async function listarProyectos(): Promise<ProyectoListado[]> {
  const datos = await pedirJson("/api/proyectos");
  return (datos.proyectos ?? []) as ProyectoListado[];
}

/** Full contents of the master file (without the 20 KB truncation of /api/fs/read). */
export async function leerProyectoDeDisco(ruta: string): Promise<string> {
  const datos = await pedirJson(`/api/proyectos?path=${encodeURIComponent(ruta)}`);
  return String(datos.contenido ?? "");
}

/** Writes the master file (creates the project folder if it does not exist). */
export async function guardarProyectoEnDisco(ruta: string, contenido: string): Promise<void> {
  await pedirJson("/api/proyectos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ruta, contenido }),
  });
}

/**
 * Copies an audio file from the browser to `proyectos/<slug>/entrada/`. Returns the
 * relative path ("entrada/kick.wav") that the master file references it by.
 */
export async function subirAudio(
  file: File,
  slug: string,
  carpeta: "entrada" | "salida" = "entrada",
): Promise<{ path: string; bytes: number }> {
  const url =
    `/api/audio/subir?slug=${encodeURIComponent(slug)}&nombre=${encodeURIComponent(file.name)}` +
    (carpeta === "salida" ? "&carpeta=salida" : "");
  const datos = await pedirJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  return { path: String(datos.path ?? ""), bytes: Number(datos.bytes ?? 0) };
}

export interface ResultadoMp3 {
  /** false when the MP3 was written but its measurement disagrees with the WAV. */
  ok: boolean;
  ruta: string;
  bytes: number;
  kbps: number;
  mp3: { segundos: number | null; picoDb: number | null };
  problemas: string[];
}

/**
 * A WAV of the project to MP3 next to it (server/mp3.ts: 320 kbps CBR, `titulo` as ID3,
 * measured back against the WAV). `rutaWav` as the project sees it ("salida/x.wav").
 */
export async function convertirMp3(rutaWav: string, slug: string, titulo: string, senal?: AbortSignal): Promise<ResultadoMp3> {
  const datos = await pedirJson("/api/audio/mp3", {
    method: "POST",
    // Encoded like cabeceraDeProyecto (tools.ts): a header only carries Latin-1.
    headers: { "Content-Type": "application/json", "x-miuzika-proyecto": encodeURIComponent(slug) },
    body: JSON.stringify({ archivo: rutaWav, titulo }),
    signal: senal,
  });
  const mp3 = (datos.mp3 ?? {}) as { segundos?: number | null; picoDb?: number | null };
  return {
    ok: datos.ok === true,
    ruta: String(datos.ruta ?? ""),
    bytes: Number(datos.bytes ?? 0),
    kbps: Number(datos.kbps ?? 0),
    mp3: { segundos: mp3.segundos ?? null, picoDb: mp3.picoDb ?? null },
    problemas: Array.isArray(datos.problemas) ? datos.problemas.map(String) : [],
  };
}

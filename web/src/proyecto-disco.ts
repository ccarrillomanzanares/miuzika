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

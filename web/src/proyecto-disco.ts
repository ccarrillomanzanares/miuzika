/** Acceso HTTP al fichero maestro del proyecto (sólo existe en el servidor de dev). */

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
    /* respuesta sin JSON: se usa el código de estado */
  }
  if (!res.ok) {
    throw new Error(String(datos.error ?? `${res.status} ${res.statusText}`));
  }
  return datos;
}

/** Proyectos con proyecto.json en workspace/proyectos/, el más reciente primero. */
export async function listarProyectos(): Promise<ProyectoListado[]> {
  const datos = await pedirJson("/api/proyectos");
  return (datos.proyectos ?? []) as ProyectoListado[];
}

/** Contenido completo del fichero maestro (sin el recorte de 20 KB de /api/fs/read). */
export async function leerProyectoDeDisco(ruta: string): Promise<string> {
  const datos = await pedirJson(`/api/proyectos?path=${encodeURIComponent(ruta)}`);
  return String(datos.contenido ?? "");
}

/** Escribe el fichero maestro (crea la carpeta del proyecto si no existe). */
export async function guardarProyectoEnDisco(ruta: string, contenido: string): Promise<void> {
  await pedirJson("/api/proyectos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: ruta, contenido }),
  });
}

/**
 * Copia un audio del navegador a `proyectos/<slug>/entrada/`. Devuelve la ruta
 * relativa ("entrada/kick.wav") con la que el fichero maestro lo referencia.
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

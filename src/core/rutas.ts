/**
 * Carpetas del espacio de trabajo.
 *
 * Una sola lista para los dos lados: el servidor de desarrollo (`vite.config.ts`)
 * resuelve ahí las rutas que le llegan del agente, y el navegador (`audio-store.ts`)
 * construye con la misma regla la ruta que le pide al servidor. Antes eran dos
 * listas copiadas y ya se habían desincronizado: faltaba `catalogo/`.
 *
 * `compartidas`: viven en la raíz de `workspace/` y las usan todos los proyectos.
 * Todo lo demás (salida/, entrada/, sonidos/, instrumentos/, samples/) vive dentro
 * de la carpeta del proyecto abierto.
 */

export const CARPETAS_COMPARTIDAS = [
  "codigo/",
  "gpu/",
  "herramientas/",
  "plantillas/",
  "catalogo/",
  "_archivo/",
  "_salidas/",
  "_referencias/",
  "proyectos/",
] as const;

/**
 * Carpetas que NO se listan al agente: son grandes y no son su trabajo.
 *
 * `catalogo/` son 9,6 GB y 4.231 ficheros; listarlo entero metía 573 KB en el
 * contexto del modelo (recortados a cabeza y cola, así que el medio —que es donde
 * están sus ficheros— no lo veía). Se consulta con `buscar_sonido`, no listando.
 */
// «versiones»: las fotos por turno (src/core/versiones.ts) se ven con la herramienta `versiones`.
export const CARPETAS_OCULTAS = ["catalogo", "node_modules", ".git", "__pycache__", "dist-web", "_referencias", "versiones"] as const;

/** ¿La ruta empieza por una carpeta compartida? */
export function esRutaCompartida(ruta: string): boolean {
  const limpia = ruta.replace(/\\/g, "/").replace(/^\/+/, "");
  return CARPETAS_COMPARTIDAS.some(
    (prefijo) => limpia === prefijo.slice(0, -1) || limpia.startsWith(prefijo),
  );
}

/** Ruta que entiende el servidor: lo compartido tal cual, el resto dentro del proyecto. */
export function rutaEnWorkspace(ruta: string, slugProyecto: string): string {
  return esRutaCompartida(ruta) ? ruta : `proyectos/${slugProyecto}/${ruta}`;
}

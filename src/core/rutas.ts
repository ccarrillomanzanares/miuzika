/**
 * Workspace folders.
 *
 * A single list for both sides: the dev server (`vite.config.ts`) resolves the
 * paths coming from the agent there, and the browser (`audio-store.ts`) builds
 * the path it asks the server for using the same rule. There used to be two copied
 * lists that had already drifted apart: `catalogo/` was missing.
 *
 * `compartidas`: they live at the root of `workspace/` and are used by all projects.
 * Everything else (salida/, entrada/, sonidos/, instrumentos/, samples/) lives
 * inside the open project's folder.
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
 * Folders that are NOT listed to the agent: they are large and not its job.
 *
 * `catalogo/` is 9.6 GB and 4,231 files; listing it all put 573 KB into the
 * model's context (trimmed to head and tail, so the middle—where its files
 * are—was not visible). It is queried with `buscar_sonido`, not by listing.
 */
// "versiones": the per-turn snapshots (src/core/versiones.ts) are viewed with the `versiones` tool.
export const CARPETAS_OCULTAS = ["catalogo", "node_modules", ".git", "__pycache__", "dist-web", "_referencias", "versiones"] as const;

/** Does the path start with a shared folder? */
export function esRutaCompartida(ruta: string): boolean {
  const limpia = ruta.replace(/\\/g, "/").replace(/^\/+/, "");
  return CARPETAS_COMPARTIDAS.some(
    (prefijo) => limpia === prefijo.slice(0, -1) || limpia.startsWith(prefijo),
  );
}

/** Path the server understands: shared paths as-is, everything else inside the project. */
export function rutaEnWorkspace(ruta: string, slugProyecto: string): string {
  return esRutaCompartida(ruta) ? ruta : `proyectos/${slugProyecto}/${ruta}`;
}

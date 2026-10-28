/**
 * Configuración de Vite: el cliente (`web/`) y la API de desarrollo (`server/`),
 * que incluye el proxy del LLM (server/api/proveedores.ts). Las claves sólo las usa
 * este proceso: el navegador llama a `/api/llm/...` y el servidor pone la cabecera.
 *
 * Editar este fichero o `server/` reinicia el servidor y corta el turno del agente
 * que esté en vuelo (docs/ARCHITECTURE.md §9).
 */

import { defineConfig, loadEnv } from "vite";
import { miuzikaApi } from "./server/api.ts";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => {
  // El .env vive en la raiz del proyecto (el root de Vite es "web").
  const env = loadEnv(mode, process.cwd(), "");
  return {
    root: "web",
    plugins: [miuzikaApi(env as Record<string, string>)],
    server: {
      port: 5173,
      host: "localhost",
      headers: isolationHeaders,
      // El chat del agente y la búsqueda web van por server/api/proveedores.ts:
      // el proveedor y su clave se eligen en el menú «Modelos», no aquí.
    },
    preview: {
      port: 4173,
      headers: isolationHeaders,
    },
    build: {
      outDir: "../dist-web",
      emptyOutDir: true,
      target: "es2022",
    },
  };
});


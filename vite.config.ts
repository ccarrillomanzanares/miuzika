/**
 * Configuración de Vite: el cliente (`web/`), la API de desarrollo (`server/`) y
 * el proxy del LLM. La clave del LLM vive en `.env` y sólo la usa este proceso: el
 * navegador llama a `/api/llm/...` y el proxy añade la cabecera.
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
  const base = (env.OLLAMA_BASE_URL || "https://ollama.com").replace(/\/+$/, "");
  const apiKey = env.OLLAMA_API_KEY || "";
  if (!apiKey) {
    console.warn("[miuzika] OLLAMA_API_KEY no esta en .env: /api/llm respondera sin credenciales.");
  }

  return {
    root: "web",
    plugins: [miuzikaApi(env as Record<string, string>)],
    server: {
      port: 5173,
      host: "localhost",
      headers: isolationHeaders,
      proxy: {
        // El navegador llama a /api/llm/... y la clave la pone el servidor:
        // asi nunca entra en el bundle del cliente.
        "/api/llm": {
          target: base,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api\/llm/, ""),
          configure: (proxy) => {
            // Log de cada llamada al LLM en la consola del servidor de Vite:
            // es lo que permite depurar mientras se le piden cosas al agente.
            const inicio = new WeakMap<object, number>();
            proxy.on("proxyReq", (proxyReq, req) => {
              proxyReq.setHeader("Authorization", `Bearer ${apiKey}`);
              inicio.set(req, Date.now());
            });
            proxy.on("proxyRes", (proxyRes, req) => {
              const t0 = inicio.get(req) ?? Date.now();
              console.log(
                `[llm] ${req.method} ${req.url} -> ${proxyRes.statusCode} en ${Date.now() - t0} ms`,
              );
            });
            proxy.on("error", (error, req) => {
              console.error(`[llm] ${req.method} ${req.url} -> ERROR ${error.message}`);
            });
          },
        },
      },
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


/**
 * Vite config: the client (`web/`) and the development API (`server/`),
 * including the LLM proxy (server/api/proveedores.ts). Keys are used only by
 * this process: the browser calls `/api/llm/...` and the server adds the header.
 *
 * Editing this file or `server/` restarts the server and cuts the agent turn
 * currently in flight (docs/ARCHITECTURE.md section 9).
 */

import { defineConfig, loadEnv } from "vite";
import { miuzikaApi } from "./server/api.ts";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ mode }) => {
  // .env lives at the project root (Vite's root is "web").
  const env = loadEnv(mode, process.cwd(), "");
  return {
    root: "web",
    plugins: [miuzikaApi(env as Record<string, string>)],
    server: {
      port: 5173,
      host: "localhost",
      headers: isolationHeaders,
      // The agent chat and web search go through server/api/proveedores.ts:
      // the provider and its key are chosen in the "Models" menu, not here.
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


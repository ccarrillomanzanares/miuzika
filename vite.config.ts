/**
 * The client (`web/`) and its local API (`server/`). Port 5180 so it can run next to
 * miuzika (5173). The isolation headers are what openDAW's SharedArrayBuffer needs.
 */

import { defineConfig } from "vite";
import { miuzikaApi } from "./server/api.ts";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: "web",
  plugins: [miuzikaApi()],
  server: { port: 5180, strictPort: true, host: "localhost", headers: isolationHeaders },
  build: { outDir: "../dist-web", emptyOutDir: true, target: "es2022" },
});

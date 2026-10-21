import { defineConfig } from "vite";

const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: "web",
  server: {
    port: 5173,
    host: "localhost",
    headers: isolationHeaders,
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
});

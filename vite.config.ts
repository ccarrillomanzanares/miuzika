import { defineConfig } from "vite";
import { miuzikaApi } from "./vite-plugin-api.ts";

export default defineConfig({
  root: "web",
  plugins: [miuzikaApi()],
  server: {
    port: 5173,
    host: "localhost",
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
    target: "es2022",
  },
});

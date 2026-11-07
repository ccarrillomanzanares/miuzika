/**
 * The local API as a Vite dev-server plugin: only what the GUI needs.
 * `middlewares.use("/api/x", …)` matches by PREFIX, so longer routes go first
 * inside each module (`/api/audio/subir` before `/api/audio`).
 */

import type { Plugin } from "vite";
import { crearContexto } from "./contexto.ts";
import { rutasProyectos } from "./api/proyectos.ts";
import { rutasAudio } from "./api/audio.ts";
import { rutasSistema } from "./api/sistema.ts";
import { rutasGpu } from "./api/gpu.ts";
import { rutasAceStep } from "./api/acestep.ts";
import { rutasAjustes } from "./api/ajustes.ts";

export function miuzikaApi(): Plugin {
  const ctx = crearContexto();
  return {
    name: "miuzika-api",
    configureServer(server) {
      server.middlewares.use(ctx.registro);
      rutasProyectos(server, ctx);
      rutasAudio(server, ctx);
      rutasSistema(server, ctx);
      rutasGpu(server, ctx);
      rutasAceStep(server, ctx);
      rutasAjustes(server, ctx);
    },
  };
}

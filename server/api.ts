/**
 * The miuzika API as a Vite dev-server plugin.
 *
 * There is no production server: everything under `/api/*` lives here (see docs/ARCHITECTURE.md).
 * Each area has its own module in `server/api/`; this file only mounts them in order.
 *
 * WATCH OUT for the order: `middlewares.use("/api/x", …)` matches by PREFIX, so a
 * short route mounted first swallows the longer ones that start the same way if it
 * does not call `next()` (`/api/audio` ↔ `/api/audio/subir`, `/api/voces` ↔ `/api/voces/nueva`).
 */

import type { Plugin } from "vite";
import { crearContexto } from "./contexto.ts";
import { rutasFicheros } from "./api/ficheros.ts";
import { rutasProyectos } from "./api/proyectos.ts";
import { rutasAudio } from "./api/audio.ts";
import { rutasCatalogo } from "./api/catalogo.ts";
import { rutasVoces } from "./api/voces.ts";
import { rutasGpu } from "./api/gpu.ts";
import { rutasPython } from "./api/python.ts";
import { rutasPad } from "./api/pad.ts";
import { rutasProveedores } from "./api/proveedores.ts";

export function miuzikaApi(env: Record<string, string>): Plugin {
  const ctx = crearContexto(env);
  return {
    name: "miuzika-api",
    configureServer(server) {
      rutasFicheros(server, ctx);
      rutasProyectos(server, ctx);
      rutasAudio(server, ctx);
      rutasCatalogo(server, ctx);
      rutasVoces(server, ctx);
      rutasGpu(server, ctx);
      rutasPython(server, ctx);
      rutasPad(server, ctx);
      rutasProveedores(server, ctx, env);
    },
  };
}

/**
 * La API de miuzika como plugin del servidor de desarrollo de Vite.
 *
 * No hay servidor de producción: todo `/api/*` vive aquí (ver docs/ARCHITECTURE.md).
 * Cada área tiene su módulo en `server/api/`; esto sólo los monta en orden.
 *
 * OJO con el orden: `middlewares.use("/api/x", …)` casa por PREFIJO, así que una
 * ruta corta montada antes se come las largas que empiezan igual si no hace
 * `next()` (`/api/audio` ↔ `/api/audio/subir`, `/api/voces` ↔ `/api/voces/nueva`).
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
    },
  };
}

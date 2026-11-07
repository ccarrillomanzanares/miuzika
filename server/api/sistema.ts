/** Small routes the GUI asks for: the id of the served code and where the GM SoundFont is. */

import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasSistema(server: ViteDevServer, ctx: Contexto): void {
  const { responderJson, idDeBuild, carpetaTrabajo } = ctx;
  const arrancado = new Date().toISOString();

  server.middlewares.use("/api/build", (_req, res) => {
    responderJson(res, 200, { ok: true, id: idDeBuild(), arrancado });
  });

  // The first .sf2 in catalogo/gm/: with it, a MIDI track with a program sounds with a real instrument.
  server.middlewares.use("/api/gm", (_req, res) => {
    const carpeta = resolve(carpetaTrabajo, "catalogo", "gm");
    const fichero = existsSync(carpeta)
      ? readdirSync(carpeta).filter((f) => f.toLowerCase().endsWith(".sf2")).sort()[0]
      : undefined;
    if (!fichero) {
      responderJson(res, 200, { ok: true, ruta: null, aviso: "there is no .sf2 in workspace/catalogo/gm/" });
      return;
    }
    responderJson(res, 200, {
      ok: true,
      ruta: `catalogo/gm/${fichero}`,
      nombre: fichero,
      bytes: statSync(resolve(carpeta, fichero)).size,
    });
  });
}

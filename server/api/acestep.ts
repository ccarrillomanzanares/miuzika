/**
 * What upstream's `main` holds now, for the module's version tell-tale. Public data, no key involved.
 * Remembered for an hour: GitHub allows 60 unauthenticated requests an hour. A failure is not
 * remembered, and is answered as a failure: it must never read as "no change".
 */

import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";
import { mensajeDe, rutaJson } from "../ruta.ts";

const URL_MAIN = "https://api.github.com/repos/ace-step/ACE-Step-1.5/commits/main";
const VALIDA_MS = 60 * 60 * 1000;

export function rutasAceStep(server: ViteDevServer, ctx: Contexto): void {
  let vista: { commit: string; fecha: string; hora: number } | null = null;

  server.middlewares.use(
    "/api/modulos/ace-step/version",
    rutaJson({ metodo: "GET" }, async ({ res }) => {
      if (vista === null || Date.now() - vista.hora > VALIDA_MS) {
        try {
          const r = await fetch(URL_MAIN, {
            headers: { Accept: "application/vnd.github+json", "User-Agent": "miuzika" },
            signal: AbortSignal.timeout(8000),
          });
          if (!r.ok) throw new Error(`GitHub answered HTTP ${r.status}`);
          const d = (await r.json()) as { sha?: unknown; commit?: { committer?: { date?: unknown } } };
          if (typeof d.sha !== "string") throw new Error("GitHub's answer has no commit");
          vista = { commit: d.sha, fecha: String(d.commit?.committer?.date ?? ""), hora: Date.now() };
        } catch (error) {
          ctx.responderJson(res, 200, { error: mensajeDe(error) });
          return;
        }
      }
      ctx.responderJson(res, 200, { commit: vista.commit, fecha: vista.fecha });
    }),
  );
}

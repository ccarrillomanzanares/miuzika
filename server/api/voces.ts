/** The engine voices: the catalog read from `instruments.py` and the door for new voices. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasVoces(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, correr } = ctx;

  // ---------------------------------------------------------- Engine voices
  // The catalog comes from instruments.py itself (see codigo/voces.py): there is no
  // second list to maintain. `medir` renders and measures each voice.
  server.middlewares.use("/api/voces", async (req, res, next) => {
    // Connection mounted by prefix: /api/voces/nueva has its own handler.
    const resto = (req.url ?? "").split("?")[0];
    if (resto !== "" && resto !== "/") {
      next();
      return;
    }
    if (req.method !== "GET") {
      responderJson(res, 405, { error: "use GET" });
      return;
    }
    const medir = /[?&]medir=1/.test(req.url ?? "");
    try {
      const r = await correr("codigo/voces.py", medir ? ["--medir"] : [], 240);
      if (r.codigo !== 0) {
        responderJson(res, 500, { error: (r.errores || r.salida).slice(-1200) });
        return;
      }
      responderJson(res, 200, JSON.parse(r.salida.trim()));
    } catch (error) {
      responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  // A new voice goes through the gate (codigo/gate_voz.py): it is rendered,
  // measured and, if it passes, baked into instruments.py for good. If not, the
  // specific reasons are returned and the file is left untouched.
  server.middlewares.use("/api/voces/nueva", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      const rutaInstruments = resolve(carpetaTrabajo, "codigo", "instruments.py");
      try {
        const datos = JSON.parse(cuerpo) as {
          nombre?: string;
          fuente?: string;
          destino?: string;
        };
        const destino = datos.destino === "gpu" ? "gpu" : "cpu";
        const nombre = String(datos.nombre ?? "").trim().toLowerCase();
        const fuente = String(datos.fuente ?? "");
        if (!/^[a-z][a-z0-9_]{2,30}$/.test(nombre)) {
          responderJson(res, 400, {
            ok: false,
            motivos: ["the name must be lowercase, 3-31 characters, letters/numbers/_"],
          });
          return;
        }
        if (fuente.trim().length < 40 || fuente.length > 20000) {
          responderJson(res, 400, { ok: false, motivos: ["the source is empty or huge"] });
          return;
        }
        const rutaGpu = resolve(carpetaTrabajo, "gpu", "voces_gpu.py");
        const textoCpu = readFileSync(rutaInstruments, "utf8");
        const textoGpu = existsSync(rutaGpu) ? readFileSync(rutaGpu, "utf8") : "";
        const existe = new RegExp(`^def ${nombre}\\(`, "m");
        if (existe.test(textoCpu) || existe.test(textoGpu)) {
          responderJson(res, 409, { ok: false, motivos: [`voice "${nombre}" already exists`] });
          return;
        }

        // 1) the candidate is rendered where it belongs. On GPU it goes to gpu/ (Lambda
        //    uploads that folder) and gpu/gate_voz_gpu.py measures it right there.
        const candidata =
          destino === "gpu" ? `gpu/_candidata_${nombre}.py` : `tmp/_candidata_${nombre}.py`;
        writeFileSync(resolve(carpetaTrabajo, candidata), fuente, "utf8");
        let prueba: { codigo: number | null; salida: string; errores: string };
        if (destino === "gpu") {
          const host = req.headers.host ?? "localhost:5173";
          const respuesta = await fetch(`http://${host}/api/run/lambda`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-miuzika-proyecto": encodeURIComponent(slugProyecto(req.headers["x-miuzika-proyecto"])) },
            body: JSON.stringify({
              path: "gpu/gate_voz_gpu.py",
              argumentos: [`_candidata_${nombre}.py`],
              timeout_segundos: 900,
            }),
          });
          const leido = (await respuesta.json()) as { codigo?: number; salida?: string; errores?: string };
          prueba = {
            codigo: leido.codigo ?? (respuesta.ok ? 0 : 1),
            salida: leido.salida ?? "",
            errores: leido.errores ?? "",
          };
        } else {
          prueba = await correr("codigo/gate_voz.py", [candidata], 90);
        }
        const ultima = prueba.salida.trim().split("\n").filter((l) => l.startsWith("{")).pop();
        if (!ultima) {
          responderJson(res, 500, {
            ok: false,
            motivos: ["the gate returned no verdict"],
            detalle: (prueba.errores || prueba.salida).slice(-800),
          });
          return;
        }
        const veredicto = JSON.parse(ultima) as {
          ok?: boolean;
          motivos?: string[];
          perfil?: Record<string, unknown>;
          traza?: string;
        };
        if (!veredicto.ok) {
          responderJson(res, 422, {
            ok: false,
            motivos: veredicto.motivos ?? ["does not pass the gate"],
            perfil: veredicto.perfil ?? null,
            traza: veredicto.traza ?? null,
          });
          return;
        }

        // 2) bake: it is appended at the end of instruments.py, with its section.
        //    Imports of itself are removed (inside the module they are not
        //    needed and cause a circular import depending on where the function lands).
        const limpia = fuente
          .split("\n")
          .filter((l) => !/^(from instruments import|import instruments)/.test(l.trim()))
          .join("\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const rutaDestino = destino === "gpu" ? rutaGpu : rutaInstruments;
        const original = readFileSync(rutaDestino, "utf8");
        const marca = "VOCES CREADAS POR EL AGENTE";
        const cabecera = original.includes(marca)
          ? ""
          : "\n\n# ── VOCES CREADAS POR EL AGENTE ──────────────────────────────────────────────\n" +
            "# Added from the app. Mandatory docstring: see codigo/voces.py.\n";
        writeFileSync(
          rutaDestino,
          original.replace(/\s*$/, "\n") + cabecera + "\n" + limpia + "\n",
          "utf8",
        );

        // 3) the module has to keep importing and the voice has to appear in the catalog.
        const revisar = await correr("codigo/voces.py", ["--medir"], 240);
        if (revisar.codigo !== 0) {
          writeFileSync(rutaDestino, original, "utf8");
          responderJson(res, 500, {
            ok: false,
            motivos: ["the voice breaks instruments.py; the change has been undone"],
            detalle: (revisar.errores || revisar.salida).slice(-800),
          });
          return;
        }
        const catalogo = JSON.parse(revisar.salida.trim()) as {
          voces?: { clave: string; [k: string]: unknown }[];
        };
        anotar(
          ficheroHerramientas,
          JSON.stringify({
            t: new Date().toISOString(),
            tool: "voz_nueva",
            nombre,
            motivos: [],
            perfil: veredicto.perfil ?? null,
          }),
        );
        responderJson(res, 200, {
          ok: true,
          voz: (catalogo.voces ?? []).find((v) => v.clave === nombre) ?? null,
          perfil: veredicto.perfil ?? null,
          total: (catalogo.voces ?? []).length,
        });
      } catch (error) {
        responderJson(res, 500, {
          ok: false,
          motivos: [error instanceof Error ? error.message : String(error)],
        });
      }
    });
  });
}

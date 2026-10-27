/** Las voces del motor: el catálogo leído de `instruments.py` y la puerta para voces nuevas. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasVoces(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, correr } = ctx;

  // ---------------------------------------------------------- Voces del motor
  // El catálogo sale del propio instruments.py (ver codigo/voces.py): no hay
  // una segunda lista que mantener. `medir` renderiza y mide cada voz.
  server.middlewares.use("/api/voces", async (req, res, next) => {
    // Conexión monta por prefijo: /api/voces/nueva tiene su propio handler.
    const resto = (req.url ?? "").split("?")[0];
    if (resto !== "" && resto !== "/") {
      next();
      return;
    }
    if (req.method !== "GET") {
      responderJson(res, 405, { error: "usa GET" });
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

  // Una voz nueva pasa por la puerta (codigo/gate_voz.py): se renderiza, se
  // mide y, si cumple, se cuece en instruments.py para siempre. Si no, se
  // devuelven los motivos concretos y el fichero queda intacto.
  server.middlewares.use("/api/voces/nueva", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
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
            motivos: ["el nombre debe ser minúsculas, 3-31 caracteres, letras/números/_"],
          });
          return;
        }
        if (fuente.trim().length < 40 || fuente.length > 20000) {
          responderJson(res, 400, { ok: false, motivos: ["la fuente está vacía o es enorme"] });
          return;
        }
        const rutaGpu = resolve(carpetaTrabajo, "gpu", "voces_gpu.py");
        const textoCpu = readFileSync(rutaInstruments, "utf8");
        const textoGpu = existsSync(rutaGpu) ? readFileSync(rutaGpu, "utf8") : "";
        const existe = new RegExp(`^def ${nombre}\\(`, "m");
        if (existe.test(textoCpu) || existe.test(textoGpu)) {
          responderJson(res, 409, { ok: false, motivos: [`ya existe la voz "${nombre}"`] });
          return;
        }

        // 1) la candidata se renderiza donde toca. En GPU va a gpu/ (Lambda
        //    sube esa carpeta) y la mide gpu/gate_voz_gpu.py allí mismo.
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
            motivos: ["la puerta no devolvió veredicto"],
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
            motivos: veredicto.motivos ?? ["no pasa la puerta"],
            perfil: veredicto.perfil ?? null,
            traza: veredicto.traza ?? null,
          });
          return;
        }

        // 2) cocer: se añade al final de instruments.py, con su sección.
        //    Se quitan los imports de sí misma (dentro del módulo no hacen
        //    falta y provocan import circular según dónde caiga la función).
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
            "# Añadidas desde la app. Docstring obligatorio: ver codigo/voces.py.\n";
        writeFileSync(
          rutaDestino,
          original.replace(/\s*$/, "\n") + cabecera + "\n" + limpia + "\n",
          "utf8",
        );

        // 3) el módulo tiene que seguir importando y la voz aparecer en el catálogo.
        const revisar = await correr("codigo/voces.py", ["--medir"], 240);
        if (revisar.codigo !== 0) {
          writeFileSync(rutaDestino, original, "utf8");
          responderJson(res, 500, {
            ok: false,
            motivos: ["la voz rompe instruments.py; se ha deshecho el cambio"],
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

/** La biblioteca CC0 (VCSL): buscar, escuchar, importar samples e instrumentos SFZ → SF2. */

import { existsSync, readFileSync, statSync, createReadStream } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { buscarEnCatalogo } from "../../src/core/buscar.ts";
import type { EntradaCatalogo } from "../../src/core/buscar.ts";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasCatalogo(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, resolverEnTrabajo, correr } = ctx;

  // Un instrumento de la biblioteca, convertido a .sf2 dentro del proyecto.
  // Es la forma de tocar 46 regiones en vez de estirar un sample (que suena
  // a armónica y desafina: medido, +1054 cents en el saxo).
  server.middlewares.use("/api/instrumentos/crear", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { sfz?: string; nombre?: string };
        const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
        const sfzRel = String(datos.sfz ?? "");
        const sfz = sfzRel ? resolverEnTrabajo(sfzRel, slug) : null;
        if (!sfz || !existsSync(sfz)) {
          responderJson(res, 404, { error: `no existe el SFZ: ${sfzRel}` });
          return;
        }
        const carpeta = resolve(carpetaTrabajo, "proyectos", slug);
        const nombre = String(datos.nombre ?? basename(sfz, ".sfz"));
        const r = await correr(
          "codigo/sfz_a_proyecto.py",
          [sfz, carpeta, nombre],
          600,
        );
        if (r.codigo !== 0) {
          responderJson(res, 400, { error: (r.errores || r.salida).slice(-800) });
          return;
        }
        responderJson(res, 200, JSON.parse(r.salida));
      } catch (error) {
        responderJson(res, 500, { error: String(error) });
      }
    });
  });

  // ---------------------------------------------------------- Catálogo de samples
  // Índice de la biblioteca CC0 (codigo/catalogo.py). Se busca en el servidor
  // para no mandar 4.231 entradas al navegador en cada consulta.
  const cacheCatalogo = {
    json: null as null | Record<string, unknown>,
    entradas: null as null | EntradaCatalogo[],
    mtime: 0,
  };
  const leerCatalogo = (): { entradas: EntradaCatalogo[]; total: number; raiz: string } => {
    const ruta = resolve(carpetaTrabajo, "catalogo", "catalogo-vcsl.json");
    const rutaStrudel = resolve(carpetaTrabajo, "catalogo", "strudel-vcsl.json");
    if (!existsSync(ruta)) return { entradas: [], total: 0, raiz: "" };
    const mtime = statSync(ruta).mtimeMs;
    if (cacheCatalogo.json === null || mtime !== cacheCatalogo.mtime) {
      cacheCatalogo.json = JSON.parse(readFileSync(ruta, "utf8")) as Record<string, unknown>;
      cacheCatalogo.entradas = null;
      cacheCatalogo.mtime = mtime;
    }
    if (cacheCatalogo.entradas !== null) {
      return {
        entradas: cacheCatalogo.entradas,
        total: cacheCatalogo.entradas.length,
        raiz: String((cacheCatalogo.json as { raiz?: string }).raiz ?? ""),
      };
    }
    const datos = cacheCatalogo.json as { entradas?: Record<string, unknown>[] };
    // Nombres de Strudel: su mapa apunta a los mismos ficheros de VCSL, así que
    // un sample puede tener nombre corto allí (`s("bassdrum1")`).
    const strudel = new Map<string, string>();
    if (existsSync(rutaStrudel)) {
      const mapa = JSON.parse(readFileSync(rutaStrudel, "utf8")) as Record<string, unknown>;
      for (const [nombre, valor] of Object.entries(mapa)) {
        if (nombre === "_base") continue;
        // En el mapa de Strudel cada nombre lleva una lista de ficheros.
        const destinos = Array.isArray(valor) ? valor : [valor];
        for (const destino of destinos) {
          if (typeof destino !== "string") continue;
          try {
            strudel.set(decodeURIComponent(destino), nombre);
          } catch {
            strudel.set(destino, nombre);
          }
        }
      }
    }
    const raiz = String((datos as { raiz?: string }).raiz ?? "");
    const entradas = (datos.entradas ?? [])
      .filter((x) => typeof x.archivo === "string" && (x.medido as Record<string, unknown> | null))
      .map((x) => {
        const medido = x.medido as Record<string, number>;
        const archivo = String(x.archivo);
        return {
          clave: archivo,
          etiqueta: String(x.instrumento ?? archivo),
          familia: String(x.familia ?? "sin clasificar"),
          descripcion:
            `${String(x.instrumento ?? "")}${x.articulacion ? " · " + String(x.articulacion) : ""}` +
            ` · ${String(x.sr)} Hz ${String(x.bits)}b${String(x.archivo).includes("") ? "" : ""}` +
            (strudel.has(archivo) ? ` · strudel: ${strudel.get(archivo)}` : ""),
          destino: "cpu" as const,
          perfil: {
            duracion_s: medido.duracion_s,
            centroide_hz: medido.centroide_hz,
            crest_db: medido.crest_db,
            cola_ms: medido.cola_ms,
            rms_dbfs: medido.rms_dbfs,
          },
          ruta: archivo,
          strudel: strudel.get(archivo) ?? null,
          // Normalizado una vez, no en cada búsqueda: con 4.231 entradas,
          // normalizar en caliente costaba ~800 ms por consulta.
          normTexto: `${archivo} ${String(x.instrumento ?? "")} ${String(x.articulacion ?? "")}`
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
          normClave: archivo
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        } as EntradaCatalogo & { strudel: string | null };
      });
    cacheCatalogo.entradas = entradas;
    return { entradas, total: entradas.length, raiz };
  };

  // Escuchar un sample de la biblioteca sin traerlo al proyecto.
  server.middlewares.use("/api/catalogo/audio", (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.searchParams.get("path") ?? "";
    const raiz = resolve(carpetaTrabajo, "catalogo");
    const destino = resolve(carpetaTrabajo, rel);
    if (rel === "" || !destino.startsWith(raiz + sep) || !existsSync(destino)) {
      responderJson(res, 404, { error: "no existe" });
      return;
    }
    const total = statSync(destino).size;
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      "Content-Length": String(total),
      "Accept-Ranges": "none",
      "Cache-Control": "max-age=3600",
    });
    const flujo = createReadStream(destino);
    flujo.on("error", () => res.end());
    flujo.pipe(res);
  });

  server.middlewares.use("/api/catalogo/buscar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { consulta?: string; limite?: number; familia?: string };
        const { entradas, total, raiz } = leerCatalogo();
        const encontrados = buscarEnCatalogo(entradas, String(datos.consulta ?? ""), {
          limite: Math.min(Math.max(Number(datos.limite ?? 8), 1), 50),
          ...(datos.familia ? { familia: datos.familia } : {}),
        });
        responderJson(res, 200, {
          ok: true,
          total,
          resultados: encontrados.map((r) => ({
            archivo: r.entrada.ruta,
            // Para el <audio>: ruta relativa a workspace/.
            rutaAudio: `catalogo/${raiz}/${String(r.entrada.ruta ?? "")}`,
            instrumento: r.entrada.etiqueta,
            familia: r.entrada.familia,
            perfil: r.entrada.perfil,
            strudel: (r.entrada as { strudel?: string | null }).strudel ?? null,
            puntuacion: r.puntuacion,
            motivos: r.motivos,
          })),
        });
      } catch (error) {
        responderJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  // Un sample del catálogo entra en el proyecto convertido y normalizado.
  server.middlewares.use("/api/catalogo/importar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { archivo?: string; nombre?: string };
        const archivo = String(datos.archivo ?? "");
        const nombre = String(datos.nombre ?? "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
        if (archivo === "" || nombre === "") {
          responderJson(res, 400, { ok: false, error: "faltan 'archivo' o 'nombre'" });
          return;
        }
        const completo = resolve(carpetaTrabajo, "catalogo");
        // El índice guarda la ruta relativa a la raíz de la biblioteca
        // ("Idiophones/…"), así que se prueba con y sin esa raíz.
        const indice = resolve(carpetaTrabajo, "catalogo", "catalogo-vcsl.json");
        let raiz = "";
        if (existsSync(indice)) {
          const cabecera = JSON.parse(readFileSync(indice, "utf8")) as { raiz?: string };
          raiz = String(cabecera.raiz ?? "");
        }
        const candidatos = [
          resolve(carpetaTrabajo, "catalogo", archivo),
          ...(raiz !== "" ? [resolve(carpetaTrabajo, "catalogo", raiz, archivo)] : []),
        ];
        const origen = candidatos.find((c) => c.startsWith(completo + sep) && existsSync(c));
        if (!origen) {
          responderJson(res, 404, { ok: false, error: `no existe ${archivo}` });
          return;
        }
        const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
        const r = await correr(
          "codigo/importar_sample.py",
          [origen, slug, nombre],
          300,
        );
        const salida = (r.salida ?? "").trim().split("\n").filter((l) => l.startsWith("{")).pop();
        if (!salida) {
          responderJson(res, 500, { ok: false, error: (r.errores || r.salida).slice(-800) });
          return;
        }
        anotar(
          ficheroHerramientas,
          JSON.stringify({ t: new Date().toISOString(), tool: "catalogo_importar", archivo, nombre }),
        );
        responderJson(res, 200, JSON.parse(salida));
      } catch (error) {
        responderJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    });
  });
}

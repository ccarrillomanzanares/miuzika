/** The CC0 library (VCSL): search, listen, import samples and SFZ → SF2 instruments. */

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { buscarEnCatalogo } from "../../src/core/buscar.ts";
import type { EntradaCatalogo } from "../../src/core/buscar.ts";
import { presetsDeSf2, textoDePresets } from "../gm.ts";
import { instrumentosDeSfz, resolverInstrumento, textoDeBiblioteca } from "../../src/core/biblioteca.ts";
import type { InstrumentoBiblioteca } from "../../src/core/biblioteca.ts";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

export function rutasCatalogo(server: ViteDevServer, ctx: Contexto): void {
  const { anotar, ficheroHerramientas, carpetaTrabajo, responderJson, leerCuerpo, slugProyecto, resolverEnTrabajo, correr } = ctx;

  // A library instrument, converted to .sf2 inside the project.
  // It is the way to play 46 regions instead of stretching a sample (which sounds
  // like a harmonica and goes out of tune: measured, +1054 cents on the sax).
  // The .sfz files in catalogo/ (183 in VCSL), read once: the catalog does not change
  // while the server runs (if a pack is added, it is restarted).
  let bibliotecaSfz: InstrumentoBiblioteca[] | null = null;
  const biblioteca = (): InstrumentoBiblioteca[] => {
    if (bibliotecaSfz) return bibliotecaSfz;
    const rutas: string[] = [];
    const raiz = resolve(carpetaTrabajo, "catalogo");
    const recorrer = (dir: string, relativa: string): void => {
      if (!existsSync(dir)) return;
      for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        if (entrada.name.startsWith("_")) continue;
        const rel = `${relativa}/${entrada.name}`;
        if (entrada.isDirectory()) recorrer(resolve(dir, entrada.name), rel);
        else if (entrada.name.toLowerCase().endsWith(".sfz")) rutas.push(rel);
      }
    };
    recorrer(raiz, "catalogo");
    bibliotecaSfz = instrumentosDeSfz(rutas);
    return bibliotecaSfz;
  };

  server.middlewares.use("/api/instrumentos/crear", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { sfz?: string; nombre?: string };
        const slug = slugProyecto(req.headers["x-miuzika-proyecto"]);
        let sfzRel = String(datos.sfz ?? "").trim();
        let sfz = sfzRel ? resolverEnTrabajo(sfzRel, slug) : null;
        if (!sfz || !existsSync(sfz)) {
          // Also by name, as shown in listar_instrumentos: "Grand Piano, Steinway B".
          const { instrumento, error } = resolverInstrumento(sfzRel, biblioteca());
          if (!instrumento) {
            responderJson(res, 404, { error: error ?? `SFZ does not exist: ${sfzRel}` });
            return;
          }
          sfzRel = instrumento.ruta;
          sfz = resolverEnTrabajo(sfzRel, slug);
          if (!sfz || !existsSync(sfz)) {
            responderJson(res, 404, { error: `SFZ does not exist: ${sfzRel}` });
            return;
          }
        }
        const carpeta = resolve(carpetaTrabajo, "proyectos", slug);
        const nombre = String(datos.nombre || basename(sfz, ".sfz"));
        const r = await correr(
          "codigo/sfz_a_proyecto.py",
          [sfz, carpeta, nombre],
          600,
        );
        if (r.codigo !== 0) {
          responderJson(res, 400, { error: (r.errores || r.salida).slice(-800) });
          return;
        }
        responderJson(res, 200, { ...JSON.parse(r.salida), sfz: sfzRel });
      } catch (error) {
        responderJson(res, 500, { error: String(error) });
      }
    });
  });

  // ---------------------------------------------------------- Sample catalog
  // Index of the CC0 library (codigo/catalogo.py). It is searched on the server
  // to avoid sending 4,231 entries to the browser on every query.
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
    // Strudel names: its map points to the same VCSL files, so
    // a sample can have a short name there (`s("bassdrum1")`).
    const strudel = new Map<string, string>();
    if (existsSync(rutaStrudel)) {
      const mapa = JSON.parse(readFileSync(rutaStrudel, "utf8")) as Record<string, unknown>;
      for (const [nombre, valor] of Object.entries(mapa)) {
        if (nombre === "_base") continue;
        // In Strudel's map each name carries a list of files.
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
          // Normalized once, not on every search: with 4,231 entries,
          // normalizing on the fly cost ~800 ms per query.
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

  // Listen to a sample from the library without bringing it into the project.
  server.middlewares.use("/api/catalogo/audio", (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const rel = url.searchParams.get("path") ?? "";
    const raiz = resolve(carpetaTrabajo, "catalogo");
    const destino = resolve(carpetaTrabajo, rel);
    if (rel === "" || !destino.startsWith(raiz + sep) || !existsSync(destino)) {
      responderJson(res, 404, { error: "does not exist" });
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
      responderJson(res, 405, { error: "use POST" });
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
            // For the <audio> element: path relative to workspace/.
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

  // A sample from the catalog enters the project converted and normalized.
  server.middlewares.use("/api/catalogo/importar", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "use POST" });
      return;
    }
    leerCuerpo(req, res, async (cuerpo) => {
      try {
        const datos = JSON.parse(cuerpo) as { archivo?: string; nombre?: string };
        const archivo = String(datos.archivo ?? "");
        const nombre = String(datos.nombre ?? "").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
        if (archivo === "" || nombre === "") {
          responderJson(res, 400, { ok: false, error: "missing 'archivo' or 'nombre'" });
          return;
        }
        const completo = resolve(carpetaTrabajo, "catalogo");
        // The index stores the path relative to the library root
        // ("Idiophones/…"), so it is tried with and without that root.
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
          responderJson(res, 404, { ok: false, error: `${archivo} does not exist` });
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

  let presetsGm: { clave: string; texto: string } | null = null;

  // The installation's General MIDI SoundFont: the first .sf2 in catalogo/gm/.
  // With it, any MIDI track with a program sounds with a real instrument.
  server.middlewares.use("/api/gm", (_req, res) => {
    const carpeta = resolve(carpetaTrabajo, "catalogo", "gm");
    const fichero = existsSync(carpeta)
      ? readdirSync(carpeta).filter((f) => f.toLowerCase().endsWith(".sf2")).sort()[0]
      : undefined;
    if (!fichero) {
      responderJson(res, 200, {
        ok: true,
        ruta: null,
        aviso: "there is no .sf2 in workspace/catalogo/gm/",
        biblioteca: textoDeBiblioteca(biblioteca()),
        bibliotecaNombres: biblioteca().map((i) => i.nombre),
      });
      return;
    }
    const completo = resolve(carpeta, fichero);
    const estado = statSync(completo);
    // The preset list is read once per file version (they are ~30 MB).
    const clave = `${completo}|${estado.mtimeMs}`;
    if (presetsGm?.clave !== clave) {
      try {
        presetsGm = { clave, texto: textoDePresets(presetsDeSf2(readFileSync(completo))) };
      } catch (error) {
        presetsGm = { clave, texto: `Could not read the preset list: ${String(error)}` };
      }
    }
    responderJson(res, 200, {
      ok: true,
      ruta: `catalogo/gm/${fichero}`,
      nombre: fichero,
      bytes: estado.size,
      instrumentos: presetsGm.texto,
      biblioteca: textoDeBiblioteca(biblioteca()),
      bibliotecaNombres: biblioteca().map((i) => i.nombre),
    });
  });
}

/**
 * El touchpad como instrumento: el servidor arranca la captura nativa
 * (workspace/herramientas/touchpad/principal.py) y reenvía los dedos a la página.
 *
 *   POST /api/pad/orden   {orden: "arrancar" | "parar" | "armar" | "desarmar"}
 *   GET  /api/pad/eventos SSE: una línea JSON por evento de la captura
 *   GET  /api/pad/estado  {enMarcha, armado}
 *
 * Hay UNA captura por servidor (el touchpad es uno). Si la página se cierra, la
 * captura se para sola al quedarse sin oyentes: con el pad armado congela el
 * cursor, y no puede quedarse así sin nadie mirando.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { ViteDevServer } from "vite";
import type { Contexto } from "../contexto.ts";

/** Segundos sin ninguna página escuchando antes de parar la captura. */
const SIN_OYENTES_S = 5;

export function rutasPad(server: ViteDevServer, ctx: Contexto): void {
  const { carpetaTrabajo, interprete, responderJson, leerCuerpo } = ctx;
  const script = resolve(carpetaTrabajo, "herramientas", "touchpad", "principal.py");

  let hijo: ChildProcess | null = null;
  let armado = false;
  let ultimoError = "";
  const oyentes = new Set<ServerResponse>();
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const enviar = (linea: string): void => {
    for (const res of oyentes) res.write(`data: ${linea}\n\n`);
  };

  const ordenar = (orden: string): void => {
    if (hijo?.stdin && !hijo.stdin.destroyed) hijo.stdin.write(`${orden}\n`);
  };

  const parar = (): void => {
    if (!hijo) return;
    ordenar("salir");
    const viejo = hijo;
    hijo = null;
    armado = false;
    // Si no sale por las buenas en 2 s, se mata: no puede quedar enganchado al ratón.
    setTimeout(() => {
      if (viejo.exitCode === null) viejo.kill();
    }, 2000);
  };

  const arrancar = (): string | null => {
    if (hijo) return null;
    if (process.platform !== "win32") return "el touchpad como instrumento sólo funciona en Windows";
    if (!existsSync(script)) return `falta ${script}`;
    ultimoError = "";
    const proceso = spawn(interprete, ["-u", script], {
      cwd: carpetaTrabajo,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    hijo = proceso;
    let resto = "";
    proceso.stdout?.setEncoding("utf8");
    proceso.stdout?.on("data", (trozo: string) => {
      resto += trozo;
      const lineas = resto.split("\n");
      resto = lineas.pop() ?? "";
      for (const linea of lineas) {
        const limpia = linea.trim();
        if (!limpia.startsWith("{")) continue;
        if (limpia.includes('"error"')) {
          try {
            ultimoError = String((JSON.parse(limpia) as { error?: string }).error ?? "");
          } catch {
            /* línea rota: se reenvía igual */
          }
        }
        if (limpia.includes('"desarmado"')) armado = false;
        enviar(limpia);
      }
    });
    let errores = "";
    proceso.stderr?.setEncoding("utf8");
    proceso.stderr?.on("data", (trozo: string) => {
      errores = (errores + trozo).slice(-2000);
    });
    proceso.on("exit", (codigo) => {
      if (hijo === proceso) {
        hijo = null;
        armado = false;
      }
      const motivo = ultimoError || (codigo ? errores.trim().split("\n").slice(-3).join(" ") : "");
      enviar(JSON.stringify({ fin: codigo, ...(motivo ? { error: motivo } : {}) }));
    });
    proceso.on("error", (error) => {
      ultimoError = `no se pudo arrancar Python (${interprete}): ${error.message}`;
    });
    return null;
  };

  server.httpServer?.on("close", parar);

  server.middlewares.use("/api/pad/orden", (req, res) => {
    if (req.method !== "POST") {
      responderJson(res, 405, { error: "usa POST" });
      return;
    }
    leerCuerpo(req, res, (cuerpo) => {
      let orden = "";
      try {
        orden = String((JSON.parse(cuerpo) as { orden?: string }).orden ?? "");
      } catch {
        responderJson(res, 400, { error: "JSON inválido" });
        return;
      }
      if (orden === "arrancar") {
        const error = arrancar();
        if (error) {
          responderJson(res, 400, { error });
          return;
        }
      } else if (orden === "parar") {
        parar();
      } else if (orden === "armar" || orden === "desarmar") {
        if (!hijo) {
          responderJson(res, 409, { error: "la captura del pad no está en marcha" });
          return;
        }
        armado = orden === "armar";
        ordenar(orden);
      } else {
        responderJson(res, 400, { error: `orden desconocida: ${orden}` });
        return;
      }
      responderJson(res, 200, { ok: true, enMarcha: hijo !== null, armado });
    });
  });

  server.middlewares.use("/api/pad/estado", (_req, res) => {
    responderJson(res, 200, { ok: true, enMarcha: hijo !== null, armado, error: ultimoError || undefined });
  });

  server.middlewares.use("/api/pad/eventos", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": pad\n\n");
    oyentes.add(res);
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    req.on("close", () => {
      oyentes.delete(res);
      if (oyentes.size === 0 && hijo) {
        if (armado) ordenar("desarmar");
        armado = false;
        temporizador = setTimeout(() => {
          if (oyentes.size === 0) parar();
        }, SIN_OYENTES_S * 1000);
      }
    });
  });
}

/**
 * The boilerplate of a JSON route, written once (method guard, body with a size limit,
 * JSON parse, exceptions to 500), and one log line per API request (route, status, ms)
 * for every route, JSON or not.
 *
 * Why: the 3-Nov review (§4) counted 25 error-to-string copies, 18 `405` guards and 17
 * `JSON.parse` calls answering bad JSON with 400 in some routes and 500 in others; 11 routes
 * logged nothing, so a failed request from the agent left no trace on the server; and the
 * 413 text always said "max. 8 MB", even on the 48 MB trajectories route (bug 9).
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export const LIMITE_CUERPO = 8 * 1024 * 1024;

export const responderJson = (res: ServerResponse, codigo: number, cuerpo: unknown): void => {
  if (res.headersSent) return;
  res.statusCode = codigo;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(cuerpo));
};

/** Raw text body; null if it exceeds the limit or the request fails. */
export const leerCuerpoCrudo = (
  req: IncomingMessage,
  alTerminar: (cuerpo: string | null) => void,
  limite = LIMITE_CUERPO,
): void => {
  let cuerpo = "";
  let total = 0;
  let pasado = false;
  req.on("data", (trozo: Buffer) => {
    total += trozo.length;
    if (total > limite) {
      pasado = true;
      cuerpo = "";
      return;
    }
    cuerpo += trozo.toString("utf8");
  });
  req.on("end", () => alTerminar(pasado ? null : cuerpo));
  req.on("error", () => alTerminar(null));
};

export const textoTamano = (bytes: number): string => `${Math.round(bytes / (1024 * 1024))} MB`;

export const mensajeDe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface PeticionJson<T> {
  req: IncomingMessage;
  res: ServerResponse;
  /** The parsed body for POST (`{}` when empty); `{}` for GET. */
  datos: T;
  url: URL;
  responder: (codigo: number, cuerpo: unknown) => void;
}

export interface OpcionesRuta {
  metodo: "GET" | "POST";
  /** Body limit in bytes (default 8 MB). */
  limite?: number;
}

export type Manejador<T> = (p: PeticionJson<T>) => void | Promise<void>;

/**
 * True when a browser says the request comes from a page of another site. Scripts (curl, Python)
 * send no Origin and pass; the app's own page sends its own host.
 */
export function otroOrigen(req: IncomingMessage): boolean {
  const origen = req.headers.origin;
  if (!origen) return false;
  try {
    return new URL(origen).host !== req.headers.host;
  } catch {
    return true;
  }
}

export function rutaJson<T = Record<string, unknown>>(
  op: OpcionesRuta,
  manejador: Manejador<T>,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const responder = (codigo: number, cuerpo: unknown): void => responderJson(res, codigo, cuerpo);
    if (req.method !== op.metodo) {
      responder(405, { error: `use ${op.metodo}` });
      return;
    }
    // Bug 16 (6-Nov): any web page open in the same browser could POST to localhost, and
    // /api/gpu/ejecutar spends money. A text/plain POST needs no preflight, so CORS alone does not
    // stop it. Only Settings checked this; now every JSON POST does.
    if (op.metodo === "POST" && otroOrigen(req)) {
      responder(403, { error: "only from the app itself" });
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const correr = async (datos: T): Promise<void> => {
      try {
        await manejador({ req, res, datos, url, responder });
      } catch (error) {
        // ok:false too: some callers read `datos.ok` (transcribir, catalogo/importar).
        responder(500, { ok: false, error: mensajeDe(error) });
      }
    };
    if (op.metodo === "GET") {
      void correr({} as T);
      return;
    }
    const limite = op.limite ?? LIMITE_CUERPO;
    leerCuerpoCrudo(
      req,
      (cuerpo) => {
        if (cuerpo === null) {
          responder(413, { error: `body too large (max. ${textoTamano(limite)})` });
          return;
        }
        let datos: T;
        try {
          datos = (cuerpo.trim() === "" ? {} : JSON.parse(cuerpo)) as T;
        } catch (error) {
          responder(400, { error: `invalid JSON: ${mensajeDe(error)}` });
          return;
        }
        void correr(datos);
      },
      limite,
    );
  };
}

/**
 * Middleware mounted before every route: one line per /api request when it ends, or
 * "closed" if the client left first (Cancel in the app). Routes in `omitir` are the ones the
 * tab polls (/api/build every 20 s, the GPU counter): a line each time would drown the rest.
 */
export function registroApi(
  anotar: (linea: string) => void,
  omitir: ReadonlySet<string>,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    // connect strips the mount prefix from req.url; originalUrl keeps it.
    const completa = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "";
    const ruta = completa.split("?")[0];
    if (!ruta.startsWith("/api/") || omitir.has(ruta)) {
      next();
      return;
    }
    const t0 = Date.now();
    let escrita = false;
    const linea = (estado: number | "closed"): void => {
      if (escrita) return;
      escrita = true;
      anotar(JSON.stringify({ t: new Date().toISOString(), ruta, metodo: req.method, estado, ms: Date.now() - t0 }));
    };
    res.on("finish", () => linea(res.statusCode));
    res.on("close", () => linea(res.writableFinished ? res.statusCode : "closed"));
    next();
  };
}

/**
 * One way to run a child process on the server: time limit, cancel, kill the whole tree,
 * and a readable text when it dies silently.
 *
 * Why: the 3-Nov review (§4) counted 5 spawn wrappers on the server with 4 copies of the
 * `taskkill /T /F` idiom, and `explicarFalloMudo` wired into only one. On Windows `python`
 * is a launcher that leaves a grandchild holding the pipes, so killing only the child left
 * orphans and the request hung until `close`; each copy had re-learned that separately
 * (grace of 2, 3 or 5 s; some listened to `exit`, basic-pitch did not).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { explicarFalloMudo } from "./fallo-proceso.ts";

export interface OpcionesProceso {
  /** Time limit in seconds. */
  segundos: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Aborting it kills the tree and resolves with `cancelado: true`. */
  senal?: AbortSignal;
  windowsHide?: boolean;
  /** Name used in the "[miuzika] ... cut off" lines; defaults to the command. */
  nombre?: string;
}

export interface ResultadoProceso {
  codigo: number | null;
  senal: string | null;
  salida: string;
  /** stderr, plus the "[miuzika]" lines; never empty for a silent failure. */
  errores: string;
  porTiempo: boolean;
  cancelado: boolean;
  /** Set when the process could not be launched at all (ENOENT and the like). */
  errorArranque?: string;
  ms: number;
}

/** After `exit`, how long to wait for `close` (a grandchild may keep the pipes open). */
const ESPERA_TRAS_EXIT_MS = 150;
/** After killing on timeout, the safety net so the request never hangs. */
const GRACIA_TRAS_MATAR_MS = 3000;

/** Kills the process AND its descendants (taskkill /T on Windows, the process group elsewhere). */
export function matarArbol(hijo: ChildProcess): void {
  const pid = hijo.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    hijo.kill("SIGKILL");
  }
}

export function correrProceso(comando: string, args: string[], op: OpcionesProceso): Promise<ResultadoProceso> {
  const nombre = op.nombre ?? comando;
  const t0 = Date.now();
  return new Promise((listo) => {
    let salida = "";
    let errores = "";
    let porTiempo = false;
    let cancelado = false;
    let errorArranque: string | undefined;
    let cerrado = false;
    let temporizador: NodeJS.Timeout | null = null;

    const hijo = spawn(comando, args, {
      cwd: op.cwd,
      env: op.env,
      windowsHide: op.windowsHide,
      // Own group outside Windows, so `kill(-pid)` also reaches the grandchildren.
      detached: process.platform !== "win32",
    });

    const terminar = (codigo: number | null, senal: string | null): void => {
      if (cerrado) return;
      cerrado = true;
      if (temporizador) clearTimeout(temporizador);
      op.senal?.removeEventListener("abort", alAbortar);
      listo({
        codigo,
        senal,
        salida,
        errores: explicarFalloMudo(codigo, salida, errores),
        porTiempo,
        cancelado,
        errorArranque,
        ms: Date.now() - t0,
      });
    };

    function alAbortar(): void {
      if (cerrado) return;
      cancelado = true;
      errores += `\n[miuzika] ${nombre} cancelled\n`;
      matarArbol(hijo);
      setTimeout(() => terminar(null, "cancelled"), GRACIA_TRAS_MATAR_MS);
    }

    temporizador = setTimeout(() => {
      porTiempo = true;
      errores += `\n[miuzika] ${nombre} cut off after ${op.segundos} s\n`;
      matarArbol(hijo);
      setTimeout(() => terminar(null, "timeout"), GRACIA_TRAS_MATAR_MS);
    }, op.segundos * 1000);

    if (op.senal?.aborted) alAbortar();
    else op.senal?.addEventListener("abort", alAbortar, { once: true });

    hijo.stdout?.on("data", (t: Buffer) => {
      salida += t.toString("utf8");
    });
    hijo.stderr?.on("data", (t: Buffer) => {
      errores += t.toString("utf8");
    });
    // 'exit' arrives even if a grandchild keeps the pipes; 'close' only once they close.
    hijo.on("exit", (codigo, senal) => setTimeout(() => terminar(codigo, senal), ESPERA_TRAS_EXIT_MS));
    hijo.on("close", (codigo, senal) => terminar(codigo, senal));
    hijo.on("error", (error) => {
      errorArranque = error.message;
      errores += `${error.message}\n`;
      terminar(null, null);
    });
  });
}

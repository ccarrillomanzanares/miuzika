import type { StrudelCompileResult } from "./strudel-compiler.ts";

export function compileStrudelInWorker(
  code: string,
  bars: number,
  beatsPerBar: number,
  timeoutMs = 10_000,
): Promise<StrudelCompileResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./strudel-worker.ts", import.meta.url), {
      type: "module",
    });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Strudel tardó demasiado en compilar; revisa el código."));
    }, timeoutMs);
    const finish = (callback: () => void) => {
      window.clearTimeout(timer);
      worker.terminate();
      callback();
    };
    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { ok: true; result: StrudelCompileResult }
        | { ok: false; error: string };
      if (data.ok) finish(() => resolve(data.result));
      else finish(() => reject(new Error(data.error)));
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || "El worker de Strudel falló.")));
    };
    worker.postMessage({ code, bars, beatsPerBar });
  });
}

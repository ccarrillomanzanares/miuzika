/** Worker aislado: aquí vive Strudel; la ventana solo recibe eventos MIDI. */

import { compileStrudelSource } from "./strudel-compiler.ts";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: (message: unknown) => void;
};

scope.onmessage = async (event: MessageEvent) => {
  const { code, bars, beatsPerBar } = event.data as {
    code: string;
    bars: number;
    beatsPerBar: number;
  };
  try {
    // El código de usuario no debe poder salir del worker.
    (globalThis as Record<string, unknown>).fetch = () =>
      Promise.reject(new Error("Red deshabilitada en el compilador Strudel"));
    (globalThis as Record<string, unknown>).XMLHttpRequest = undefined;
    (globalThis as Record<string, unknown>).WebSocket = undefined;
    const result = await compileStrudelSource(code, bars, beatsPerBar);
    scope.postMessage({ ok: true, result });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};

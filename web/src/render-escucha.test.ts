import { test } from "node:test";
import assert from "node:assert/strict";

import { crearRenderEscucha } from "./render-escucha.ts";

// The renders themselves need openDAW in a browser; this pins the wiring that left main.ts on 3-Nov.
test("exportar and escuchar_mezcla answer plainly when no project is open", async () => {
  const r = crearRenderEscucha({
    proyecto: () => null,
    cargarSoundfonts: async () => new Map(),
    cargarGm: async () => null,
    avisarFaltan: () => {},
    estado: () => {},
  });
  assert.deepEqual(await r.exportar({ midi: true, wav: true }), { ok: false, texto: "There is no open project." });
  assert.deepEqual(await r.escuchar({}), { ok: false, texto: "There is no open project." });
});

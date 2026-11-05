import { test } from "node:test";
import assert from "node:assert/strict";

import { crearRenderEscucha, sinMaster } from "./render-escucha.ts";

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

test("the source rendered for the model has the master at 0 dB and keeps the tracks as they are (5-Nov: -6 dB master, sources 6 dB low)", () => {
  const vista = {
    master: { gainDb: -6 },
    tracks: [{ id: "t1", name: "take", muted: false, solo: false, gainDb: -4, clips: [] }],
  } as unknown as Parameters<typeof sinMaster>[0];
  const r = sinMaster(vista);
  assert.equal(r.master.gainDb, 0);
  assert.equal(vista.master.gainDb, -6, "the open project is not touched");
  assert.deepEqual(r.tracks, vista.tracks);
});

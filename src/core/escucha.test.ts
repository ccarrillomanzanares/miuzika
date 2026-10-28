import assert from "node:assert/strict";
import test from "node:test";
import { informeEscucha, nivelesPorTramo, notasPorTramo } from "./escucha.ts";

test("las notas cuentan en cada tramo que pisan, recortadas por el clip", () => {
  const pista = {
    clips: [
      {
        id: "c1",
        name: "c1",
        start: 16,
        length: 16,
        notes: [
          { pitch: 60, start: 0, duration: 1, velocity: 100 }, // tramo 1
          { pitch: 62, start: 14, duration: 8, velocity: 100 }, // 30..32: el clip la corta en 32
          { pitch: 64, start: 20, duration: 1, velocity: 100 }, // fuera del clip: no suena
        ],
      },
      { id: "c2", name: "audio", start: 0, length: 20, notes: [], audio: { assetId: "a", offset: 0, gainDb: 0 } },
    ],
  };
  // Tramos de 16 tiempos: [0,16) [16,32) [32,48)
  assert.deepEqual(notasPorTramo(pista, 16, 3), [1, 3, 0]);
});

test("el nivel por tramo distingue silencio de señal", () => {
  const sr = 1000;
  // 120 BPM: un tramo de 4 tiempos = 2 s = 2000 muestras. Primer tramo a 0.5, segundo mudo.
  const canal = new Float32Array(4000);
  for (let i = 0; i < 2000; i += 1) canal[i] = i % 2 === 0 ? 0.5 : -0.5;
  const niveles = nivelesPorTramo([canal, canal], sr, 120, 4, 2);
  assert.equal(Math.round(niveles[0]!.rmsDb), -6);
  assert.equal(niveles[1]!.picoDb, -Infinity);
});

test("el informe señala la pista con notas que no suena", () => {
  const texto = informeEscucha({
    compasesPorTramo: 4,
    mezcla: [
      { rmsDb: -20, picoDb: -6 },
      { rmsDb: -18, picoDb: -4 },
    ],
    pistas: [
      { nombre: "Piano", muted: false, notas: [5, 3], niveles: [{ rmsDb: -Infinity, picoDb: -Infinity }, { rmsDb: -90, picoDb: -85 }] },
      { nombre: "Pad", muted: false, notas: [0, 2], niveles: [{ rmsDb: -Infinity, picoDb: -Infinity }, { rmsDb: -30, picoDb: -20 }] },
    ],
    sinCargar: ["instrumentos/piano.sf2"],
  });
  assert.match(texto, /Piano\s+MUDO\s+MUDO/);
  assert.match(texto, /Pad\s+·\s+-30/);
  assert.match(texto, /«Piano» no suena en NINGÚN tramo/);
  assert.doesNotMatch(texto, /«Pad»/);
  assert.match(texto, /No se pudo cargar instrumentos\/piano\.sf2/);
});

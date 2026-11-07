import assert from "node:assert/strict";
import { test } from "node:test";
import { createProject } from "../../src/core/project.ts";
import type { Project, Track } from "../../src/core/types.ts";
import { mezclarStem, motorDebeSonar, stemsDeProyecto } from "./stems.ts";

function pista(id: string, cambios: Partial<Track> = {}): Track {
  return {
    id,
    name: id,
    kind: "audio",
    instrument: { type: "sampler" },
    gainDb: -3,
    pan: 0.5,
    muted: false,
    solo: false,
    devices: [],
    clips: [{ id: `c${id}`, name: id, start: 4, length: 8, notes: [], audio: { assetId: id, offset: 1, gainDb: -1 } }],
    ...cambios,
  } as Track;
}

const con = (...tracks: Track[]): Project => ({ ...createProject({ name: "x" }), tracks });
const assets = new Map([
  ["a", { streaming: true, src: "entrada/a.wav" }],
  ["b", { streaming: true, src: "entrada/b.wav" }],
  ["corto", { streaming: false, src: "entrada/corto.wav" }],
]);

test("a stem carries clip + track gain, pan and its position; a decoded WAV is not a stem", () => {
  const stems = stemsDeProyecto(con(pista("a"), pista("corto")), assets);
  assert.equal(stems.length, 1);
  assert.deepEqual(
    { gain: stems[0]!.gainDb, pan: stems[0]!.pan, start: stems[0]!.startBeat, offset: stems[0]!.offsetBeat },
    { gain: -4, pan: 0.5, start: 4, offset: 1 },
  );
});

test("mute and solo decide which stems sound", () => {
  assert.deepEqual(stemsDeProyecto(con(pista("a", { muted: true }), pista("b")), assets).map((s) => s.nombrePista), ["b"]);
  assert.deepEqual(stemsDeProyecto(con(pista("a", { solo: true }), pista("b")), assets).map((s) => s.nombrePista), ["a"]);
});

test("the engine must sound only if an audible track reaches it", () => {
  assert.equal(motorDebeSonar(con(pista("corto")), assets), true);
  assert.equal(motorDebeSonar(con(pista("corto", { muted: true })), assets), false, "all muted: silence is correct");
  assert.equal(motorDebeSonar(con(pista("a")), assets), false, "only stems: the render has nothing to play");
});

test("the mix adds the stem at its place, with gain, and never writes outside", () => {
  const destino: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
  mezclarStem(destino, [Float32Array.of(1, 1, 1, 1, 1)], { inicio: 2, desdeFuente: 1, muestras: 9, ganancia: 0.5, pan: 0 });
  assert.deepEqual([...destino[0]], [0, 0, 0.5, 0.5]);
  assert.deepEqual([...destino[1]], [0, 0, 0.5, 0.5], "a mono stem goes to both sides");
});

test("the pan law matches StereoPannerNode: centre leaves it alone, hard pan moves everything to one side", () => {
  const con = (pan: number): number[] => {
    const d: [Float32Array, Float32Array] = [new Float32Array(1), new Float32Array(1)];
    mezclarStem(d, [Float32Array.of(1), Float32Array.of(0.5)], { inicio: 0, desdeFuente: 0, muestras: 1, ganancia: 1, pan });
    return [d[0][0]!, d[1][0]!];
  };
  const cerca = (a: number[], b: number[]): void => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-6, `${a} vs ${b}`));
  cerca(con(0), [1, 0.5]);
  cerca(con(-1), [1.5, 0]);
  cerca(con(1), [0, 1.5]);
});

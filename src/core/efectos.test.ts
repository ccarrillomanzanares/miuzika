import { test } from "node:test";
import assert from "node:assert/strict";

import { NOMBRE_EFECTO, PASOS, controlesDe, formatearValor, posicionDeValor, valorDePosicion } from "./efectos.ts";
import { DEVICE_DEFAULTS, DEVICE_PARAMS, DEVICE_TYPES } from "./types.ts";

test("every effect has a name and one control per parameter of the table", () => {
  for (const tipo of DEVICE_TYPES) {
    assert.ok(NOMBRE_EFECTO[tipo]);
    const controles = controlesDe(tipo);
    assert.deepEqual(
      controles.map((c) => c.clave),
      Object.keys(DEVICE_PARAMS[tipo]),
    );
    for (const control of controles) assert.notEqual(control.etiqueta, control.clave, `${tipo}.${control.clave} has no label`);
  }
});

test("the slider reaches both ends of the range and stays inside it", () => {
  for (const tipo of DEVICE_TYPES) {
    for (const control of controlesDe(tipo)) {
      assert.equal(valorDePosicion(control, 0), control.min, `${tipo}.${control.clave} at 0`);
      assert.equal(valorDePosicion(control, PASOS), control.max, `${tipo}.${control.clave} at the end`);
      for (let p = 0; p <= PASOS; p += 37) {
        const v = valorDePosicion(control, p);
        assert.ok(v >= control.min && v <= control.max, `${tipo}.${control.clave} at ${p}: ${v}`);
      }
    }
  }
});

test("a saved value comes back to the slider within one step of where it was", () => {
  for (const tipo of DEVICE_TYPES) {
    for (const control of controlesDe(tipo)) {
      const inicial = DEVICE_DEFAULTS[tipo][control.clave]!;
      const posicion = posicionDeValor(control, inicial);
      const vuelta = valorDePosicion(control, posicion);
      const paso = Math.abs(valorDePosicion(control, Math.min(PASOS, posicion + 1)) - valorDePosicion(control, Math.max(0, posicion - 1)));
      assert.ok(Math.abs(vuelta - inicial) <= Math.max(paso, 1e-9), `${tipo}.${control.clave}: ${inicial} -> ${vuelta}`);
    }
  }
});

test("frequencies are logarithmic: the middle of a 20 Hz-20 kHz slider is 632 Hz, not 10 kHz", () => {
  const corte = controlesDe("filter").find((c) => c.clave === "cutoffHz")!;
  assert.equal(corte.logaritmico, true);
  assert.equal(valorDePosicion(corte, PASOS / 2), 632);
  // attackMs starts at 0, where a logarithm has no place.
  assert.equal(controlesDe("compressor").find((c) => c.clave === "attackMs")!.logaritmico, false);
});

test("values are shown in their unit", () => {
  const de = (tipo: (typeof DEVICE_TYPES)[number], clave: string) => controlesDe(tipo).find((c) => c.clave === clave)!;
  assert.equal(formatearValor(de("reverb", "wet"), 0.25), "25 %");
  assert.equal(formatearValor(de("reverb", "preDelayMs"), 75), "75 ms");
  assert.equal(formatearValor(de("filter", "cutoffHz"), 2500), "2.50 kHz");
  assert.equal(formatearValor(de("filter", "cutoffHz"), 440), "440 Hz");
  assert.equal(formatearValor(de("chorus", "rateHz"), 0.9), "0.90 Hz");
  assert.equal(formatearValor(de("compressor", "thresholdDb"), -24), "-24.0 dB");
  assert.equal(formatearValor(de("eq", "low"), 3), "+3.0 dB");
  assert.equal(formatearValor(de("compressor", "ratio"), 4), "4.0:1");
  assert.equal(formatearValor(de("bitcrusher", "bits"), 8), "8 bit");
  assert.equal(formatearValor(de("width", "width"), 1.2), "120 %");
  assert.equal(de("filter", "highpass").interruptor, true);
});

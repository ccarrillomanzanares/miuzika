import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detalleCoste,
  dinero,
  minutosYsegundos,
  normalizarEstadoGpu,
  sinSenales,
  textoCoste,
  tipoCorto,
  transcurrido,
  type EstadoGpu,
} from "./gpu-texto.ts";
import { fijarIdioma, olvidarIdioma } from "./i18n.ts";

const AHORA = Date.parse("2026-10-23T20:10:00Z");

const base: EstadoGpu = {
  configurado: true,
  fase: "activa",
  activo: true,
  tipo: "gpu_1x_a10",
  desde: "2026-10-23T20:09:00Z",
  precioHora: 1.29,
  moneda: "USD",
  gastado: 0.02,
  proveedor: "lambda",
};

test("el tipo se abrevia sin perder lo que distingue a las tarjetas", () => {
  assert.equal(tipoCorto("gpu_1x_a10"), "A10");
  assert.equal(tipoCorto("gpu_1x_a100_sxm4"), "A100 SXM4");
  assert.equal(tipoCorto("gpu_1x_a100"), "A100");
  assert.equal(tipoCorto("gpu_8x_h100_sxm"), "8× H100 SXM");
  assert.equal(tipoCorto(""), "GPU");
});

test("el dinero va con dos decimales, en el formato del idioma", () => {
  assert.equal(dinero(1.29), "1.29");
  assert.equal(dinero(0), "0.00");
  assert.equal(dinero(0.0671), "0.07");
  assert.equal(dinero(12), "12.00");
  fijarIdioma("es");
  try {
    assert.equal(dinero(1.29), "1,29");
  } finally {
    olvidarIdioma();
  }
});

test("los relojes: hh:mm:ss facturado y minutos de arranque", () => {
  assert.equal(transcurrido(null), "00:00:00");
  assert.equal(transcurrido("2026-10-23T20:09:00Z", AHORA), "00:01:00");
  assert.equal(transcurrido("2026-10-23T19:06:55Z", AHORA), "01:03:05");
  assert.equal(minutosYsegundos("2026-10-23T20:07:26Z", AHORA), "2 min 34 s");
  assert.equal(minutosYsegundos("2026-10-23T20:09:20Z", AHORA), "40 s");
});

test("con la GPU activa se enseña la tarifa REAL y el gasto de la instancia", () => {
  assert.equal(textoCoste(base, 0.05, AHORA), "A10 · 1.29 $/h · 00:01:00 · 0.02 $ (session 0.05 $)");
});

test("la tarifa cambia con el tipo: un A100 no cuesta lo mismo que un A10", () => {
  const a100 = { ...base, tipo: "gpu_1x_a100_sxm4", precioHora: 1.99 };
  assert.match(textoCoste(a100, 0, AHORA), /^A100 SXM4 · 1\.99 \$\/h/);
});

test("arrancando: reloj de arranque y aviso de que aún no factura", () => {
  const estado: EstadoGpu = {
    ...base,
    fase: "arrancando",
    activo: false,
    desde: null,
    arranque: "2026-10-23T20:07:26Z",
    gastado: 0,
  };
  assert.equal(textoCoste(estado, 0.05, AHORA), "A10 starting · 2 min 34 s · not billing yet");
});

test("apagándose: se dice que se apaga, sin inventar cifras", () => {
  const estado: EstadoGpu = { ...base, fase: "apagandose", activo: false };
  assert.equal(textoCoste(estado, 0.05, AHORA), "A10 shutting down…");
});

test("apagada no enseña ninguna tarifa (ésa era la queja)", () => {
  const estado: EstadoGpu = { ...base, fase: "apagada", activo: false, desde: null, gastado: 0 };
  assert.equal(textoCoste(estado, 0, AHORA), "GPU off");
  assert.equal(textoCoste(estado, 0.07, AHORA), "GPU off · session 0.07 $");
  // Con ?lang=es, en español.
  fijarIdioma("es");
  try {
    assert.equal(textoCoste(estado, 0.07, AHORA), "GPU apagada · sesión 0,07 $");
    assert.equal(textoCoste({ ...base, fase: "apagandose", activo: false }, 0, AHORA), "A10 apagándose…");
  } finally {
    olvidarIdioma();
  }
});

test("antiguos estados sin fase se deducen de `activo`", () => {
  const sinFase = { ...base, fase: undefined };
  assert.match(textoCoste(sinFase, 0, AHORA), /^A10 · 1\.29 \$\/h/);
});

test("el detalle nombra cada instancia con su tarifa", () => {
  const estado: EstadoGpu = {
    ...base,
    instancias: [
      { id: "a", status: "active", tipo: "gpu_1x_a10", ip: "1.2.3.4", precioHora: 1.29, gastado: 0.07 },
      { id: "b", status: "terminating", tipo: "gpu_1x_a100_sxm4", ip: null, precioHora: 1.99, gastado: 7882.67 },
    ],
  };
  const detalle = detalleCoste(estado, 0.12);
  assert.match(detalle, /rate 1\.29 \$\/hour \(A10\)/);
  assert.match(detalle, /This browser session: 0\.12 \$/);
  assert.match(detalle, /gpu_1x_a10 · active · 1\.29 \$\/h · 0\.07 \$/);
  assert.match(detalle, /gpu_1x_a100_sxm4 · terminating · 1\.99 \$\/h · 7,882\.67 \$/);
  fijarIdioma("es");
  try {
    // es-ES no separa los millares de cuatro cifras (RAE): 7882,67, no 7.882,67.
    assert.match(detalleCoste(estado, 0.12), /gpu_1x_a100_sxm4 · terminating · 1,99 \$\/h · 7882,67 \$/);
    assert.match(detalleCoste(estado, 0.12), /tarifa 1,29 \$\/hora \(A10\)/);
  } finally {
    olvidarIdioma();
  }
});

test("el estado del endpoint (snake_case) se normaliza sin NaN", () => {
  const estado = normalizarEstadoGpu({
    configurado: true,
    fase: "activa",
    activo: true,
    tipo: "gpu_1x_a10",
    desde: "2026-10-23T20:09:00Z",
    precio_hora: 1.29,
    moneda: "USD",
    gastado: 0.02,
    proveedor: "lambda",
    instancias: [{ id: "x", status: "active", tipo: "gpu_1x_a10", ip: null }],
  });
  assert.equal(estado.precioHora, 1.29);
  assert.equal(estado.fase, "activa");
  assert.equal(estado.instancias?.length, 1);
  assert.doesNotMatch(detalleCoste(estado, 0), /NaN/);

  // Y sin datos no se inventa tarifa.
  const vacio = normalizarEstadoGpu({ configurado: false });
  assert.equal(vacio.precioHora, 0);
  assert.equal(textoCoste(vacio, 0, AHORA), "GPU off");
});

test("sin señales sólo avisa pasados los segundos del umbral", () => {
  assert.equal(sinSenales(AHORA - 30_000, AHORA), 0);
  assert.equal(sinSenales(AHORA - 90_000, AHORA), 0);
  assert.equal(sinSenales(AHORA - 132_000, AHORA), 132);
});

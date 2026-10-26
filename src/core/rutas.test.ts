import { test } from "node:test";
import assert from "node:assert/strict";

import { CARPETAS_COMPARTIDAS, esRutaCompartida, rutaEnWorkspace } from "./rutas.ts";

/**
 * La lista de carpetas compartidas la usan el servidor (para resolver rutas) y el
 * navegador (para pedirlas). Si se separan, el agente escribe en un sitio y la app
 * busca en otro: ya pasó con `catalogo/`, que faltaba en el navegador.
 */
test("las carpetas compartidas de la raíz se reconocen como tales", () => {
  for (const carpeta of CARPETAS_COMPARTIDAS) {
    assert.equal(esRutaCompartida(carpeta.slice(0, -1)), true, carpeta);
    assert.equal(esRutaCompartida(`${carpeta}un/fichero.txt`), true, carpeta);
  }
});

test("el catálogo y las salidas son compartidas, no del proyecto", () => {
  assert.equal(esRutaCompartida("catalogo/VCSL-1.2.2-RC/x.sfz"), true);
  assert.equal(esRutaCompartida("_salidas/render_abc.txt"), true);
  assert.equal(rutaEnWorkspace("salida/tema.wav", "stahl"), "proyectos/stahl/salida/tema.wav");
  assert.equal(rutaEnWorkspace("catalogo/a.wav", "stahl"), "catalogo/a.wav");
});

test("una carpeta que sólo empieza igual no cuela", () => {
  assert.equal(esRutaCompartida("codigofuente/x.py"), false);
  assert.equal(esRutaCompartida("proyectos2/x"), false);
  assert.equal(rutaEnWorkspace("codigofuente/x.py", "tema"), "proyectos/tema/codigofuente/x.py");
});

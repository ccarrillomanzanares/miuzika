import { test } from "node:test";
import assert from "node:assert/strict";

import { CARPETAS_COMPARTIDAS, esRutaCompartida, rutaEnWorkspace } from "./rutas.ts";

/**
 * The shared folder list is used by the server (to resolve paths) and the browser
 * (to request them). If they separate, the agent writes in one place and the app
 * looks in another: it already happened with `catalogo/`, which was missing in the browser.
 */
test("shared folders at the root are recognized as such", () => {
  for (const carpeta of CARPETAS_COMPARTIDAS) {
    assert.equal(esRutaCompartida(carpeta.slice(0, -1)), true, carpeta);
    assert.equal(esRutaCompartida(`${carpeta}un/fichero.txt`), true, carpeta);
  }
});

test("the catalog and the outputs are shared, not project-specific", () => {
  assert.equal(esRutaCompartida("catalogo/VCSL-1.2.2-RC/x.sfz"), true);
  assert.equal(esRutaCompartida("_salidas/render_abc.txt"), true);
  assert.equal(rutaEnWorkspace("salida/tema.wav", "stahl"), "proyectos/stahl/salida/tema.wav");
  assert.equal(rutaEnWorkspace("catalogo/a.wav", "stahl"), "catalogo/a.wav");
});

test("a folder that only starts the same does not sneak through", () => {
  assert.equal(esRutaCompartida("codigofuente/x.py"), false);
  assert.equal(esRutaCompartida("proyectos2/x"), false);
  assert.equal(rutaEnWorkspace("codigofuente/x.py", "tema"), "proyectos/tema/codigofuente/x.py");
});

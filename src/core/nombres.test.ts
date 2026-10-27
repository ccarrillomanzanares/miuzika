import assert from "node:assert/strict";
import test from "node:test";
import { normalizarTexto, slugDe } from "./nombres.ts";
import { carpetaDeNombre, carpetaDeProyecto, createProject } from "./project.ts";

test("slug latino: sin tildes, minúsculas y guiones", () => {
  assert.equal(slugDe("Ñandú Ácido (v2)"), "nandu-acido-v2");
  assert.equal(slugDe("  --hola--  "), "hola");
  assert.equal(slugDe("a_b c", { separador: "_" }), "a_b_c");
});

test("slug en otros alfabetos: no se pierde el nombre", () => {
  assert.equal(slugDe("夜の歌"), "夜の歌");
  assert.equal(slugDe("Песня о море"), "песня-о-море");
  assert.equal(slugDe("أغنية الليل"), "أغنية-الليل");
  assert.equal(slugDe("गीत नंबर 1"), "गीत-नंबर-1");
  // Dos nombres distintos en japonés ya no caen en la misma carpeta.
  assert.notEqual(carpetaDeNombre("夜の歌"), carpetaDeNombre("朝の歌"));
});

test("slug nunca deja salir de la carpeta", () => {
  for (const peligroso of ["../../etc", "a/b\\c", "C:\\x", "..", "a.b"]) {
    const s = slugDe(peligroso);
    assert.ok(!/[\\/.:]/.test(s), `${peligroso} -> ${s}`);
  }
  assert.equal(slugDe("", { defecto: "proyecto" }), "proyecto");
  assert.equal(slugDe("!!!", { defecto: "proyecto" }), "proyecto");
});

test("slug corta por puntos de código, no por mitad de un carácter", () => {
  const s = slugDe("🎵".repeat(10) + "abc", { max: 5 });
  assert.equal(Array.from(s).length <= 5, true);
});

test("normalizarTexto compara sin tildes en cualquier alfabeto", () => {
  assert.equal(normalizarTexto("  Bajo   Eléctrico "), "bajo electrico");
  assert.equal(normalizarTexto("ベース"), "ベース");
});

test("la carpeta del proyecto no cambia al renombrarlo", () => {
  const p = createProject({ name: "Primera idea" });
  assert.equal(carpetaDeProyecto(p), "primera-idea");
  p.name = "Título definitivo";
  assert.equal(carpetaDeProyecto(p), "primera-idea");
  // Un proyecto antiguo sin carpeta fijada sigue usando la de su nombre.
  delete p.meta.carpeta;
  assert.equal(carpetaDeProyecto(p), "titulo-definitivo");
});

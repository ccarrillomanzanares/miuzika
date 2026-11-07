import assert from "node:assert/strict";
import test from "node:test";
import { normalizarTexto, slugDe } from "./nombres.ts";
import { carpetaDeNombre, carpetaDeProyecto, createProject } from "./project.ts";

test("Latin slug: no accents, lowercase, and hyphens", () => {
  assert.equal(slugDe("Ñandú Ácido (v2)"), "nandu-acido-v2");
  assert.equal(slugDe("  --hola--  "), "hola");
  assert.equal(slugDe("a_b c", { separador: "_" }), "a_b_c");
});

test("slug in other alphabets: the name is not lost", () => {
  assert.equal(slugDe("夜の歌"), "夜の歌");
  assert.equal(slugDe("Песня о море"), "песня-о-море");
  assert.equal(slugDe("أغنية الليل"), "أغنية-الليل");
  assert.equal(slugDe("गीत नंबर 1"), "गीत-नंबर-1");
  // Two different names in Japanese no longer fall into the same folder.
  assert.notEqual(carpetaDeNombre("夜の歌"), carpetaDeNombre("朝の歌"));
});

test("slug never allows escaping the folder", () => {
  for (const peligroso of ["../../etc", "a/b\\c", "C:\\x", "..", "a.b"]) {
    const s = slugDe(peligroso);
    assert.ok(!/[\\/.:]/.test(s), `${peligroso} -> ${s}`);
  }
  assert.equal(slugDe("", { defecto: "proyecto" }), "proyecto");
  assert.equal(slugDe("!!!", { defecto: "proyecto" }), "proyecto");
});

test("slug cuts by code points, not through the middle of a character", () => {
  const s = slugDe("🎵".repeat(10) + "abc", { max: 5 });
  assert.equal(Array.from(s).length <= 5, true);
});

test("normalizarTexto compares without accents in any alphabet", () => {
  assert.equal(normalizarTexto("  Bajo   Eléctrico "), "bajo electrico");
  assert.equal(normalizarTexto("ベース"), "ベース");
});

test("the project folder does not change when it is renamed", () => {
  const p = createProject({ name: "Primera idea" });
  assert.equal(carpetaDeProyecto(p), "primera-idea");
  p.name = "Título definitivo";
  assert.equal(carpetaDeProyecto(p), "primera-idea");
  // An old project with no fixed folder still uses the one from its name.
  delete p.meta.carpeta;
  assert.equal(carpetaDeProyecto(p), "titulo-definitivo");
});

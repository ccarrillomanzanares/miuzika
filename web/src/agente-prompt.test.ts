import assert from "node:assert/strict";
import test from "node:test";
import { AGENTE_SISTEMA, HUELLA_PROMPT, huellaDe, promptDelSistema } from "./agente-prompt.ts";

/**
 * The agent prompt is not touched by accident: changing it changes all of its
 * behaviour. This test forces the change to be deliberate — HUELLA_PROMPT has to be
 * updated, and that shows up in the diff and in the review.
 */
test("the agent prompt does not change without updating its fingerprint", () => {
  assert.equal(
    huellaDe(AGENTE_SISTEMA),
    HUELLA_PROMPT,
    "the agent prompt has changed: if it is intentional, update HUELLA_PROMPT in web/src/agente-prompt.ts",
  );
});

test("the prompt is delivered as is, without substitutions", () => {
  const texto = promptDelSistema();
  assert.equal(texto, AGENTE_SISTEMA);
  assert.ok(!texto.includes("{{"), "no placeholder may be left to substitute");
});

test("the hard rules are still in the text", () => {
  const texto = promptDelSistema();
  for (const regla of [
    "compases=N",
    "no preguntes por MIDI o WAV",
    "exportar(midi, wav)",
    "medir_referencia",
    "usar_instrumento",
    "DINERO",
    "cola",
    "redefinas",
    "150 lineas",
    "No inventes resultados",
    "buscar_sonido",
    // Oct 27: the agent composes in the project, by sections and in each person's language.
    "leer_proyecto",
    "escribir_progresion",
    // Oct 28 (v4): it finishes the song in the turn and does not ask for the delivery format.
    "Termina la canción entera en el turno",
    "IDIOMA",
    // Oct 27 (v3): it starts building, composes with meaning and in compact notation.
    "HAZ, NO PREGUNTES",
    "UNA CANCIÓN CON SENTIDO",
    "escribir_notas",
    "listar_instrumentos",
    "No copies letras",
  ]) {
    assert.ok(texto.includes(regla), `missing the rule: ${regla}`);
  }
});

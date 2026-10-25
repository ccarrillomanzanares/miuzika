import assert from "node:assert/strict";
import test from "node:test";
import { AGENTE_SISTEMA, HUELLA_PROMPT, huellaDe, promptDelSistema } from "./agente-prompt.ts";

/**
 * El prompt del agente no se toca sin querer: cambiarlo cambia todo su
 * comportamiento. Esta prueba obliga a que el cambio sea deliberado — hay que
 * actualizar HUELLA_PROMPT, y eso se ve en el diff y en la revisión.
 */
test("el prompt del agente no cambia sin actualizar su huella", () => {
  const texto = AGENTE_SISTEMA.join("\n");
  assert.equal(
    huellaDe(texto),
    HUELLA_PROMPT,
    "ha cambiado el prompt del agente: si es intencionado, actualiza HUELLA_PROMPT en web/src/agente-prompt.ts",
  );
});

test("el vocabulario entra por el marcador y no queda ningún {{...}}", () => {
  const texto = promptDelSistema("seco, gordo, corto");
  assert.ok(texto.includes("Palabras del sistema: seco, gordo, corto"));
  assert.ok(!texto.includes("{{"));
});

test("las diez reglas duras siguen en el texto", () => {
  const texto = promptDelSistema("x");
  for (const regla of [
    "compases=N",
    "ANTES DE ENTREGAR, PREGUNTA",
    "medir_referencia",
    "usar_instrumento",
    "DINERO",
    "cola",
    "redefinas",
    "150 lineas",
    "No inventes resultados",
    "buscar_sonido",
  ]) {
    assert.ok(texto.includes(regla), `falta la regla: ${regla}`);
  }
});

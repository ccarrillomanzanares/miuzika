import assert from "node:assert/strict";
import test from "node:test";
import { AGENTE_SISTEMA, HUELLA_PROMPT, huellaDe, promptDelSistema } from "./agente-prompt.ts";

/**
 * El prompt del agente no se toca sin querer: cambiarlo cambia todo su
 * comportamiento. Esta prueba obliga a que el cambio sea deliberado — hay que
 * actualizar HUELLA_PROMPT, y eso se ve en el diff y en la revisión.
 */
test("el prompt del agente no cambia sin actualizar su huella", () => {
  assert.equal(
    huellaDe(AGENTE_SISTEMA),
    HUELLA_PROMPT,
    "ha cambiado el prompt del agente: si es intencionado, actualiza HUELLA_PROMPT en web/src/agente-prompt.ts",
  );
});

test("el prompt se entrega tal cual, sin sustituciones", () => {
  const texto = promptDelSistema();
  assert.equal(texto, AGENTE_SISTEMA);
  assert.ok(!texto.includes("{{"), "no debe quedar ningún marcador por sustituir");
});

test("las reglas duras siguen en el texto", () => {
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
    // 27-oct: el agente compone en el proyecto, por secciones y en el idioma de cada uno.
    "leer_proyecto",
    "escribir_progresion",
    // 28-oct (v4): termina la canción en el turno y no pregunta el formato de entrega.
    "Termina la canción entera en el turno",
    "IDIOMA",
    // 27-oct (v3): arranca construyendo, compone con sentido y en notación compacta.
    "HAZ, NO PREGUNTES",
    "UNA CANCIÓN CON SENTIDO",
    "escribir_notas",
    "listar_instrumentos",
    "No copies letras",
  ]) {
    assert.ok(texto.includes(regla), `falta la regla: ${regla}`);
  }
});

/**
 * The agent script sandbox, tested with real Python: a fake repository in a temporary
 * folder (with its own .env), a project inside workspace/ and
 * scripts that attempt each forbidden thing. The real engine (workspace/codigo) goes on
 * the PYTHONPATH, to check that numpy and the render still work.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { CAJA, entornoDeCaja } from "../api/python.ts";

const interprete = process.env.MIUZIKA_PYTHON || "python";
const MOTOR = resolve(process.cwd(), "workspace", "codigo");

function montar() {
  const repo = mkdtempSync(join(tmpdir(), "miuzika-caja-"));
  const workspace = join(repo, "workspace");
  const proyecto = join(workspace, "proyectos", "prueba");
  mkdirSync(proyecto, { recursive: true });
  writeFileSync(join(repo, ".env"), "OLLAMA_API_KEY=secreta\n");
  const correr = (codigo: string) => {
    const script = join(proyecto, "script.py");
    writeFileSync(script, codigo);
    const r = spawnSync(interprete, ["-u", CAJA, script], {
      cwd: proyecto,
      env: entornoDeCaja({ ...process.env, MIUZIKA_CLAVE_DE_PRUEBA: "no-debe-llegar" }, { motor: MOTOR, proyecto, repo, workspace }),
      encoding: "utf8",
      timeout: 60_000,
    });
    return { codigo: r.status, salida: r.stdout, errores: r.stderr };
  };
  return { repo, proyecto, correr };
}

test("a normal script writes in its project and uses the engine (numpy)", () => {
  const { proyecto, correr } = montar();
  const r = correr(
    [
      "import os, numpy as np",
      "from render import write_wav",
      "os.makedirs('salida', exist_ok=True)",
      "write_wav('salida/tono.wav', np.sin(np.linspace(0, 440 * 2 * np.pi, 44100)) * 0.5)",
      "import tempfile",
      "with tempfile.NamedTemporaryFile(delete=False) as f: f.write(b'x')",
      "print('ok', os.environ.get('MIUZIKA_CLAVE_DE_PRUEBA'))",
    ].join("\n"),
  );
  assert.equal(r.codigo, 0, r.errores);
  assert.match(r.salida, /ok None/, "the server variables do not reach the script");
  assert.ok(existsSync(join(proyecto, "salida", "tono.wav")));
  assert.ok(!existsSync(join(proyecto, ".tmp-caja")), "the script temp is deleted when it finishes");
});

test("does not write to or delete anything outside the project", () => {
  const { repo, correr } = montar();
  const fuera = join(repo, "workspace", "codigo_pisado.py").replaceAll("\\", "/");
  const escribir = correr(`open(r"${fuera}", "w").write("x")`);
  assert.notEqual(escribir.codigo, 0);
  assert.match(escribir.errores, /miuzika: write .* is outside the project folder/);
  assert.ok(!existsSync(fuera));

  const borrar = correr(`import os\nos.remove(r"${join(repo, ".env").replaceAll("\\", "/")}")`);
  assert.notEqual(borrar.codigo, 0);
  assert.ok(existsSync(join(repo, ".env")), "the .env is still there");
});

test("does not read the repository keys", () => {
  const { repo, correr } = montar();
  const r = correr(`print(open(r"${join(repo, ".env").replaceAll("\\", "/")}").read())`);
  assert.notEqual(r.codigo, 0);
  assert.doesNotMatch(r.salida, /secreta/);
  assert.match(r.errores, /not allowed/);
});

test("does not launch processes or open the network", () => {
  const { correr } = montar();
  const proceso = correr("import subprocess\nsubprocess.run(['whoami'])");
  assert.notEqual(proceso.codigo, 0);
  assert.match(proceso.errores, /do not launch other programs/);
  const sistema = correr("import os\nos.system('echo hola')");
  assert.notEqual(sistema.codigo, 0);
  const red = correr("import socket\nsocket.create_connection(('example.com', 80), timeout=2)");
  assert.notEqual(red.codigo, 0);
  assert.match(red.errores, /do not open network connections/);
});

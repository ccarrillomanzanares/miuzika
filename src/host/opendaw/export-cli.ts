/**
 * Exporta un proyecto JSON de miuzika al formato de proyecto de openDAW.
 *
 *   npm run export:opendaw -- out/noche.json
 *   npm run export:opendaw -- out/noche.json out/noche.odw
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { Project } from "../../core/types.ts";
import { projectToOpenDaw } from "./adapter.ts";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("uso: npm run export:opendaw -- <proyecto.json> [salida.odw]");
  process.exit(1);
}

const project = JSON.parse(await readFile(input, "utf8")) as Project;
const result = await projectToOpenDaw(project);
const target = output ?? input.replace(/\.json$/i, ".odw");
await writeFile(target, Buffer.from(result.bytes));

console.log(`openDAW: ${path.relative(process.cwd(), target)}`);
console.log(
  `  ${result.stats.tracks} pistas · ${result.stats.regions} clips · ${result.stats.notes} notas · ${result.stats.devices} FX · ${result.bytes.byteLength} bytes`,
);
for (const warning of result.warnings) console.warn(`  aviso: ${warning}`);

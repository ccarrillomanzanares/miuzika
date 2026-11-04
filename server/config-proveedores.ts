/**
 * `.miuzika/proveedores.json`: the LLM providers (`activo`, `proveedores`) and, since 4-Nov,
 * the GPU (`gpu`). One reader and one writer, so saving one part never drops the other:
 * before 4-Nov the writer rebuilt the file from the LLM part only.
 * The file holds keys: outside git and outside workspace/ (house rule 3). Never logged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ConfigGpu } from "../src/core/proveedores-gpu.ts";

/** MIUZIKA_PROVEEDORES points a test server at another file, so trying the routes never touches the real keys. */
export const FICHERO_PROVEEDORES = process.env.MIUZIKA_PROVEEDORES || resolve(process.cwd(), ".miuzika", "proveedores.json");

export interface FicheroProveedores {
  activo?: unknown;
  proveedores?: unknown;
  gpu?: ConfigGpu;
  [otra: string]: unknown;
}

export function leerFicheroProveedores(fichero = FICHERO_PROVEEDORES): FicheroProveedores {
  try {
    if (!existsSync(fichero)) return {};
    const datos = JSON.parse(readFileSync(fichero, "utf8")) as unknown;
    return typeof datos === "object" && datos !== null ? (datos as FicheroProveedores) : {};
  } catch {
    return {};
  }
}

/** Writes `cambios` over what is in the file, keeping every other key. */
export function guardarFicheroProveedores(cambios: FicheroProveedores, fichero = FICHERO_PROVEEDORES): void {
  const actual = leerFicheroProveedores(fichero);
  mkdirSync(dirname(fichero), { recursive: true });
  writeFileSync(fichero, JSON.stringify({ ...actual, ...cambios }, null, 2), { encoding: "utf8", mode: 0o600 });
}

/** The GPU part, shape-checked. */
export function leerConfigGpu(fichero = FICHERO_PROVEEDORES): ConfigGpu | undefined {
  const gpu = leerFicheroProveedores(fichero).gpu as Partial<ConfigGpu> | undefined;
  if (!gpu || typeof gpu !== "object") return undefined;
  return {
    ...(typeof gpu.activo === "string" ? { activo: gpu.activo } : {}),
    proveedores: typeof gpu.proveedores === "object" && gpu.proveedores ? gpu.proveedores : {},
  };
}

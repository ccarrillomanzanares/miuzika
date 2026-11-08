/**
 * `.miuzika/proveedores.json`: the settings of what the app rents, for now the GPU (`gpu`). One reader
 * and one writer, so saving one part never drops another. Same file and shape as miuzika's.
 * The file holds keys: outside git and outside workspace/. Never logged.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ConfigGpu } from "../src/core/proveedores-gpu.ts";

/** MIUZIKA_PROVEEDORES points a test server at another file, so trying the routes never touches the real keys. */
export const FICHERO_PROVEEDORES = process.env.MIUZIKA_PROVEEDORES || resolve(process.cwd(), ".miuzika", "proveedores.json");

export interface FicheroProveedores {
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

/**
 * The Hugging Face token (8-Nov: Stable Audio 3's weights are gated). Saved in Settings; `HF_TOKEN` in the
 * environment is the fallback. Never returned to the browser or logged.
 */
export function leerTokenHf(fichero = FICHERO_PROVEEDORES): string {
  const hf = leerFicheroProveedores(fichero).huggingface as { token?: unknown } | undefined;
  const guardado = hf && typeof hf.token === "string" ? hf.token.trim() : "";
  return guardado || (process.env.HF_TOKEN ?? "").trim();
}

export function origenTokenHf(fichero = FICHERO_PROVEEDORES): "ajustes" | "env" | "falta" {
  const hf = leerFicheroProveedores(fichero).huggingface as { token?: unknown } | undefined;
  if (hf && typeof hf.token === "string" && hf.token.trim() !== "") return "ajustes";
  return (process.env.HF_TOKEN ?? "").trim() !== "" ? "env" : "falta";
}

/** The GPU part, shape-checked. */
export function leerConfigGpu(fichero = FICHERO_PROVEEDORES): ConfigGpu | undefined {
  const gpu = leerFicheroProveedores(fichero).gpu as Partial<ConfigGpu> | undefined;
  if (!gpu || typeof gpu !== "object") return undefined;
  return { proveedores: typeof gpu.proveedores === "object" && gpu.proveedores ? gpu.proveedores : {} };
}

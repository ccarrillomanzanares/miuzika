/**
 * Bundle autocontenido de un proyecto: `project.json` + WAVs en un ZIP.
 *
 * Sólo se lee (la app no exporta bundles). Los WAV que trae se devuelven para
 * que main.ts los escriba en la carpeta del proyecto: aquí no se guarda nada.
 */

import { strFromU8, unzipSync } from "fflate";
import type { Project } from "../../src/core/types.ts";

interface BundleAsset {
  id: string;
  name: string;
  file: string;
}

/** Un WAV del bundle, listo para subirlo a `proyectos/<slug>/entrada/`. */
export interface WavDeBundle {
  assetId: string;
  nombre: string;
  data: Uint8Array;
}

interface BundleManifest {
  format: "miuzika-project";
  version: number;
  assets: BundleAsset[];
}

export interface BundleImportado {
  project: Project;
  wavs: WavDeBundle[];
  warnings: string[];
}

function nombreDeFichero(ruta: string): string {
  return (ruta.split("/").pop() ?? "audio.wav").replace(/[^\w.-]+/g, "_");
}

export async function importProjectBundle(file: Blob): Promise<BundleImportado> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("El archivo no es un bundle de miuzika válido.");
  }
  const projectBytes = entries["project.json"];
  if (!projectBytes) throw new Error("El bundle no contiene project.json.");
  let project: Project;
  try {
    project = JSON.parse(strFromU8(projectBytes)) as Project;
  } catch {
    throw new Error("project.json no es JSON válido.");
  }
  if (!project || project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
    throw new Error("El proyecto del bundle no es válido.");
  }

  const warnings: string[] = [];
  const manifest = entries["manifest.json"]
    ? (JSON.parse(strFromU8(entries["manifest.json"])) as BundleManifest)
    : null;
  if (manifest && manifest.format !== "miuzika-project") {
    throw new Error("El manifest del bundle no es de miuzika.");
  }

  // Los WAV se devuelven con el id del asset al que pertenecen, para poder
  // escribir su ruta en el proyecto.
  const wavs: WavDeBundle[] = [];
  for (const asset of manifest?.assets ?? []) {
    const data = entries[asset.file];
    if (!data || data.length === 0) {
      warnings.push(`Falta el WAV "${asset.name}" dentro del bundle.`);
      continue;
    }
    wavs.push({ assetId: asset.id, nombre: nombreDeFichero(asset.file), data });
  }
  return { project, wavs, warnings };
}

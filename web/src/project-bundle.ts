/**
 * Self-contained bundle of a project: `project.json` + WAVs in a ZIP.
 *
 * It is read-only (the app does not export bundles). The WAVs it contains are
 * returned so that main.ts can write them into the project folder: nothing is
 * saved here.
 */

import { strFromU8, unzipSync } from "fflate";
import type { Project } from "../../src/core/types.ts";
import { migrarProyecto } from "../../src/core/project.ts";

interface BundleAsset {
  id: string;
  name: string;
  file: string;
}

/** A WAV from the bundle, ready to be uploaded to `proyectos/<slug>/entrada/`. */
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
    throw new Error("The file is not a valid miuzika bundle.");
  }
  const projectBytes = entries["project.json"];
  if (!projectBytes) throw new Error("The bundle does not contain project.json.");
  let project: Project;
  try {
    project = JSON.parse(strFromU8(projectBytes)) as Project;
  } catch {
    throw new Error("project.json is not valid JSON.");
  }
  if (!project || project.schemaVersion !== 1 || !Array.isArray(project.tracks)) {
    throw new Error("The project in the bundle is not valid.");
  }
  migrarProyecto(project);

  const warnings: string[] = [];
  const manifest = entries["manifest.json"]
    ? (JSON.parse(strFromU8(entries["manifest.json"])) as BundleManifest)
    : null;
  if (manifest && manifest.format !== "miuzika-project") {
    throw new Error("The bundle manifest is not from miuzika.");
  }

  // The WAVs are returned with the id of the asset they belong to, so that their
  // path can be written into the project.
  const wavs: WavDeBundle[] = [];
  for (const asset of manifest?.assets ?? []) {
    const data = entries[asset.file];
    if (!data || data.length === 0) {
      warnings.push(`The WAV "${asset.name}" is missing from the bundle.`);
      continue;
    }
    wavs.push({ assetId: asset.id, nombre: nombreDeFichero(asset.file), data });
  }
  return { project, wavs, warnings };
}

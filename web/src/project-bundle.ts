/** Proyecto autocontenido: project.json + WAVs, en un ZIP. */

import { strFromU8, unzipSync } from "fflate";
import type { Project } from "../../src/core/types.ts";
import { audioAssets, computePeaks, decodeAudioBlob } from "./audio-store.ts";
import { putAudioAsset } from "./audio-db.ts";

interface BundleAsset {
  id: string;
  name: string;
  durationBeats: number;
  file: string;
}

interface BundleManifest {
  format: "miuzika-project";
  version: number;
  assets: BundleAsset[];
}

interface ImportedProjectBundle {
  project: Project;
  warnings: string[];
}

function collectAssetIds(project: Project): string[] {
  const ids = new Set<string>();
  for (const asset of project.audioAssets ?? []) ids.add(asset.id);
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.audio) ids.add(clip.audio.assetId);
    }
  }
  return [...ids];
}

export async function importProjectBundle(file: Blob): Promise<ImportedProjectBundle> {
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
  const assets = manifest?.assets ?? [];
  for (const asset of assets) {
    const data = entries[asset.file];
    if (!data) {
      warnings.push(`Falta el WAV "${asset.name}" dentro del bundle.`);
      continue;
    }
    const blob = new Blob([data as BlobPart], { type: "audio/wav" });
    if (!(await putAudioAsset({ id: asset.id, name: asset.name, durationBeats: asset.durationBeats, blob }))) {
      warnings.push(`No se pudo guardar "${asset.name}" en IndexedDB.`);
      continue;
    }
    try {
      const buffer = await decodeAudioBlob(blob);
      audioAssets.set(asset.id, {
        id: asset.id,
        name: asset.name,
        buffer,
        durationBeats: asset.durationBeats,
        peaks: computePeaks(buffer),
      });
    } catch {
      warnings.push(`El WAV "${asset.name}" está dañado o no se puede decodificar.`);
    }
  }
  for (const id of collectAssetIds(project)) {
    if (!assets.some((asset) => asset.id === id)) {
      warnings.push(`El proyecto referencia el WAV "${id}", pero no está en el bundle.`);
    }
  }
  return { project, warnings };
}

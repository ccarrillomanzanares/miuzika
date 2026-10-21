/** Proyecto autocontenido: project.json + WAVs, en un ZIP. */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Project } from "../../src/core/types.ts";
import { audioAssets, computePeaks, decodeAudioBlob } from "./audio-store.ts";
import { getAudioAsset, putAudioAsset } from "./audio-db.ts";
import { audioBufferToWav } from "./wav.ts";

const MANIFEST_VERSION = 1;

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

export interface ProjectBundleResult {
  blob: Blob;
  warnings: string[];
}

export interface ImportedProjectBundle {
  project: Project;
  warnings: string[];
}

function safeFile(id: string): string {
  return id.replace(/[^a-zA-Z0-9_.-]+/g, "_");
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

export async function exportProjectBundle(project: Project): Promise<ProjectBundleResult> {
  const warnings: string[] = [];
  const entries: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(project, null, 2)),
  };
  const assets: BundleAsset[] = [];
  for (const id of collectAssetIds(project)) {
    const meta =
      project.audioAssets?.find((asset) => asset.id === id) ??
      ({ id, name: id, durationBeats: 1 } as const);
    let blob: Blob | null = null;
    const stored = await getAudioAsset(id);
    if (stored) {
      blob = stored.blob;
    } else {
      const loaded = audioAssets.get(id);
      if (loaded) {
        blob = new Blob([audioBufferToWav(loaded.buffer)], { type: "audio/wav" });
      }
    }
    if (!blob) {
      warnings.push(`No se encontró el WAV de "${meta.name}"; el bundle lo omitirá.`);
      continue;
    }
    const file = `audio/${safeFile(id)}.wav`;
    entries[file] = new Uint8Array(await blob.arrayBuffer());
    assets.push({
      id,
      name: meta.name,
      durationBeats: meta.durationBeats,
      file,
    });
  }
  const manifest: BundleManifest = {
    format: "miuzika-project",
    version: MANIFEST_VERSION,
    assets,
  };
  entries["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  const archive = zipSync(entries, { level: 0 });
  return {
    blob: new Blob([archive as BlobPart], { type: "application/zip" }),
    warnings,
  };
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

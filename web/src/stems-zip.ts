/** Empaqueta los stems en un ZIP (sin compresión: los WAV ya son PCM). */

import { zipSync } from "fflate";

export interface StemEntry {
  name: string;
  blob: Blob;
}

export async function zipStems(files: StemEntry[]): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = new Uint8Array(await file.blob.arrayBuffer());
  }
  const archive = zipSync(entries, { level: 0 });
  return new Blob([archive as BlobPart], { type: "application/zip" });
}

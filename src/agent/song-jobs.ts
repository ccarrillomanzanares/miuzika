/** Trabajos de canción en segundo plano. Los WAVs viven en disco. */

import { randomUUID } from "node:crypto";
import path from "node:path";
import type { LlmClient } from "./client.ts";
import { runSongAgent } from "./song-agent.ts";
import type { SongAgentLogEntry } from "./song-agent.ts";
import { SongWorkspace } from "./song-workspace.ts";

export type SongJobStatus = "running" | "done" | "error";

export interface SongJobView {
  id: string;
  status: SongJobStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  logs: SongAgentLogEntry[];
  finalText: string;
  error?: string;
  bundle?: string;
  artifacts: Array<{ path: string; bytes: number }>;
}

interface SongJob extends SongJobView {
  workspace: SongWorkspace;
}

const jobs = new Map<string, SongJob>();

function view(job: SongJob): SongJobView {
  return {
    id: job.id,
    status: job.status,
    prompt: job.prompt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    logs: job.logs,
    finalText: job.finalText,
    ...(job.error ? { error: job.error } : {}),
    ...(job.bundle ? { bundle: job.bundle } : {}),
    artifacts: job.artifacts,
  };
}

export async function startSongJob(prompt: string, client: LlmClient): Promise<SongJobView> {
  const id = `song_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const workspace = await SongWorkspace.create(id);
  const now = new Date().toISOString();
  const job: SongJob = {
    id,
    status: "running",
    prompt,
    createdAt: now,
    updatedAt: now,
    logs: [],
    finalText: "",
    artifacts: [],
    workspace,
  };
  jobs.set(id, job);

  void (async () => {
    try {
      const result = await runSongAgent({
        client,
        prompt,
        workspace,
        onLog: (entry) => {
          job.logs.push(entry);
          if (job.logs.length > 80) job.logs.shift();
          job.updatedAt = new Date().toISOString();
        },
      });
      job.finalText = result.finalText;
      job.bundle = result.bundle ?? undefined;
      job.artifacts = await workspace.artifacts();
      job.status = result.bundle ? "done" : "error";
      if (!result.bundle) job.error = "El agente no generó ningún .miuzika.zip";
    } catch (error) {
      job.status = "error";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.updatedAt = new Date().toISOString();
    }
  })();

  return view(job);
}

export function getSongJob(id: string): SongJobView | null {
  const job = jobs.get(id);
  return job ? view(job) : null;
}

export function resolveSongArtifact(id: string, relative: string): string | null {
  const job = jobs.get(id);
  if (!job || !relative || path.isAbsolute(relative)) return null;
  const root = job.workspace.out;
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

export function listSongJobs(): SongJobView[] {
  return [...jobs.values()].map(view);
}

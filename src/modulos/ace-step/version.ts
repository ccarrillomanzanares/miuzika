/**
 * The tell-tale for ACE-Step's version. Every boot installs the pinned commit, so a new version upstream
 * changes nothing by itself: this says it exists, and the person decides (Carlos, 6-Nov).
 */

/**
 * The pinned version, the one every lineage so far was made with. Moved by hand once a new one has been
 * tried by ear, with REPO_COMMIT in workspace/gpu/generar_audio.py (a test ties them).
 */
export const ACESTEP_CONOCIDA = "ca1e85fe9430179831e6bc6be790c332190a3866";

export type Upstream = { commit: string; fecha: string } | { error: string };

const corto = (commit: string): string => commit.slice(0, 7);

/** A lineage keeps the short form of the hash and upstream gives the long one. */
const mismoCommit = (a: string, b: string): boolean => a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a));

/** What upstream holds against the version we know. Null while nobody has answered yet. */
export function avisoDeVersion(upstream: Upstream | null, conocida = ACESTEP_CONOCIDA): { cambio: boolean; texto: string } | null {
  if (upstream === null) return null;
  if ("error" in upstream) return { cambio: false, texto: `ACE-Step ${corto(conocida)}. Could not check upstream for changes: ${upstream.error}` };
  if (mismoCommit(upstream.commit, conocida)) return { cambio: false, texto: `ACE-Step ${corto(conocida)}: no change upstream.` };
  return {
    cambio: true,
    texto: `ACE-Step has changed upstream: main is now ${corto(upstream.commit)} (${upstream.fecha.slice(0, 10)}). miuzika stays pinned to ${corto(conocida)} until you decide to move: nothing changes by itself.`,
  };
}

/** What a finished take says it was made with: proof the pin held. Null if it is the pinned one. */
export function avisoDeToma(nombre: string, commit: unknown, conocida = ACESTEP_CONOCIDA): string | null {
  if (typeof commit !== "string" || !/^[0-9a-f]{7,40}$/.test(commit)) return `ACE-Step “${nombre}”: the version it was made with could not be read.`;
  if (mismoCommit(commit, conocida)) return null;
  return `ACE-Step “${nombre}” was made with version ${corto(commit)}, not the pinned ${corto(conocida)}: it may not compare with earlier takes.`;
}

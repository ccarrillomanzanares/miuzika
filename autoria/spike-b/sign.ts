/**
 * Spike B — authorship layer for a miuzika export, end to end and without GPU.
 *
 *   node sign.ts sign    <slug> <file-in-salida> [--ai-assisted] [--allow-training]
 *   node sign.ts verify  <signed-file>
 *   node sign.ts upgrade <file.ots>
 *
 * `sign` takes a WAV/MP3/FLAC that miuzika wrote in `workspace/proyectos/<slug>/salida/`
 * and produces, next to it:
 *   <name>.signed.<ext>        the same audio (bit-identical PCM, measured 2-Nov) with an
 *                              embedded C2PA manifest signed with the artist's key
 *   <name>.signed.<ext>.c2pa   the same manifest as a sidecar, for when a platform strips it
 *   <name>.signed.<ext>.ots    OpenTimestamps proof of the signed file's SHA-256
 *   <name>.signed.<ext>.provenance.json  a human-readable summary of all of the above
 *
 * The manifest carries three assertions:
 *   c2pa.actions            c2pa.created + digitalSourceType (digitalCreation, or
 *                           compositeWithTrainedAlgorithmicMedia with --ai-assisted)
 *   cawg.training-mining    consent: generative training and data mining notAllowed by
 *                           default, inference allowed; --allow-training flips the first two
 *   org.miuzika.lineage     what the file was made from: project, tracks, instruments,
 *                           stems with their SHA-256, miuzika commit, agent model if known
 *
 * Runs on Node 24 (type stripping), needs `c2patool` on PATH and the keys made by
 * `make-keys.sh` in MIUZIKA_AUTORIA_DIR (default ~/.miuzika/autoria). Nothing here
 * touches web/ or server/: it is a CLI consumed from the outside, on purpose.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OTS: any = require("opentimestamps");

const RAIZ = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");
const CLAVES = process.env.MIUZIKA_AUTORIA_DIR || join(homedir(), ".miuzika", "autoria");
const CLAVE_PRIVADA = join(CLAVES, "artist.key");
const CADENA = join(CLAVES, "artist-chain.pem");
const CA = join(CLAVES, "ca.pem");

type Consentimiento = "allowed" | "notAllowed" | "constrained";

interface Proyecto {
  id?: string;
  name?: string;
  bpm?: number;
  key?: { tonic: string; mode: string };
  timeSignature?: { numerator: number; denominator: number };
  lengthBars?: number;
  tracks?: Array<{ name: string; kind: string; instrument?: Record<string, unknown> }>;
  audioAssets?: Array<{ id: string; name: string; ruta?: string }>;
  meta?: { generator?: string; prompt?: string; createdAt?: string; carpeta?: string };
}

function sha256(ruta: string): string {
  return createHash("sha256").update(readFileSync(ruta)).digest("hex");
}

function winPath(p: string): string {
  // c2patool parses "C:/..." as a URL scheme on Windows (measured 2-Nov: "URL scheme is
  // not allowed"), so trust-store paths must be relative; manifest paths accept forward slashes.
  return resolve(p).replace(/\\/g, "/");
}

function c2patool(args: string[], cwd?: string): { ok: boolean; salida: string } {
  const r = spawnSync("c2patool", args, { encoding: "utf8", cwd, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`c2patool is not on PATH: ${r.error.message}`);
  return { ok: r.status === 0, salida: `${r.stdout}${r.stderr}` };
}

function gitCommit(): string | null {
  const r = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The agent model that last touched the project, read from the trajectories if any. */
function modeloDelAgente(carpeta: string): string | null {
  const dir = join(carpeta, "trayectorias");
  if (!existsSync(dir)) return null;
  try {
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const ficheros = readdirSync(dir).filter((f: string) => f.endsWith(".json")).sort();
    if (ficheros.length === 0) return null;
    // Trajectory records carry `proveedor` and `modelo` at the top level (src/core/trayectoria.ts).
    const t = JSON.parse(readFileSync(join(dir, ficheros[ficheros.length - 1]!), "utf8"));
    return t.modelo ? `${t.proveedor ? `${t.proveedor}/` : ""}${t.modelo}` : null;
  } catch {
    return null;
  }
}

function construirManifiesto(slug: string, fichero: string, opciones: { aiAssisted: boolean; allowTraining: boolean }) {
  const carpeta = join(RAIZ, "workspace", "proyectos", slug);
  const rutaProyecto = join(carpeta, "proyecto.json");
  if (!existsSync(rutaProyecto)) throw new Error(`no project at ${rutaProyecto}`);
  const envoltorio = JSON.parse(readFileSync(rutaProyecto, "utf8"));
  const p: Proyecto = envoltorio.proyecto ?? envoltorio;

  const stems = (p.audioAssets ?? [])
    .filter((a) => a.ruta && existsSync(join(carpeta, a.ruta)))
    .filter((a) => resolve(join(carpeta, a.ruta!)) !== resolve(fichero))
    .map((a) => ({ name: a.name, path: a.ruta, sha256: sha256(join(carpeta, a.ruta!)) }));

  const consentimiento: Record<string, { use: Consentimiento }> = {
    "cawg.ai_generative_training": { use: opciones.allowTraining ? "allowed" : "notAllowed" },
    "cawg.ai_training": { use: opciones.allowTraining ? "allowed" : "notAllowed" },
    "cawg.data_mining": { use: opciones.allowTraining ? "allowed" : "notAllowed" },
    "cawg.ai_inference": { use: "allowed" },
  };

  const digitalSourceType = opciones.aiAssisted
    ? "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"
    : "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation";

  return {
    claim_version: 2,
    alg: "es256",
    private_key: winPath(CLAVE_PRIVADA),
    sign_cert: winPath(CADENA),
    ta_url: "http://timestamp.digicert.com",
    claim_generator_info: [{ name: "miuzika", version: `spike-b${gitCommit() ? `+${gitCommit()}` : ""}` }],
    title: p.name ?? slug,
    assertions: [
      { label: "c2pa.actions", data: { actions: [{ action: "c2pa.created", digitalSourceType }] } },
      { label: "cawg.training-mining", data: { entries: consentimiento } },
      {
        label: "org.miuzika.lineage",
        data: {
          version: 1,
          tool: { name: "miuzika", commit: gitCommit() },
          project: {
            slug,
            id: p.id ?? null,
            name: p.name ?? null,
            bpm: p.bpm ?? null,
            key: p.key ?? null,
            timeSignature: p.timeSignature ?? null,
            lengthBars: p.lengthBars ?? null,
            createdAt: p.meta?.createdAt ?? null,
            generator: p.meta?.generator ?? null,
            projectSha256: sha256(rutaProyecto),
          },
          tracks: (p.tracks ?? []).map((t) => ({
            name: t.name,
            kind: t.kind,
            instrument: t.instrument ? { type: t.instrument.type, archivo: t.instrument.archivo ?? null, program: t.instrument.program ?? null } : null,
          })),
          stems,
          // Honest about what we do NOT claim: no statistical attribution, no claim that the
          // listed stems are the only sources. See CONCEPT.md.
          agent: { model: modeloDelAgente(carpeta), aiAssisted: opciones.aiAssisted },
          generation: null, // filled by Spike A (model, version, LoRA, prompt, seed)
        },
      },
    ],
  };
}

async function firmar(slug: string, entrada: string, opciones: { aiAssisted: boolean; allowTraining: boolean }) {
  if (!existsSync(CLAVE_PRIVADA) || !existsSync(CADENA)) throw new Error(`keys not found in ${CLAVES}; run make-keys.sh`);
  const ext = extname(entrada);
  const salida = join(dirname(entrada), `${basename(entrada, ext)}.signed${ext}`);
  const manifiesto = construirManifiesto(slug, entrada, opciones);
  const tmp = mkdtempSync(join(tmpdir(), "miuzika-sign-"));
  try {
    const rutaManifiesto = join(tmp, "manifest.json");
    writeFileSync(rutaManifiesto, JSON.stringify(manifiesto, null, 2));
    const t0 = Date.now();
    const embebido = c2patool([winPath(entrada), "-m", winPath(rutaManifiesto), "-o", winPath(salida), "-f"]);
    if (!embebido.ok) throw new Error(`c2patool (embed) failed:\n${embebido.salida.slice(0, 2000)}`);
    const msFirma = Date.now() - t0;
    // Sidecar for platforms that strip metadata: same claim, same signature, separate file.
    const sidecarWav = join(tmp, basename(salida));
    const sidecar = c2patool([winPath(entrada), "-m", winPath(rutaManifiesto), "-o", winPath(sidecarWav), "-s", "-f"]);
    if (!sidecar.ok) throw new Error(`c2patool (sidecar) failed:\n${sidecar.salida.slice(0, 2000)}`);
    const rutaSidecar = `${salida}.c2pa`;
    writeFileSync(rutaSidecar, readFileSync(sidecarWav.replace(/\.[^.]+$/, ".c2pa")));

    const informe = JSON.parse(embebido.salida);
    const activo = informe.manifests[informe.active_manifest];

    const bytes = readFileSync(salida);
    const detached = OTS.DetachedTimestampFile.fromBytes(new OTS.Ops.OpSHA256(), bytes);
    const t1 = Date.now();
    await OTS.stamp(detached);
    const rutaOts = `${salida}.ots`;
    writeFileSync(rutaOts, Buffer.from(detached.serializeToBytes()));
    const msOts = Date.now() - t1;

    const resumen = {
      file: basename(salida),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      manifest: {
        label: informe.active_manifest,
        bytes: statSync(rutaSidecar).size,
        signer: activo.signature_info,
        signedAt: activo.signature_info?.time ?? null,
        validation: (informe.validation_status ?? []).map((v: { code: string }) => v.code),
        sidecar: basename(rutaSidecar),
      },
      consent: manifiesto.assertions[1]!.data,
      lineage: manifiesto.assertions[2]!.data,
      opentimestamps: {
        proof: basename(rutaOts),
        status: "pending (calendars answered; Bitcoin attestation arrives in hours; run `upgrade`)",
        calendars: [...new Set<string>(((OTS.info(detached) as string).match(/https?:\/\/[^\s')]+/g) as string[] | null) ?? [])],
      },
      timingMs: { c2pa: msFirma, ots: msOts },
    };
    writeFileSync(`${salida}.provenance.json`, JSON.stringify(resumen, null, 2));
    console.log(JSON.stringify({ ...resumen, lineage: "(see provenance.json)" }, null, 2));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function verificar(fichero: string) {
  // c2patool refuses absolute Windows paths for trust anchors, so we run it from the key
  // folder and pass "ca.pem" relative.
  const r = c2patool([winPath(fichero), "trust", "--trust_anchors", "ca.pem"], CLAVES);
  if (!r.ok) {
    console.log("C2PA: no valid manifest", r.salida.trim().split("\n")[0]);
  } else {
    const informe = JSON.parse(r.salida);
    const activo = informe.manifests[informe.active_manifest];
    const codigos = new Set<string>();
    for (const grupo of Object.values(informe.validation_results?.activeManifest ?? {}) as Array<Array<{ code: string }>>) {
      for (const v of grupo) codigos.add(v.code);
    }
    for (const v of informe.validation_status ?? []) codigos.add(v.code);
    console.log("C2PA manifest:", informe.active_manifest);
    console.log("  signer:", activo.signature_info?.common_name, "issuer:", activo.signature_info?.issuer, "at", activo.signature_info?.time);
    console.log("  codes:", [...codigos].sort().join(" "));
    const consent = activo.assertions.find((a: { label: string }) => a.label === "cawg.training-mining");
    if (consent) console.log("  consent:", JSON.stringify(consent.data.entries));
    const lineage = activo.assertions.find((a: { label: string }) => a.label === "org.miuzika.lineage");
    if (lineage) console.log("  lineage: project", lineage.data.project?.slug, "tracks", lineage.data.tracks?.length, "stems", lineage.data.stems?.length);
  }
  const rutaOts = `${fichero}.ots`;
  if (!existsSync(rutaOts)) {
    console.log("OTS: no .ots proof next to the file");
    return;
  }
  const detachedOts = OTS.DetachedTimestampFile.deserialize(readFileSync(rutaOts));
  const detached = OTS.DetachedTimestampFile.fromBytes(new OTS.Ops.OpSHA256(), readFileSync(fichero));
  if (Buffer.from(detachedOts.fileDigest()).toString("hex") !== Buffer.from(detached.fileDigest()).toString("hex")) {
    console.log("OTS: the proof is for a DIFFERENT file (hash mismatch)");
    return;
  }
  const info: string = OTS.info(detachedOts);
  const pendiente = /PendingAttestation/.test(info);
  if (pendiente) {
    console.log("OTS: hash matches; attestation still pending at the calendars (run `upgrade` later)");
    return;
  }
  const resultado = await OTS.verify(detachedOts, detached, { ignoreBitcoinNode: true, timeout: 10000 });
  console.log("OTS:", resultado ? `anchored in Bitcoin ${JSON.stringify(resultado)}` : "could not verify against block explorers");
}

async function mejorar(rutaOts: string) {
  const detached = OTS.DetachedTimestampFile.deserialize(readFileSync(rutaOts));
  const cambiado = await OTS.upgrade(detached);
  if (cambiado) {
    writeFileSync(rutaOts, Buffer.from(detached.serializeToBytes()));
    console.log("upgraded:", OTS.info(detached).split("\n").filter((l: string) => /verify|Bitcoin/.test(l)).join(" | "));
  } else {
    console.log("not yet: the calendars have not anchored it in Bitcoin");
  }
}

const [orden, ...resto] = process.argv.slice(2);
const flags = new Set(resto.filter((a) => a.startsWith("--")));
const args = resto.filter((a) => !a.startsWith("--"));
try {
  if (orden === "sign" && args.length === 2) {
    const [slug, nombre] = args as [string, string];
    const entrada = existsSync(nombre) ? resolve(nombre) : join(RAIZ, "workspace", "proyectos", slug, "salida", nombre);
    await firmar(slug, entrada, { aiAssisted: flags.has("--ai-assisted"), allowTraining: flags.has("--allow-training") });
  } else if (orden === "verify" && args.length === 1) {
    await verificar(resolve(args[0]!));
  } else if (orden === "upgrade" && args.length === 1) {
    await mejorar(resolve(args[0]!));
  } else {
    console.log("usage: node sign.ts sign <slug> <file> [--ai-assisted] [--allow-training] | verify <file> | upgrade <file.ots>");
    process.exit(2);
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

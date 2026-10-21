#!/usr/bin/env node
/**
 * CLI de miuzika.
 *
 *   npm run compose -- "créame una canción synth pop 80's oscura en re menor, lenta"
 *   npm run compose -- --plan "..."
 *   npm run compose -- --llm "..."
 *   npm run compose -- --agent --project out/mi-cancion.json "sube el reverb del track 2"
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { Project } from "../core/types.ts";
import { createProject, projectStats } from "../core/project.ts";
import { projectDigest } from "../core/digest.ts";
import { applyOps } from "../core/ops.ts";
import { composePlan, presetPlan } from "../core/plan.ts";
import type { SongPlan } from "../core/plan.ts";
import { parsePrompt } from "../core/parse.ts";
import { projectToMidi } from "../core/midi.ts";import { canonicalPitchClass } from "../core/theory.ts";
import { composeFromPrompt, runAgent } from "../agent/agent.ts";
import { clientFromEnv, plannerClientFromEnv } from "../agent/client.ts";

const VALUE_FLAGS = new Set(["bars", "key", "bpm", "out", "seed", "name", "project", "model", "planner-model"]);

interface Args {
  prompt: string;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inline] = arg.slice(2).split("=", 2);
      if (!name) continue;
      if (inline !== undefined) {
        flags[name] = inline;
      } else if (VALUE_FLAGS.has(name) && argv[index + 1]) {
        flags[name] = argv[++index]!;
      } else {
        flags[name] = true;
      }
      continue;
    }
    positional.push(arg);
  }
  return { prompt: positional.join(" ").trim(), flags };
}

function numberFlag(value: string | boolean | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseKeyFlag(value: string): { tonic: string; mode: "major" | "minor" } | undefined {
  const match = /^([A-Ga-g](?:#|b)?)\s*(m|min|menor|minor|maj|mayor|major)?$/i.exec(value.trim());
  if (!match) return undefined;
  const tonic = canonicalPitchClass(match[1]!);
  const suffix = (match[2] ?? "").toLowerCase();
  const mode = suffix.startsWith("maj") || suffix === "mayor" ? "major" : "minor";
  return { tonic, mode };
}

function slug(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "miuzika"
  );
}

function loadEnv(): void {
  try {
    process.loadEnvFile(path.join(process.cwd(), ".env"));
  } catch {
    // .env opcional
  }
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}

function printProject(project: Project): void {
  const stats = projectStats(project);
  console.log(`\n${project.name}`);
  console.log(
    `  ${project.bpm} BPM · ${project.key.tonic} ${project.key.mode} · ${project.lengthBars} compases · ${formatDuration(
      stats.seconds,
    )}`,
  );
  console.log(`  ${stats.tracks} pistas · ${stats.clips} clips · ${stats.notes} notas`);
  for (const track of project.tracks) {
    const notes = track.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
    const fx = track.devices.map((device) => device.type).join(" → ") || "sin FX";
    console.log(
      `   · ${track.name.padEnd(14)} ${track.instrument.type.padEnd(9)} ${String(notes).padStart(5)} notas  ${fx}`,
    );
  }
}

async function writeOutputs(project: Project, plan: SongPlan | null, outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  const base = slug(project.name);
  const jsonPath = path.join(outDir, `${base}.json`);
  const midiPath = path.join(outDir, `${base}.mid`);
  await writeFile(jsonPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
  await writeFile(midiPath, Buffer.from(projectToMidi(project)));
  if (plan) await writeFile(path.join(outDir, `${base}.plan.json`), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  console.log(`\n  JSON  ${path.relative(process.cwd(), jsonPath)}`);
  console.log(`  MIDI  ${path.relative(process.cwd(), midiPath)}`);
}

function usage(): void {
  console.log(`miuzika (alpha)

  npm run compose -- "<petición en lenguaje natural>"

Opciones:
  --plan              Muestra el plan y no genera audio
  --offline           Usa el intérprete local sin LLM (tests/evaluación)
  --agent             Edita un proyecto existente con el bucle de herramientas
  --project <file>    Proyecto JSON de partida
  --out <dir>         Directorio de salida (por defecto: out)
  --name <texto>      Título de la canción
  --key <Dm|D menor>  Tonalidad
  --bpm <n>           Tempo
  --bars <n>          Duración en compases
  --seed <n>          Semilla (reproducibilidad)
  --model <id>        Modelo para esta llamada

El LLM es obligatorio. Configura OLLAMA_API_KEY en .env (ver .env.example).

Ejemplos:
  npm run compose -- "synth pop 80s oscuro en re menor, lenta"
  npm run compose -- "loop de bajo y batería estilo siniestro punk español"
  npm run compose -- --agent --project out/noche.json "sube el reverb del track 2"
`);
}

function buildOfflinePlan(prompt: string, flags: Record<string, string | boolean>): SongPlan {
  const parsed = parsePrompt(prompt);
  const keyFlag = stringFlag(flags.key);
  const key = keyFlag ? parseKeyFlag(keyFlag) : undefined;
  const bpm = numberFlag(flags.bpm);
  const bars = numberFlag(flags.bars);
  const name = stringFlag(flags["name"]);

  if (!key && !bpm && !bars && !name) {
    if (parsed.hints.length > 0) console.log(`  interpretación: ${parsed.hints.join(", ")}`);
    return parsed.plan;
  }
  const base = presetPlan(parsed.genre, {
    ...(key ? { key } : {}),
    ...(bpm ? { bpm } : {}),
    ...(bars ? { bars } : {}),
    ...(name ? { title: name } : {}),
  });
  return base;
}

async function main(): Promise<void> {
  loadEnv();
  const { prompt, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || !prompt) {
    usage();
    return;
  }

  const outDir = stringFlag(flags.out) ?? "out";
  const seed = numberFlag(flags.seed) ?? 1;
  const projectPath = stringFlag(flags.project);

  // --- Modo agente: editar un proyecto existente ---------------------------
  if (flags.agent) {
    const client = clientFromEnv(undefined, {
      ...(stringFlag(flags.model) ? { model: stringFlag(flags.model)! } : {}),
    });
    if (!client) {
      console.error("El modo --agent necesita OLLAMA_API_KEY (o un Ollama local en OLLAMA_BASE_URL).");
      process.exitCode = 1;
      return;
    }
    const base = projectPath
      ? (JSON.parse(await readFile(projectPath, "utf8")) as Project)
      : createProject({ prompt, seed });
    console.log(`\n  Proyecto: ${base.name} · ${base.tracks.length} pistas`);
    const result = await runAgent({ client, project: base, prompt });
    if (result.toolLog.length === 0) console.log("  (el modelo no ha usado herramientas)");
    for (const entry of result.toolLog) {
      console.log(`  ${entry.ok ? "✓" : "✗"} ${entry.name}`);
    }
    console.log(`\n${result.finalText}`);
    await writeOutputs(result.project, null, outDir);
    printProject(result.project);
    if (result.usage.promptTokens > 0) {
      console.log(
        `\n  tokens: ${result.usage.promptTokens} entrada / ${result.usage.completionTokens} salida · ${result.steps} pasos`,
      );
    }
    return;
  }

  // --- Composición ---------------------------------------------------------
  let plan: SongPlan;
  let project: Project;
  let opCount = 0;

  if (flags.offline) {
    plan = buildOfflinePlan(prompt, flags);
    if (flags.plan) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    const ops = composePlan(plan);
    opCount = ops.length;
    const applied = applyOps(createProject({ prompt, seed }), ops);
    project = applied.project;
    for (const warning of applied.warnings.slice(0, 5)) {
      console.warn(`  aviso: ${warning.path}: ${warning.message}`);
    }
  } else {
    const planner = plannerClientFromEnv(undefined, {
      ...(stringFlag(flags.model) ? { model: stringFlag(flags.model)! } : {}),
    });
    if (!planner) {
      console.error(
        "Falta OLLAMA_API_KEY. Copia .env.example a .env y pon tu clave de Ollama Cloud.\n" +
          "Para usar el intérprete local sin LLM: --offline",
      );
      process.exitCode = 1;
      return;
    }
    const composed = await composeFromPrompt({
      planner,
      prompt,
      project: createProject({ prompt, seed }),
      apply: !flags.plan,
    });
    plan = composed.plan;
    project = composed.project;
    opCount = composed.ops.length;
    console.log(`  planificado con ${planner.model} (${opCount} ops)`);
    if (flags.plan) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
  }

  if (stringFlag(flags.name)) project.name = stringFlag(flags.name)!;

  console.log(`\n  ${plan.sections.map((section) => `${section.name}:${section.bars}`).join(" · ")}`);
  console.log(`  ${opCount} operaciones aplicadas`);
  console.log(`\n${projectDigest(project, { maxChars: 1200 })}`);
  printProject(project);
  await writeOutputs(project, plan, outDir);
}

main().catch((error) => {
  console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

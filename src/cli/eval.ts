#!/usr/bin/env node
/**
 * Harness de evaluación offline.
 *
 * Mide lo único que importa: ¿el pipeline produce proyectos válidos, con la
 * tonalidad, duración y textura que pide el prompt? Sin LLM, así es barato y
 * reproducible. El LLM se evalúa con las mismas comprobaciones.
 */

import process from "node:process";
import type { Genre } from "../core/plan.ts";
import { composePlan } from "../core/plan.ts";
import { parsePrompt } from "../core/parse.ts";
import { applyOps } from "../core/ops.ts";
import { createProject, projectStats, validateProject } from "../core/project.ts";
import type { Project } from "../core/types.ts";
import { projectToMidi } from "../core/midi.ts";

interface Case {
  prompt: string;
  expect: {
    genre?: Genre;
    tonic?: string;
    mode?: string;
    minTracks?: number;
    maxTracks?: number;
    minBars?: number;
    maxBars?: number;
    noDrums?: boolean;
    requireDistortion?: boolean;
  };
}

const CASES: Case[] = [
  {
    prompt: "créame una canción synth pop 80's oscura en re menor, lenta",
    expect: { genre: "synthpop80s", tonic: "D", mode: "minor", minTracks: 4, minBars: 24 },
  },
  {
    prompt: "loop de bajo y batería estilo siniestro punk español",
    expect: { genre: "siniestroPunk", minTracks: 2, maxTracks: 2, maxBars: 8 },
  },
  {
    prompt: "techno hipnótico en la menor a 132 bpm, 32 compases",
    expect: { genre: "techno", tonic: "A", mode: "minor", minBars: 32, maxBars: 32 },
  },
  {
    prompt: "ambient melancólico para estudiar, sin batería",
    expect: { genre: "ambient", noDrums: true, minTracks: 2 },
  },
  {
    prompt: "rock en mi menor con guitarras distorsionadas",
    expect: { genre: "rock", tonic: "E", mode: "minor", requireDistortion: true },
  },
  {
    prompt: "hip hop con swing en fa menor",
    expect: { genre: "hiphop", tonic: "F", mode: "minor" },
  },
  {
    prompt: "canción de 16 compases en do mayor, alegre",
    expect: { tonic: "C", mode: "major", minBars: 16, maxBars: 16 },
  },
  {
    prompt: "synthpop con más reverb y pads",
    expect: { genre: "synthpop80s", minTracks: 3 },
  },
];

interface Outcome {
  prompt: string;
  ok: boolean;
  stats: ReturnType<typeof projectStats>;
  problems: string[];
  ms: number;
}

function check(testCase: Case, project: Project): string[] {
  const problems: string[] = [];
  const stats = projectStats(project);
  const issues = validateProject(project).filter((issue) => issue.severity === "error");
  if (issues.length > 0) problems.push(`validación: ${issues[0]!.message}`);
  if (stats.notes === 0) problems.push("sin notas");
  if (stats.tracks === 0) problems.push("sin pistas");
  for (const track of project.tracks) {
    const notes = track.clips.reduce((sum, clip) => sum + clip.notes.length, 0);
    if (notes === 0) problems.push(`pista vacía: ${track.name}`);
    for (const clip of track.clips) {
      for (const note of clip.notes) {
        if (note.pitch < 0 || note.pitch > 127) problems.push(`pitch fuera de rango en ${track.name}`);
        if (!(note.duration > 0)) problems.push(`duración inválida en ${track.name}`);
      }
    }
  }

  // El MIDI debe generarse y tener cabecera válida.
  const midi = projectToMidi(project);
  const header = String.fromCharCode(...midi.slice(0, 4));
  if (header !== "MThd") problems.push("MIDI inválido");

  const { expect } = testCase;
  if (expect.genre && parsePrompt(testCase.prompt).genre !== expect.genre) {
    problems.push(`género esperado ${expect.genre}`);
  }
  if (expect.tonic && project.key.tonic !== expect.tonic) problems.push(`tónica ${project.key.tonic} != ${expect.tonic}`);
  if (expect.mode && project.key.mode !== expect.mode) problems.push(`modo ${project.key.mode} != ${expect.mode}`);
  if (expect.minTracks && stats.tracks < expect.minTracks) problems.push(`${stats.tracks} pistas < ${expect.minTracks}`);
  if (expect.maxTracks && stats.tracks > expect.maxTracks) problems.push(`${stats.tracks} pistas > ${expect.maxTracks}`);
  if (expect.minBars && project.lengthBars < expect.minBars) problems.push(`${project.lengthBars} c < ${expect.minBars}`);
  if (expect.maxBars && project.lengthBars > expect.maxBars) problems.push(`${project.lengthBars} c > ${expect.maxBars}`);
  if (expect.noDrums && project.tracks.some((track) => track.instrument.type === "drumkit")) {
    problems.push("contiene batería");
  }
  if (expect.requireDistortion) {
    const hasDistortion = project.tracks.some((track) => track.devices.some((device) => device.type === "distortion"));
    if (!hasDistortion) problems.push("sin distorsión");
  }
  return [...new Set(problems)];
}

function run(testCase: Case): Outcome {
  const started = performance.now();
  const parsed = parsePrompt(testCase.prompt);
  const ops = composePlan(parsed.plan);
  const applied = applyOps(createProject({ prompt: testCase.prompt, seed: 7 }), ops);
  const project = applied.project;
  const problems = check(testCase, project);
  return {
    prompt: testCase.prompt,
    ok: problems.length === 0,
    stats: projectStats(project),
    problems,
    ms: Math.round(performance.now() - started),
  };
}

const outcomes = CASES.map(run);
const passed = outcomes.filter((outcome) => outcome.ok).length;

console.log("\nEVAL OFFLINE · pipeline prompt → plan → ops → proyecto\n");
for (const outcome of outcomes) {
  console.log(`${outcome.ok ? "PASS" : "FAIL"}  ${outcome.prompt}`);
  console.log(
    `      ${outcome.stats.tracks}p · ${outcome.stats.clips} clips · ${outcome.stats.notes} notas · ${
      outcome.stats.bars
    }c · ${outcome.ms} ms`,
  );
  for (const problem of outcome.problems) console.log(`      ! ${problem}`);
}
console.log(`\n${passed}/${outcomes.length} casos correctos\n`);
if (passed !== outcomes.length) process.exitCode = 1;

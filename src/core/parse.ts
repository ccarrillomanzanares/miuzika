/**
 * Intérprete offline de prompts (sin LLM).
 *
 * No pretende competir con el modelo: es la red de seguridad, el baseline de
 * evaluación y lo que permite usar el pipeline sin API key.
 */

import type { Genre, SongPlan, TrackPlan } from "./plan.ts";
import { loopPlan, presetPlan } from "./plan.ts";
import type { Mode, KeySignature } from "./types.ts";
import type { Role } from "./patterns.ts";
import { canonicalPitchClass, normalizeKey } from "./theory.ts";

const SOLFEGE: Record<string, string> = {
  do: "C",
  re: "D",
  mi: "E",
  fa: "F",
  sol: "G",
  la: "A",
  si: "B",
};

const MODE_WORDS: Record<string, Mode> = {
  menor: "minor",
  minor: "minor",
  min: "minor",
  mayor: "major",
  major: "major",
  maj: "major",
  dorico: "dorian",
  dorio: "dorian",
  dorian: "dorian",
  frigio: "phrygian",
  phrygian: "phrygian",
  lidio: "lydian",
  lydian: "lydian",
  mixolidio: "mixolydian",
  mixolydian: "mixolydian",
};

const GENRE_HINTS: ReadonlyArray<readonly [Genre, RegExp]> = [
  ["siniestroPunk", /siniestro|punk|post-?punk|gotic|gótic|afterpunk/],
  ["techno", /techno|house|electronica|electrónica|rave|club/],
  ["hiphop", /hip ?hop|rap\b|trap\b/],
  ["ambient", /ambient|drone|relax|meditativ/],
  ["rock", /rock|metal|grunge|stoner/],
  ["synthpop80s", /synth|sintetiz|ochent|80'?s|80\b|new ?wave/],
];

const ROLE_HINTS: ReadonlyArray<readonly [Role, RegExp]> = [
  ["drums", /bateri|drum|percusi/],
  ["bass", /bajo|bass|sub/],
  ["chords", /acorde|guitarra|chord|teclado|rhodes/],
  ["lead", /lead|melodia|melodía|voz|solo/],
  ["arp", /arp|arpegi/],
  ["pad", /pad\b|colchon|colchón|ambiente/],
];

export interface ParsedPrompt {
  plan: SongPlan;
  genre: Genre;
  hints: string[];
  /** true si el prompt fijaba tonalidad explícitamente. */
  explicitKey: boolean;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchGenre(text: string): Genre | null {
  for (const [genre, pattern] of GENRE_HINTS) {
    if (pattern.test(text)) return genre;
  }
  return null;
}

function detectGenre(text: string): Genre {
  return matchGenre(text) ?? "synthpop80s";
}

function letterOf(token: string): string {
  const lower = token.toLowerCase();
  return SOLFEGE[lower] ?? lower.toUpperCase();
}

function detectKey(text: string): { key: KeySignature; explicit: boolean; explicitMode: boolean } | null {
  const note = "(do|re|mi|fa|sol|la|si|[a-g])";
  const modeWord = "(menor|mayor|minor|major|min|maj|dorico|dorio|dorian|frigio|phrygian|lidio|lydian|mixolidio|mixolydian)";

  const patterns = [
    new RegExp(`(?:en|in|de|tonalidad de)\\s+${note}\\s*(#|b)?\\s*${modeWord}`),
    new RegExp(`\\b${note}\\s*(#|b)?\\s+${modeWord}\\b`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      const tonic = `${letterOf(match[1]!)}${match[2] ?? ""}`;
      const mode = MODE_WORDS[match[3]!] ?? "minor";
      try {
        return { key: normalizeKey({ tonic, mode }), explicit: true, explicitMode: true };
      } catch {
        return null;
      }
    }
  }

  // "Dm", "F#m", "Bbm"
  const shorthand = /\b([a-g])(#|b)?m\b/i.exec(text);
  if (shorthand) {
    try {
      return {
        key: normalizeKey({ tonic: `${shorthand[1]!.toUpperCase()}${shorthand[2] ?? ""}`, mode: "minor" }),
        explicit: true,
        explicitMode: false,
      };
    } catch {
      return null;
    }
  }
  return null;
}

interface TempoDetection {
  bpm: number;
  explicit: boolean;
  range?: [number, number];
  hint?: string;
}

function detectBpm(text: string, base: number): TempoDetection {
  const explicit = /(\d{2,3})\s*(?:bpm|pulsaciones|ppm)/.exec(text);
  if (explicit) {
    const bpm = Number(explicit[1]);
    if (bpm >= 20 && bpm <= 300) return { bpm, explicit: true, hint: `${bpm} BPM` };
  }
  if (/muy lent|very slow/.test(text)) {
    return {
      bpm: Math.round(base * 0.72),
      explicit: false,
      range: [Math.round(base * 0.65), Math.round(base * 0.82)],
      hint: "tempo muy lento",
    };
  }
  if (/lent[oa]|slow|balad/.test(text)) {
    return {
      bpm: Math.round(base * 0.85),
      explicit: false,
      range: [Math.round(base * 0.78), Math.round(base * 0.95)],
      hint: "tempo lento",
    };
  }
  if (/rapid|fast|acelerad|veloz/.test(text)) {
    return {
      bpm: Math.round(base * 1.15),
      explicit: false,
      range: [Math.round(base * 1.05), Math.round(base * 1.3)],
      hint: "tempo rápido",
    };
  }
  if (/media|moderad|mid/.test(text)) {
    return {
      bpm: base,
      explicit: false,
      range: [Math.round(base * 0.92), Math.round(base * 1.08)],
      hint: "tempo medio",
    };
  }
  return { bpm: base, explicit: false };
}

function detectBars(text: string): number | null {
  const match = /(\d{1,3})\s*(?:compases|compas|bars?|c\b)/.exec(text);
  if (!match) return null;
  const bars = Number(match[1]);
  return bars >= 1 && bars <= 256 ? bars : null;
}

function isLoopIntent(text: string): boolean {
  return (
    /\b(?:loop|bucle)\b/.test(text) &&
    !/\b(?:no|sin)\s+(?:un\s+)?(?:loop|bucle)\b/.test(text)
  );
}

function detectRoles(text: string): Role[] {
  const roles: Role[] = [];
  for (const [role, pattern] of ROLE_HINTS) {
    if (pattern.test(text)) roles.push(role);
  }
  return roles;
}

function addDeviceIfMissing(track: TrackPlan, type: TrackPlan["devices"][number]["type"], params: Record<string, number>) {
  if (track.devices.some((device) => device.type === type)) {
    const existing = track.devices.find((device) => device.type === type)!;
    existing.params = { ...existing.params, ...params };
    return;
  }
  track.devices.push({ type, params });
}

/** Ajustes cualitativos que no cambian la estructura. */
function applyTimbreHints(plan: SongPlan, text: string, hints: string[]): SongPlan {
  const tracks = plan.tracks.map((track) => ({
    ...track,
    devices: track.devices.map((device) => ({ ...device, params: device.params ? { ...device.params } : undefined })),
  }));

  if (/distorsion|distorted|sucio|crudo|overdrive|fuzz/.test(text)) {
    for (const track of tracks) {
      if (track.role === "bass" || track.role === "chords" || track.role === "lead") {
        addDeviceIfMissing(track, "distortion", { drive: 0.58, mix: 0.55, tone: 0.55 });
      }
    }
    hints.push("más distorsión en bajo/guitarra");
  }

  if (/reverb|reverber|espacial|cavern/.test(text)) {
    for (const track of tracks) {
      if (track.role === "lead" || track.role === "pad" || track.role === "chords") {
        addDeviceIfMissing(track, "reverb", { wet: 0.5, decay: 0.75 });
      }
    }
    hints.push("más reverb en pads y melodías");
  }

  if (/sin bateria|sin batería|no drums|solo pads|solo sintetizadores/.test(text)) {
    hints.push("sin batería");
    return {
      ...plan,
      tracks: tracks.filter((track) => track.role !== "drums"),
      sections: plan.sections.map((section) => ({
        ...section,
        roles: section.roles.filter((role) => role !== "drums"),
      })).filter((section) => section.roles.length > 0),
    };
  }

  return { ...plan, tracks };
}

export interface PromptConstraints {
  genre?: Genre;
  key?: KeySignature;
  bpm?: number;
  bpmRange?: [number, number];
  bars?: number;
  minor?: boolean;
  major?: boolean;
  noDrums?: boolean;
  loop?: boolean;
  roles?: Role[];
}

/**
 * Restricciones duras extraídas del prompt. El LLM decide la música; esto
 * garantiza que no ignore lo que el usuario ha pedido explícitamente.
 */
export function extractConstraints(prompt: string): PromptConstraints {
  const text = normalize(prompt);
  const matchedGenre = matchGenre(text);
  const genre = matchedGenre ?? "synthpop80s";
  const base = presetPlan(genre).bpm;
  const detected = detectKey(text);
  const tempo = detectBpm(text, base);
  const bars = detectBars(text);
  const roles = detectRoles(text);
  const constraints: PromptConstraints = {};
  if (matchedGenre) constraints.genre = matchedGenre;

  if (detected) {
    constraints.key = detected.key;
  } else if (/oscur|dark|triste|melancol|sombri|siniestr/.test(text)) {
    constraints.minor = true;
  } else if (/alegre|bright|feliz|radiante|luminos/.test(text)) {
    constraints.major = true;
  }

  if (tempo.explicit) constraints.bpm = tempo.bpm;
  else if (tempo.range) constraints.bpmRange = tempo.range;

  if (bars) constraints.bars = bars;
  if (/sin bateria|no drums|sin percusion/.test(text)) constraints.noDrums = true;

  if (isLoopIntent(text)) {
    constraints.loop = true;
    if (roles.length > 0) constraints.roles = roles;
    constraints.bars = Math.min(bars ?? 4, 64);
  }

  return constraints;
}

export function describeConstraints(constraints: PromptConstraints): string {
  const lines: string[] = [];
  if (constraints.genre) lines.push(`género: ${constraints.genre}`);
  if (constraints.key) lines.push(`tonalidad: ${constraints.key.tonic} ${constraints.key.mode}`);
  if (constraints.bpm !== undefined) lines.push(`tempo exacto: ${constraints.bpm} BPM`);
  else if (constraints.bpmRange) lines.push(`tempo: entre ${constraints.bpmRange[0]} y ${constraints.bpmRange[1]} BPM`);
  if (constraints.bars !== undefined) lines.push(`duración exacta: ${constraints.bars} compases`);
  if (constraints.minor) lines.push("modo menor");
  if (constraints.major) lines.push("modo mayor");
  if (constraints.noDrums) lines.push("sin pistas de batería");
  if (constraints.loop) lines.push(`loop: una sola sección de ${constraints.bars} compases`);
  if (constraints.roles) lines.push(`solo estos roles: ${constraints.roles.join(", ")}`);
  return lines.map((line) => `- ${line}`).join("\n");
}

export function checkConstraints(plan: SongPlan, constraints: PromptConstraints): string[] {
  const issues: string[] = [];
  const totalBars = plan.sections.reduce((sum, section) => sum + section.bars, 0);

  if (constraints.genre && plan.genre !== constraints.genre) {
    issues.push(`El género debe ser "${constraints.genre}" (recibido "${plan.genre}")`);
  }
  if (constraints.key) {
    const sameTonic = canonicalPitchClass(plan.key.tonic) === canonicalPitchClass(constraints.key.tonic);
    if (!sameTonic || plan.key.mode !== constraints.key.mode) {
      issues.push(
        `La tonalidad debe ser ${constraints.key.tonic} ${constraints.key.mode} (recibido ${plan.key.tonic} ${plan.key.mode})`,
      );
    }
  }
  if (constraints.bpm !== undefined && plan.bpm !== constraints.bpm) {
    issues.push(`El tempo debe ser ${constraints.bpm} BPM (recibido ${plan.bpm})`);
  }
  if (constraints.bpmRange) {
    const [min, max] = constraints.bpmRange;
    if (plan.bpm < min || plan.bpm > max) {
      issues.push(`El tempo debe estar entre ${min} y ${max} BPM (recibido ${plan.bpm})`);
    }
  }
  if (constraints.bars !== undefined && totalBars !== constraints.bars) {
    issues.push(`Debe durar ${constraints.bars} compases (recibido ${totalBars})`);
  }
  if (constraints.minor && !["minor", "harmonicMinor", "phrygian"].includes(plan.key.mode)) {
    issues.push(`El modo debe ser menor (recibido ${plan.key.mode})`);
  }
  if (constraints.major && !["major", "lydian", "mixolydian"].includes(plan.key.mode)) {
    issues.push(`El modo debe ser mayor (recibido ${plan.key.mode})`);
  }
  if (constraints.noDrums && plan.tracks.some((track) => track.role === "drums")) {
    issues.push("No debe haber pistas de batería");
  }
  if (constraints.loop) {
    if (plan.sections.length !== 1) {
      issues.push(`Un loop debe tener una sola sección (recibido ${plan.sections.length})`);
    }
    if (totalBars > 64) issues.push(`Un loop no debe superar 64 compases (recibido ${totalBars})`);
  }
  if (constraints.roles) {
    const planRoles = new Set(plan.tracks.map((track) => track.role));
    const missing = constraints.roles.filter((role) => !planRoles.has(role));
    const extra = [...planRoles].filter((role) => !constraints.roles!.includes(role));
    if (missing.length > 0) issues.push(`Faltan pistas para: ${missing.join(", ")}`);
    if (extra.length > 0) issues.push(`Sobran pistas: ${extra.join(", ")}`);
  }

  return issues;
}

export function parsePrompt(prompt: string): ParsedPrompt {
  const text = normalize(prompt);
  const genre = detectGenre(text);
  const hints: string[] = [];

  const detected = detectKey(text);
  const basePlan = presetPlan(genre);
  const dark = /oscur|dark|triste|melancol|sombri|siniestr/.test(text);
  const bright = /alegre|bright|feliz|radiante|luminos/.test(text);

  let key = detected?.key ?? basePlan.key;
  if (!detected) {
    if (dark && key.mode !== "minor" && key.mode !== "harmonicMinor") {
      key = normalizeKey({ tonic: key.tonic, mode: "minor" });
      hints.push("modo menor por 'oscura'");
    }
    if (bright && key.mode === "minor") {
      key = normalizeKey({ tonic: key.tonic, mode: "major" });
      hints.push("modo mayor por 'alegre'");
    }
  } else {
    hints.push(`tonalidad ${key.tonic} ${key.mode}`);
  }

  const tempo = detectBpm(text, basePlan.bpm);
  if (tempo.hint) hints.push(tempo.hint);

  const bars = detectBars(text);
  const isLoop = isLoopIntent(text);
  const roles = detectRoles(text);

  let plan: SongPlan;
  if (isLoop) {
    const loopBars = Math.min(bars ?? 4, 16);
    plan = loopPlan(genre, roles.length > 0 ? roles : ["drums", "bass"], loopBars, {
      key,
      bpm: tempo.bpm,
      title: `Loop ${roles.length > 0 ? roles.join(" + ") : "drums + bass"}`,
    });
    hints.push(`loop de ${loopBars} compases`);
  } else {
    plan = presetPlan(genre, { key, bpm: tempo.bpm, ...(bars ? { bars } : {}) });
    if (bars) hints.push(`${bars} compases`);
  }

  plan = applyTimbreHints(plan, text, hints);

  return {
    plan,
    genre,
    hints,
    explicitKey: detected?.explicit ?? false,
  };
}

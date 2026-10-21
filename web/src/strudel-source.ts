/** Utilidades de código Strudel compartidas por el render a WAV. */

/** Quita métodos visuales del REPL que no existen en el motor de audio. */
export function stripVisualMethods(code: string): string {
  return code.replace(
    /\.?_(punchcard|scope|spiral|pianoroll|wordfall|spectrum|pitchwheel)\s*\([^)]*\)/g,
    "",
  );
}

/** El REPL convierte `$: patrón` en bloques; aquí los unimos en un `stack`. */
export function expandLabeledPatterns(code: string): string {
  const lines = code.split(/\r?\n/);
  const blocks: string[] = [];
  const preamble: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    const label = line.match(/^\s*\$:\s?(.*)$/);
    if (label) {
      if (current) blocks.push(current.join("\n").trim());
      current = [label[1] ?? ""];
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) blocks.push(current.join("\n").trim());
  if (blocks.length === 0) return code;
  const intro = preamble.join("\n").trim();
  const body = blocks
    .filter((block) => block.length > 0)
    .map((block) => `  (${block})`)
    .join(",\n");
  return `${intro ? `${intro}\n` : ""}stack(\n${body}\n)`;
}

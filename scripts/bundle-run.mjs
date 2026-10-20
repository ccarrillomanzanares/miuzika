/**
 * Ejecuta un entry de TypeScript con esbuild (necesario para el SDK de openDAW,
 * que usa imports sin extensión y no carga con el resolver ESM de Node).
 *
 *   node scripts/bundle-run.mjs <entry.ts> <out.mjs> [args...]
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const [entry, outfile, ...args] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error("uso: node scripts/bundle-run.mjs <entry.ts> <out.mjs> [args...]");
  process.exit(1);
}

const target = resolve(outfile);
mkdirSync(dirname(target), { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  outfile: target,
  logLevel: "warning",
  sourcemap: false,
});

process.argv = [process.argv[0], target, ...args];
await import(`${pathToFileURL(target).href}?t=${Date.now()}`);

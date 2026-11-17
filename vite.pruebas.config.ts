/**
 * The second server, for tests: `npx vite --config vite.pruebas.config.ts` (port 5181).
 *
 * Its own dependency cache, because two Vite servers on the same `node_modules/.vite` rewrite each other's
 * pre-bundled modules. Bug 49 (15-Nov): a test server started on 5181 re-optimized the shared cache at 09:58:53,
 * and the app on 5180, loading the engine that same second, asked for the previous build of
 * `@opendaw_studio-adapters.js` and failed with "Could not start the openDAW engine: Failed to fetch dynamically
 * imported module" until the tab was reloaded.
 */

import { resolve } from "node:path";
import { mergeConfig } from "vite";
import base from "./vite.config.ts";

export default mergeConfig(base, {
  cacheDir: resolve(process.cwd(), "tmp", "vite-pruebas"),
  server: { port: 5181, strictPort: true },
});

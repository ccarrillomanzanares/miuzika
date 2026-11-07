/**
 * Minimal shims to be able to build openDAW projects in Node.
 * Nothing is touched in the browser.
 */

export function installNodeShims(): void {
  const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (!isNode) return;
  const g = globalThis as Record<string, unknown>;

  if (typeof g.AudioWorkletNode === "undefined") g.AudioWorkletNode = class {};
  if (typeof g.AudioWorklet === "undefined") g.AudioWorklet = class {};
  if (typeof g.AudioContext === "undefined") g.AudioContext = class {};
  if (typeof g.OfflineAudioContext === "undefined") g.OfflineAudioContext = class {};
  if (typeof g.document === "undefined") {
    g.document = { createElement: () => ({}), body: {}, documentElement: {} };
  }
  if (typeof g.window === "undefined") g.window = globalThis;
  if (typeof g.localStorage === "undefined") {
    g.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
  if (!g.navigator) g.navigator = { userAgent: "node" };
}

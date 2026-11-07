import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ACESTEP_CONOCIDA, avisoDeToma, avisoDeVersion } from "./version.ts";

const OTRO = "0123456789abcdef0123456789abcdef01234567";

test("nobody has answered yet: nothing to say", () => {
  assert.equal(avisoDeVersion(null), null);
});

test("same commit upstream: no change", () => {
  const a = avisoDeVersion({ commit: ACESTEP_CONOCIDA, fecha: "2026-08-29T08:25:18Z" });
  assert.equal(a?.cambio, false);
  assert.match(a?.texto ?? "", /ca1e85f: no change/);
});

test("another commit upstream: it says so, with both versions and the date", () => {
  const a = avisoDeVersion({ commit: OTRO, fecha: "2026-12-01T10:00:00Z" });
  assert.equal(a?.cambio, true);
  assert.match(a?.texto ?? "", /0123456.*2026-12-01.*ca1e85f/);
});

test("a failed check is not reported as no change", () => {
  const a = avisoDeVersion({ error: "HTTP 403" });
  assert.equal(a?.cambio, false);
  assert.match(a?.texto ?? "", /Could not check.*HTTP 403/);
  assert.doesNotMatch(a?.texto ?? "", /no change/);
});

test("a take with the short form of the known commit: silent", () => {
  assert.equal(avisoDeToma("x", "ca1e85f"), null);
});

test("a take made with another commit: it says so", () => {
  assert.match(avisoDeToma("x", "0123456") ?? "", /“x” was made with version 0123456, not the pinned ca1e85f/);
});

test("the script installs the same commit the tell-tale compares with", () => {
  const script = readFileSync(new URL("../../../workspace/gpu/generar_audio.py", import.meta.url), "utf8");
  assert.equal(/^REPO_COMMIT = "([0-9a-f]{40})"$/m.exec(script)?.[1], ACESTEP_CONOCIDA);
});

test("a take whose version cannot be read is not taken for the known one", () => {
  for (const commit of ["unknown", "", null, undefined, 7]) {
    assert.match(avisoDeToma("x", commit) ?? "", /could not be read/);
  }
});

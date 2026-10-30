# Third parties

## openDAW

- Web: https://opendaw.org
- Source: https://github.com/andremichelle/openDAW
- License: AGPL-3.0-or-later **or** commercial license (dual)
- Copyright © 2025 André Michelle

miuzika is intended as a combined work with openDAW. In public deployments (SaaS)
this means publishing the source under AGPL-3.0, as required by section 13. The
openDAW commercial license excludes some third-party components (CTAGDRC compressor,
Tone3000, TempoCNN); see `docs/OPENDAW.md`.

## Strudel / superdough

- Web: https://strudel.cc
- Source: https://codeberg.org/uzu/strudel
- License: AGPL-3.0-or-later
- Packages: `@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/tonal`,
  `@strudel/webaudio`, `@strudel/soundfonts`, `superdough`.
- Audio rendering downloads sample maps from `strudel.b-cdn.net` and soundfonts from
  `webaudiofontdata`. Each pack/soundfont keeps the license of its source project;
  check attribution before redistributing a build with those assets bundled.
- Default packs used by the renderer: Uzu drumkit, Tidal drum machines and VCSL
  (VCSL is distributed as CC0; check the other packs before bundling them).

## Audio generation models (not integrated)

Any audio-generation model integrated into the product must pass a license allowlist.
References verified during design:

- ACE-Step — Apache-2.0 / MIT depending on the checkpoint
- Demucs — MIT
- Stable Audio Open / Stable Audio 3 — Stability AI Community License (revenue
  cap of $1M/year, registration and attribution)
- MusicGen — CC-BY-NC (the restriction applies to the output; not suitable for
  commercial use)

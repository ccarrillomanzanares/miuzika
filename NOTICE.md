# Third parties

## openDAW

- Web: https://opendaw.org
- Source: https://github.com/andremichelle/openDAW
- License: AGPL-3.0-or-later **or** commercial license (dual)
- Copyright © 2025 André Michelle

miuzika is intended as a combined work with openDAW. In public deployments (SaaS)
this means publishing the source under AGPL-3.0, as required by section 13. The
openDAW commercial license excludes some third-party components (CTAGDRC compressor,
Tone3000, TempoCNN).

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

## GeneralUser GS (General MIDI SoundFont)

- Source: https://github.com/mrbumpy409/GeneralUser-GS (S. Christian Collins)
- License: GeneralUser GS License v2.0, free use for music creation, private or commercial;
  full text in `workspace/catalogo/gm/GeneralUser-GS-LICENSE.txt`.
- The `.sf2` itself is not in the repository: it is downloaded into `workspace/catalogo/gm/`.

## Models and tools the modules run

They are not part of this repository: each module installs them on the rented GPU (or, for
Basic Pitch, on this computer) at a pinned version, and each take's lineage records what ran.
The project is experimental, so non-commercial models are allowed **with a notice before Run**;
if miuzika ever becomes a paid service, these modules are reviewed.

| Module | Upstream | Pinned | License |
|---|---|---|---|
| ACE-Step | https://github.com/ace-step/ACE-Step-1.5 | `ca1e85f` | MIT (code and weights) |
| Stable Audio | https://github.com/Stability-AI/stable-audio-3 | `790793b` | Code MIT; weights Stability AI Community License (free under US$1M annual revenue, commercial use asks for registration; outputs belong to the user; gated on Hugging Face) and the Gemma Terms for its text encoder |
| MuLaCover | https://github.com/HeartMuLa/MuLaCover | `e27fa7f` | **CC BY-NC 4.0**: weights and outputs non-commercial |
| Demucs | https://github.com/facebookresearch/demucs | 4.0.1 | MIT |
| To MIDI | https://github.com/spotify/basic-pitch | 0.4.0 | Apache-2.0 |

A take made from a third-party recording keeps that recording's rights, whatever the model's
license.

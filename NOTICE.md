# Terceros

## openDAW

- Web: https://opendaw.org
- Código: https://github.com/andremichelle/openDAW
- Licencia: AGPL-3.0-or-later **o** licencia comercial (dual)
- Copyright © 2025 André Michelle

miuzika se plantea como un trabajo combinado con openDAW. En despliegues públicos
(SaaS) esto implica publicar el código bajo AGPL-3.0, tal como exige la sección 13.
La licencia comercial de openDAW excluye algunos componentes de terceros
(compresor CTAGDRC, Tone3000, TempoCNN); ver `docs/OPENDAW.md`.

## Strudel / superdough

- Web: https://strudel.cc
- Código: https://codeberg.org/uzu/strudel
- Licencia: AGPL-3.0-or-later
- Paquetes: `@strudel/core`, `@strudel/mini`, `@strudel/transpiler`, `@strudel/tonal`,
  `@strudel/webaudio`, `@strudel/soundfonts`, `superdough`.
- El render de audio descarga sample maps de `strudel.b-cdn.net` y soundfonts de
  `webaudiofontdata`. Las licencias de cada pack/soundfont son las de su proyecto de origen;
  revisa la atribución antes de redistribuir un build con esos assets empaquetados.
- Packs usados por defecto en el render: Uzu drumkit, Tidal drum machines y VCSL
  (VCSL se distribuye como CC0; comprueba el resto de packs antes de empaquetarlos).

## Modelos de generación de audio (no integrados)

Cualquier modelo de generación de audio que se integre debe pasar por una allowlist
de licencias. Referencias verificadas durante el diseño:

- ACE-Step — Apache-2.0 / MIT según checkpoint
- Demucs — MIT
- Stable Audio Open / Stable Audio 3 — Stability AI Community License (límite de
  1 M$ de ingresos anuales, registro y atribución)
- MusicGen — CC-BY-NC (la restricción se aplica a la salida; no apto para uso comercial)

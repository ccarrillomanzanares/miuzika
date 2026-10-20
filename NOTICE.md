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

## Modelos y datos (fase de audio, no implementada)

Cualquier modelo de generación de audio que se integre debe pasar por una allowlist
de licencias. Referencias verificadas durante el diseño:

- ACE-Step — Apache-2.0 / MIT según checkpoint
- Demucs — MIT
- Stable Audio Open / Stable Audio 3 — Stability AI Community License (límite de
  1 M$ de ingresos anuales, registro y atribución)
- MusicGen — CC-BY-NC (la restricción se aplica a la salida; no apto para uso comercial)

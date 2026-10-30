# Pilot 1 — Perceptual scoring with CLAP

Date: 2026-10-23. Machine: Lambda `gpu_1x_a10` (24 GB, us-east-1, $1.29/h) →
`21f9c4ba5a194aa387e42df18e3352bf`, IP 129.80.188.34.

## What is measured

Cosine similarity between the audio embedding (CLAP) and that of a text
description. Model: `laion/larger_clap_music_and_speech`, **Apache-2.0** (verified in
the HuggingFace card on 2026-10-23), so it is suitable for commercial use.

It does not measure musical quality: it measures **whether the audio resembles what you asked for**.

## Material

90 s excerpts, mono, 48 kHz, from the center of each track (our own audio, no
third-party material):

- `sacramento.wav` — render of the numpy engine (140 bars, 90 BPM).
- `religion.wav` — earlier render (`religion_de_maquina_92bpm_Dm.wav`).

## Result

| Audio | industrial/claustrofóbico | dark synth pop | drone | pop alegre | metal | cuerdas |
|---|---|---|---|---|---|---|
| sacramento | **0.4054** | 0.4048 | 0.0570 | 0.2306 | 0.0204 | 0.0607 |
| religion | 0.3744 | **0.3745** | 0.0468 | 0.2712 | 0.0316 | 0.3044 |

- Both resemble the two brief descriptions more than any control.
- The negative controls drop to 0.02–0.06 (metal, drone): **the model discriminates**,
  it does not say "amen" to everything.
- `religion` scores 0.3044 on "cuerdas románticas" ("romantic strings"), consistent with its organ
  pad; `sacramento` drops there to 0.0607: the new track is less "orchestral".
- `sacramento` beats `religion` on the main description (0.4054 vs 0.3744).

## Calibration: against 6 CC references (2nd session)

Same machine (A10, $1.29/h), `f122b5b0...`, 6 tracks with a permissive license from
Internet Archive (netlabel), 90 s excerpts from minute 1. **4 passes per
audio** because the CLAP extractor crops random windows (`rand_trunc`) and a
single measurement is not enough:

| Audio | Mean | Std. | Range |
|---|---|---|---|
| **sacramento** (ours) | **0.4408** | 0.0200 | 0.419–0.472 |
| religion (ours) | 0.3984 | 0.0111 | 0.379–0.407 |
| 5_Falaxia (CC0) | 0.3726 | 0.0084 | 0.359–0.381 |
| 3_gt529 (CC0) | 0.3512 | 0.0498 | 0.286–0.420 |
| 1_gt290 (CC0) | 0.3175 | 0.0128 | 0.300–0.335 |
| 2_wmri (CC-BY-SA) | 0.2864 | 0.0275 | 0.261–0.330 |
| 6_various (CC-BY-SA) | 0.2838 | 0.0404 | 0.241–0.335 |
| 4_draw (CC-BY-SA) | 0.1802 | 0.0299 | 0.139–0.223 |

Mean of the 6 CC references: **0.2986**.

- `sacramento` is **+0.068 above the best reference** and **+0.142 above
  the mean**. Its standard deviation (0.020) is on the order of the best reference's
  (0.008), so the difference is robust, not noise.
- The 6 references are cited here so the measurement can be reproduced. Licenses:
  CC0 (`gt290`, `gt529`, `Falaxia`) and CC-BY-SA (`wmri`, `draw_002`, `various`).
  They were only used for measuring, they are not distributed and were not used for training.

### What it means and what it does not

- It does **not** mean it sounds better than those tracks: CLAP measures *similarity between audio
  and text*, not mix quality.
- These references are from netlabels, not commercial masters. The measured "ceiling" is
  the amateur scene's, not that of a NIN record.
- It means that **style is not the weak point**: the engine already produces something that is
  recognized as claustrophobic industrial, above published references.
  The margin is in mix/master (crest 8.28 versus the requested 12–14) and in the
  realism of the instruments, things this metric does not see.

## Cost

Instance powered on ~15 min ≈ **$0.32** (calibration: another ~15 min ≈ $0.32; total for the day ≈ $0.75). Inference: 0.52 s for 2 audios × 6 texts;
model load 0.8 s. At that rate, scoring a render costs **a fraction of a cent**.

## Reproduce

```bash
pip install "transformers==4.46.3" torch soundfile librosa "numpy<2" "pillow>=10"
python puntuar_clap.py --audio sacramento.wav religion.wav --textos "..." "..."
```

Note: with `transformers 5.x` the `ClapProcessor` ships without a tokenizer and
`get_text_features` returns an object. Pinning 4.46.3 avoids both things.

## Pending

- [ ] Calibrate the ceiling: score 3–5 **CC** tracks of the same style (Jamendo/FMA) to
      know which number corresponds to "this sounds like a record". Without that, 0.40 does not say whether
      we are doing well or badly.
- [ ] Repeat by sections (intro, chorus, outro) instead of the central excerpt.

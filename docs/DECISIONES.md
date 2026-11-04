# Decision log

One place for decisions. Format: date · decision · why · source. Created 4-Nov-2026 (review
step 6, `docs/REVISION-2026-11-03.md` §9.5) by collecting what was scattered in
`docs/LEGAL.md` §7, `fable.md` §4, the old `PLAN-MODELOS-MUSICA.md` (now a section of
`PLAN.md`) and inline decisions in `ESTADO.md`. Nothing was reinterpreted: where two sources
disagree, both are listed and the disagreement is under "Conflicts". Add new decisions here,
with their source; not in LEGAL §7 or ESTADO.

## Product and architecture

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-10-27 | The score is data: `proyecto.json` with transactional ops (`editar_proyecto`, `escribir_progresion`); the question "score as data, yes or no" is closed | it already existed; it unblocked the rest of the plan | PLAN.md "27-Oct"; `docs/REVISION-2026-10-27.md` |
| 2026-10-27 | A sound is a JSON recipe + WAV, not a new synthesizer; no knob panel, the language is chat + words | the Python engine already has the timbres and openDAW a sampler | PLAN.md "27-Oct", Stage 3 (3.2) |
| 2026-10-27 | Sound creation was done before mixing (order is not list order) | it depends on nothing and unblocks mixing | PLAN.md "27-Oct" |
| 2026-10-28 | The agent's Python runs in `caja.py`: writes only in its project, no keys, processes, network or ctypes. "Guardrail, not a cage" | the agent runs generated code | ESTADO (28-Oct) |
| 2026-10-28 | Prompt v4: finish the whole song in the turn, do not ask MIDI vs WAV unless asked; 80 steps per turn, brake by 4 failed cycles | measured loops and early stops | ESTADO (28-Oct) |
| 2026-11-01 | Prices come from OpenRouter's public list and update themselves; unknown model = "price unknown", never an invented number; Ollama Cloud (subscription) shows "~" with the OpenRouter price as the comparison | Carlos asked that any cost shown update by itself | ESTADO (1-Nov) |
| 2026-11-01 | Cost cap per turn is optional (empty = none); with an unknown rate nothing stops | cannot measure what has no price | ESTADO (1-Nov) |
| 2026-11-01 | Capture full trajectories (messages, tool calls, results, verdict) in `proyectos/<slug>/trayectorias/` | dataset for a model of our own and audit trail for a paid tier; `llm.log` keeps 200 characters only | PLAN.md "1-Nov", step 2 |
| 2026-11-01 | Two tiers: a local model (free, lower quality) and an advanced paid tier that resells provider capacity; shared groundwork first (cost, trajectories, evaluator) | per-turn input is over 1 M tokens, so reselling needs a per-turn cap and per-user metering | PLAN.md "1-Nov" |
| 2026-11-01 | The paid tier goes through OpenRouter with one key of ours; read each provider's terms before choosing (they allow a product on top, not reselling raw API access) | price, real cost and invoice come from one place | PLAN.md "1-Nov", steps 7-8 |
| 2026-11-02 | Code and docs in English, names in English | house convention | `fable.md` §4.7 |
| 2026-11-02 | Generation runs on Lambda first; the laptop is the client | measured: i5-1035G1, no CUDA, 7.7 GB RAM (about 2 GB free) | PLAN.md "2-Nov"; LEGAL §7 |
| 2026-11-02 | `MIUZIKA_LAMBDA=on` in `.env` | needed for `generar_audio` | ESTADO (2-Nov) |
| 2026-11-02 | Approved in order: (1) `generar_audio` (ACE-Step 1.5) on Lambda, (2) basic-pitch transcription, local, only on own or CC audio, (3) MIDI-LLM `proponer_midi` as a material generator | miuzika composes in notes; transcription closes the `medir_referencia` gap | PLAN.md "2-Nov" |
| 2026-11-02 | Parked: LoRA on own stems, Magenta RealTime 2, Stable Audio 3, ACE-Step on the VPS (4-Nov), 2-take default for `generar_audio`, Lambda persistent filesystem | no hardware or measurement yet; Carlos accepts the ~2.5 min reinstall on cold starts (4-Nov) | PLAN.md "2-Nov"; ESTADO §2.17 |
| 2026-11-02 | Try existing models before training our own | Carlos | `autoria/CONCEPT.md`, open question 8 |
| 2026-11-02 | MuScriptor (CC-BY-NC) rejected for the product | licence | PLAN.md "2-Nov" |
| 2026-11-02 | `generar_audio`, `transcribir_audio`, `proponer_midi` are not mentioned in the agent prompt; ask Carlos before any line | house rule 1 | PLAN.md "2-Nov" |
| 2026-11-03 | All six ACE-Step tasks are designed into the existing architecture (one request union in `src/core/generacion.ts`, render-to-file inputs, explicit Lambda `entradas`, one GPU script, one door back through `importarPistas`, one tool `generar_audio` with `tarea`); nothing built. Mastering is a separate stage, not an ACE-Step task | Carlos asked that every task be planned in | PLAN.md "2-Nov", last subsection |
| 2026-11-03 | A "Off" button next to the GPU counter (review §9.7); asks for confirmation, shuts down only instances named `LAMBDA_NOMBRE` | cancel does not stop a started instance and the Lambda account is shared. Carlos: "añade el botón" | REVISION §10 step 1; ESTADO (3-Nov); used and working 3-Nov night |
| 2026-11-03 | `generar_audio`, `proponer_midi`, `crear_voz` on GPU and `crear_sonido` with a GPU voice need the chat selector on GPU (behaviour change) | the person chooses, the code enforces | ESTADO (3-Nov, `672f405`) |
| 2026-11-03 | MP3 export: 320 kbps CBR, title as ID3 | Carlos's call | ESTADO (3-Nov night) |
| 2026-11-03 | Instance `295bdec6...` stuck "terminating" for about a year: ignore it, it does not bill | provider-side fault; Carlos | ESTADO (3-Nov) |
| 2026-11-03 | zod for the tool table left for later | it would change the error texts the agent reads (a behaviour change of its own) | REVISION §10 step 3 |
| 2026-11-04 | Not changed: the 0-based `inicio_compas` vs 1-based `desde_compas` in the tool schemas | changes what the model must send; a behaviour change of its own, needs the tool texts | REVISION §10 step 5 |
| 2026-11-04 | GPU providers are a list of their own in "Models", separate from LLM providers; Lambda first and the only one used; Vast.ai and RunPod studied only to shape `ProveedorGpu` | there are more than Lambda; the interface must not take Lambda's shape | PLAN.md "4-Nov" |
| 2026-11-04 | The person chooses, the code enforces: selector on GPU, "hazme una canción" goes to ACE-Step; on CPU the GPU tools are not in the turn's tool list at all | Carlos: "sí con el selector en gpu hazme una canción... sí ok" | PLAN.md "4-Nov" |
| 2026-11-04 | The Brief form is not part of the GPU change | Carlos dropped the idea the same day | PLAN.md "4-Nov" |
| 2026-11-04 | ACE-Step is one sound model among others to come; nothing may assume it is the only one | other models will follow | PLAN.md "4-Nov" |
| 2026-11-04 | Prompt v5 (item 15.5, `622c6698`) approved with the exact text shown to Carlos | house rule 1 | ESTADO (4-Nov) |
| 2026-11-04 | ACE-Step on the Contabo VPS (CPU only): "me interesa pero no ahora"; test only with Carlos's explicit yes | installs 10-15 GB and loads the CPU of the server that also hosts ccmai.org | PLAN.md "2-Nov", Parked |
| 2026-11-04 | VCSL converter left as is: median peak to -6 dBFS, only samples above -1 dBFS turned down; per-instrument balance is the mix's job | VCSL went from 14 dB to about 5 dB below GM | ESTADO (4-Nov) |
| 2026-11-04 | Kept on the list, not now: Steinway with 3 velocity layers (40 MB cap), first hit louder in live Play | Carlos | ESTADO (4-Nov) |
| 2026-11-04 | Docs consolidation: one `PLAN.md` with dated sections, one `docs/DECISIONES.md` (this file); the three secondary plans became stubs | REVISION §7 and §9.5, approved by Carlos | this change |

## Authorship layer (`fable.md` §4, "do not reopen")

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-11-02 | It is a project of its own, closely coupled to miuzika, not only a feature | separate concerns and licence | `fable.md` §4.1 |
| 2026-11-02 | No NFT, no blockchain beyond the OpenTimestamps anchor | NFTs do not prove authorship, consent or lineage; musicians reject them | `fable.md` §4.2; LEGAL §7; CONCEPT |
| 2026-11-02 | Local-first: generation, signing and marking run on the user's machine or the user's own Lambda; no cloud service of ours in the loop | privacy and cost | `fable.md` §4.3 |
| 2026-11-02 | Four pieces: signature + public timestamp, C2PA credentials, machine-readable training consent (`cawg.training-mining`, TDMRep, optionally Spawning), lineage manifest of generated output. No statistical attribution ("3 % of this came from you") | unsolved research; the docs say so | `fable.md` §4.4 |
| 2026-11-02 | Authorship phase A = local generation + LoRA on the user's own stems; phase B = real-time instruments/agents in the browser (RAVE / Magenta RT class, WebGPU + AudioWorklet) | consent is trivial on own stems | `fable.md` §4.5 |
| 2026-11-02 | An open music watermark is the designated research track (uses the Lambda credits) | likely the most original contribution | `fable.md` §4.6 |
| 2026-11-02 | Exports carry a C2PA manifest, a `cawg.training-mining` assertion (generative training and data mining notAllowed by default, inference allowed) and an OpenTimestamps proof | Spike B showed the WAV stays bit-identical | LEGAL §7, §9; CONCEPT |

## Legal (from `docs/LEGAL.md` §7; the reasoning stays in LEGAL §1-§6 and §9)

| Date | Decision | Why | Source |
|---|---|---|---|
| 2026-10-23 | Do not analyze or train with commercial phonograms | LEGAL §3, §4 | LEGAL §7 |
| 2026-10-23 | Mixing knowledge comes from CC material and our own renders | LEGAL §2 | LEGAL §7 |
| 2026-10-23 | The scoring pilot uses only our own audio | LEGAL §3, §4 | LEGAL §7 |
| 2026-10-23 | CLAP allowed: Apache-2.0 verified | LEGAL §6 | LEGAL §7 |
| 2026-10-23 | Do not use MusicGen / Stable Audio (Open) in the product | LEGAL §6 | LEGAL §7 |
| 2026-11-02 | Project licence is AGPL-3.0-or-later; the MIT statement in LEGAL was an error | `README.md` and `package.json` say AGPL | LEGAL §7 |
| 2026-11-02 | Stable Audio 3 and ACE-Step 1.5 are candidates for local generation, pending a read of the licence text | LEGAL §6 | LEGAL §7 |
| 2026-11-02 | Signature and timestamp are evidence, not registration; `cawg.training-mining` is a signal, not a right; publish TDMRep as well; no email or address in the manifest without the artist's say | LEGAL §9 | LEGAL §9 (positions stay there) |

## Conflicts between sources, resolved 4-Nov-2026

Carlos, 4-Nov evening: "adelante con las decisiones, por mí ok". The rule used: the newest
dated decision wins; where none is newer, the one that matches what is built and measured.
Each can be reopened; the older text stays where it was, superseded by this section.

| # | Conflict | Decision | Why |
|---|---|---|---|
| 1 | Consent default: LEGAL §7 and CONCEPT body "decided", CONCEPT question 4 and LEGAL §8 "open" | **Training and mining `notAllowed` by default**, per export, the artist can change it. CONCEPT question 4 and the LEGAL §8 item are closed | already decided 2-Nov and implemented in Spike B; the open entries were leftovers |
| 2 | `fable.md` §4.3 "no cloud service of ours" vs the 1-Nov paid tier | **Local-first is the product.** The paid tier (1-Nov, steps 6-7) is optional and later; everything works with the user's own keys, own Lambda or local models. §4.3 applies to the authorship layer: signing, marking and consent never go through a service of ours | both stand once scoped: §4.3 is about authorship and privacy, the tier about who pays for the LLM |
| 3 | Default generation model open (CONCEPT 6, `fable.md` §6.4) vs ACE-Step built | **ACE-Step 1.5 (MIT)** is the default. Stable Audio 3 stays parked until its licence text and model card are read (LEGAL §8) | it is built, run and heard ("very industrial, very good", 2-Nov); MIT has no revenue cap |
| 4 | LEGAL 23-Oct bans "Stable Audio" vs 2-Nov candidate Stable Audio 3 | The 23-Oct ban is **Stable Audio Open (CC-BY-NC) and MusicGen (CC-BY-NC weights)**. Stable Audio 3 is a different product under the Community Licence: candidate, not cleared | the ban was about the NC licence, not the brand |
| 5 | Authorship phase A = local generation + LoRA (`fable.md` §4.5) vs 2-Nov "Lambda, LoRA parked" | **Existing models on Lambda first**; local generation and the own-stems LoRA come after, still phase A | Carlos, 2-Nov: "try existing models first"; the laptop has 7.7 GB RAM |
| 6 | Lambda credits: watermark (`fable.md` §5) vs Qwen LoRA (CONCEPT 8, PLAN 1-Nov) | **No pre-split.** Each run is approved by Carlos when it is proposed, with its estimated cost. A Qwen3 8B LoRA is out (does not run on 7.7 GB); the own-model LoRA starts from a ~1B model that speaks MIDI | spending is already per run (GPU counter, Off button); the 8B option was ruled out by measurement |
| 7 | Where the authorship project lives (`fable.md` §4.1, CONCEPT 1, REVISION §9.4) | **`autoria/` in this repo until it has code that runs on its own**, then its own repo. `fable.md` moves to `autoria/HANDOFF-2026-11-02.md`, unescaped | one repo is cheaper while it is a spike; the handoff belongs with what it describes |
| 8 | When ACE-Step is used: 3-Nov "only when named" vs 4-Nov "forced by the header box" | **The 4-Nov rule**: the "ACE-Step" box in the chat header decides, and a new-song Brief on GPU ticks it | the model ignored the prompt rule; the code rule is newer and enforceable |
| 9 | Article 50 date "2-Dec-2026, not re-verified" | **Verified 4-Nov** (web search): Article 50 applies from 2-Aug-2026; the Digital Omnibus (Reg. (EU) 2026/1744, in force 27-Jul-2026) gives until **2-Dec-2026** for the machine-readable marking of 50(2) only to generative systems placed on the market before 2-Aug-2026. miuzika is not on the market (local dev server), so the date only matters if it ships | sources: usercentrics.com, technology.org (13-Oct-2026), joneswalker.com; check the Official Journal text before shipping |

## Open (Carlos), from REVISION §9 and CONCEPT

Strudel (keep, park behind a flag, remove); Pad (keep or park); Python synthesis engine
(keep, demote out of the manifest, or retire the torch twin); authorship folder and name
(CONCEPT questions 1-3, 5, 7: TypeScript or Rust, licence, key management, timestamp
anchor); what to delete or archive (`out/`, `tools/piloto-gpu`, `gpu/` experiments,
`probar_sf2.py`, three unnamed branches, `MANIFEST.json` out of git). Review §9.1-§9.6 are
open as of 4-Nov; §9.7 was decided on 3-Nov (above).

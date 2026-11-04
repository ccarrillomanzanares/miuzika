# Authorship layer for miuzika — concept (draft, 2026-11-02)

Provisional home: `autoria/` inside the miuzika repo. The brainstorm handoff
(`autoria/HANDOFF-2026-11-02.md`, 2-Nov-2026) decided this is a project of its own, closely coupled to
miuzika. Name and folder are Carlos's call (open question 1); until then it lives here so
the spike can be run against real miuzika exports. Everything in English, per house rule.

## What it is

A library plus CLI, local-first, that gives a musician three things for any audio file
that leaves miuzika, whether a person played it, the agent composed it, or a model
generated it:

1. **Signature and date.** The file carries a C2PA manifest signed with the artist's own
   key, and the file's hash is anchored in Bitcoin through OpenTimestamps. "This exact
   file existed on this date and this key vouches for it." No NFT, no token, no
   blockchain beyond the OTS anchor (decided by Carlos, do not reopen).
2. **Consent, machine-readable.** A `cawg.training-mining` assertion in the manifest
   says what the artist allows: generative training, other AI training, data mining,
   inference. Default: training and mining **notAllowed**, inference allowed, changeable
   per export. Plus TDMRep for anything we host. It is a signal, not an enforceable
   right; the docs say so.
3. **Lineage.** An `org.miuzika.lineage` assertion records what the file was made from:
   project, tracks and instruments, stems with their SHA-256, the miuzika commit, the
   agent model if one took part, and, when a generative model is used, model, version,
   LoRA and prompt. It does **not** attempt statistical attribution ("3 % of this came
   from artist X"): that is unsolved and we say so.

Phase 1 adds **local generation**: ACE-Step 1.5 or Stable Audio 3 Small/Medium on the
user's machine or Lambda instance, with a LoRA trained on the user's own stems. Phase 2
is real-time instruments in the browser (WebGPU + AudioWorklet), inside miuzika. The
**open music watermark** is the research track: no open watermark has been evaluated on
music, and Article 50 wants a watermark next to the metadata.

## What Spike B proved (2-Nov-2026, laptop, no GPU)

See `spike-b/README.md` for the measurements. Short version: signing a 37 MB miuzika WAV
takes 0.65 s, the PCM is bit-identical, the manifest is 15.8 KB, the OTS proof 840 bytes
and takes 1.8 s to obtain from four calendars; a one-byte change is caught by both the
C2PA data hash and the OTS hash. Every ffmpeg pass strips the embedded manifest, so the
sidecar `.c2pa` and the `.ots` proof are not optional, and neither is the watermark.

## Shape (recommendation, to confirm with Carlos)

- **TypeScript** library + CLI (`sign`, `verify`, `upgrade`, later `mark`, `generate`),
  consumed by miuzika's server after `exportar` writes to `salida/`. Reason: it is
  miuzika's stack, Node 24 runs `.ts` directly, and c2pa-rs is reachable today through
  the `c2patool` binary and tomorrow through `c2pa-node` if we want to drop the
  subprocess. Rust would mean a second toolchain on the laptop for no measured gain yet.
- **Keys** in `~/.miuzika/autoria/` (outside git and outside `workspace/`): a tiny local
  CA and an artist certificate issued by it, because c2patool rejects a self-signed
  end-entity certificate. Verifiers without our CA see "untrusted"; with it, "trusted".
  A CAI-recognised CA is a later purchase, not a blocker.
- **Integration points in miuzika** (verified on the laptop copy): `exportarProyecto` in
  `web/src/main.ts` uploads the WAV with `subirAudio` to `salida/`; the server side of
  that upload (`server/api/audio.ts`) is where sign + stamp + mark should run, with a
  visible toggle in the interface. `meta` in `proyecto.json` already has `generator`,
  `prompt` and `createdAt`; the lineage record extends it. The Python box has no
  network, so OTS must run in Node, not in the agent's Python.

## Open questions (Carlos)

1. Name and folder of the project.
2. TypeScript confirmed? (recommended above)
3. License of the new project; miuzika is AGPL-3.0-or-later (LEGAL.md §1 corrected).
4. ~~Default consent posture~~ Decided 4-Nov: notAllowed by default (`docs/DECISIONES.md`, conflict 1).
5. Key management: file + passphrase, OS keychain, hardware key; CAI CA later?
6. ~~Default generation model~~ Decided 4-Nov: ACE-Step 1.5; Stable Audio 3 parked (`docs/DECISIONES.md`, conflict 3).
7. Timestamp anchor: OTS only, or also a transparency log we run.
8. ~~Split of the Lambda credits~~ Decided 4-Nov: no pre-split, Carlos approves each run (`docs/DECISIONES.md`, conflict 6). Was: split of the Lambda credits between the watermark benchmark and LoRA experiments,
   knowing `PLAN.md` ("1-Nov") also wants them for a Qwen LoRA. Carlos said on
   2-Nov: try the existing models before training our own.

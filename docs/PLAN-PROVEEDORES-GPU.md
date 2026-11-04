# GPU providers and song generation — plan (4-Nov-2026)

Decided with Carlos on 4-Nov. Nothing built yet. Step 4 of the 3-Nov review is done; this sits
next to step 5 (core ownership) and before step 7 (ACE-Step tasks).

## Decisions

1. **GPU providers are a list of their own in "Models"**, separate from the LLM providers: they
   do something else (rent a machine by the hour, upload, run, bring files back, shut down), and
   there are more than Lambda. Lambda is the first and, for now, the only one used: Carlos has
   Lambda credits. The others are there so the interface is not cut to Lambda's shape.
2. **The person chooses, the code enforces.** With the chat selector on **GPU**, "hazme una
   canción" goes to ACE-Step (`generar_audio`). With it on **CPU**, the GPU tools are not in the
   tool list of the turn at all (today they are listed and answer "The GPU is not allowed"), so
   the model cannot pick them. Carlos, 4-Nov: "sí con el selector en gpu hazme una canción... sí ok".
3. **The Brief form is not part of this** (Carlos dropped that idea the same day).
4. **ACE-Step is one sound model among others to come.** It has several tasks (text2music, cover,
   repaint, lego, extract, complete; see `PLAN-MODELOS-MUSICA.md`, last section) and we are at the
   start of learning them. Other sound models will come later; not designed now, but nothing here
   should assume ACE-Step is the only one.

## What changes

- **Server**: `lambda.ts` becomes the first implementation of a `ProveedorGpu` interface
  (`server/gpu/`): `estado`, `encender`, `apagar`, `subir`, `ejecutar`, `traer`, plus price per hour
  and the provider's own words for its states. `/api/gpu/*` and `/api/run/lambda` (renamed
  `/api/run/gpu`, the old path kept as an alias) go through the provider chosen in "Models".
- **Config**: from `.env` (`MIUZIKA_LAMBDA=on`, `LAMBDA_*`) to `.miuzika/proveedores.json` under a
  `gpu` key (key, instance type, region, name, SSH key path), like the LLM keys. `.env` keeps
  working as a fallback so nothing breaks the day it lands.
- **Models panel**: a "GPU" section: provider, key, machine type, region, price per hour (from the
  provider when it gives it), and a "Test" that only lists instances (no start, no cost).
- **Tools per turn**: the tool list is built per turn from the selector (and later from which sound
  models are configured). GPU tools: `generar_audio`, `proponer_midi`, `crear_voz destino=gpu`,
  `ejecutar_python destino=lambda`, `crear_sonido` with a GPU voice.
- **Prompt**: one section, exact text shown to Carlos before touching `agente-prompt.ts` (house
  rule 1): with GPU tools present a song is made with `generar_audio`; proposals and transcriptions
  are heard with `anadir_pistas`; material to compare goes from bar 1 muted or solo.

## Other providers, for the interface only (looked up 4-Nov, not used)

| provider | 24 GB class, per hour | how a machine is driven | what it teaches the interface |
|---|---|---|---|
| **Vast.ai** | RTX 4090 from ~$0.13, median ~$0.53 (73 offers, aggregators, Jul–Oct 2026) | REST `console.vast.ai/api/v0`: rent an **offer id** (marketplace) → instance id; status gives `ssh_host`/`ssh_port`; stop (disk still billed) vs destroy (DELETE). SSH key must be on the account before creating. | a machine is **chosen from offers**, not by a fixed type; SSH port is not 22; stop ≠ destroy |
| **RunPod** | RTX 4090 ~$0.34 community / ~$0.74 secure | `runpodctl` / API: create a pod from a template + GPU id; SSH on by default; stop keeps storage (billed); a pod with a network volume can only be terminated | **templates/images** instead of installing on boot; stopped storage costs money |

Prices are from aggregator pages and disagree; they are only to size the interface, not to choose.
Sources: computeprices.com/gpu, amcompute.com/gpu-cloud-prices/rtx-4090, gpus.io/en/gpus/rtx4090,
docs.vast.ai/api-reference/hello-world, docs.runpod.io/pods/manage-pods,
docs.runpod.io/runpodctl/reference/runpodctl-pod.

So `ProveedorGpu` needs: a way to pick the machine (fixed type for Lambda, offer search for Vast),
SSH host **and port**, an explicit **stop vs destroy** with what each still bills, and an optional
image/template so cold starts do not reinstall (Lambda persistent filesystem: later, as an option for
users who pay for storage; Carlos accepts the reinstall, 4-Nov).

## Order

1. Done 4-Nov (`e1a6869`): `ProveedorGpu` interface with Lambda behind it, no behaviour change.
2. Done 4-Nov (`dc57e63`, `6f42e6b`): settings in `.miuzika/proveedores.json` under `gpu`, read on
   every request, `.env` as the fallback field by field; the Models "GPU" section (headless run).
3. Done 4-Nov: tools per call from the selector; on CPU the GPU tools are not offered.
4. The prompt section, after Carlos says yes to the exact text (proposed 4-Nov, see ESTADO).

Still to do: rename `/api/run/lambda` to `/api/run/gpu` (keeping the alias); the log tool names
(`lambda_encender`, `ejecutar_python_lambda`…) say Lambda and stay until a second provider exists.
Not checked yet with Carlos: a GPU turn with a model after these changes, the Models GPU section
in his browser.

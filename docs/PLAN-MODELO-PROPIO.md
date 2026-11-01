# A model of our own, and two tiers — plan agreed on 1-Nov-2026

Carlos wants both: a **local** model that does everything the agent does, with lower
quality but at almost no cost, and an **advanced** paid tier that resells capacity of
an external provider with higher quality. This note records what was decided and why,
so the next sessions do not re-argue it.

## What the numbers say (tmp/llm.log, 28-Oct "Hard" session, DeepSeek V4.1 Flash)

| | |
|---|---|
| Calls per composing turn | 23 to 46 |
| Input tokens per turn | 1.0 to 1.7 M (99% cache reads; ~48 k context per call) |
| Output tokens per turn | 12 k to 97 k |
| Cost per turn at 1-Nov prices | ~0.04 $ (DeepSeek V4.1 Flash) · ~1.2 $ (Claude Sonnet 4.5) |

The cached-input price decides the advanced tier's economics, not the list price. A
turn is **more than a million input tokens**: without a per-turn cap and per-user
metering, reselling is not viable.

## Where the data is (and is not)

- `tmp/llm.log` keeps only the first 200 characters of each message and the sizes
  (unless `MIUZIKA_LOG_COMPLETO=1`). It is **not** a training corpus.
- `proyectos/*/agente.json` keeps 32 turns in total, user/assistant text only, no tool
  calls or results.
- So, as of 1-Nov, **there is no training data**. Capturing it comes first.

## Order of work

Shared by both tiers (first):

1. **Cost per call and per turn, with prices that update themselves.** Done on 1-Nov:
   `src/core/precios.ts`, `server/precios.ts`, `/api/precios`, the chat-header counter,
   `coste_usd` in every `llm.log` line. Source: OpenRouter's public model list.
2. **Full trajectory capture** in a file apart from `llm.log`: messages, tool calls,
   tool results, and the verdict of `escuchar_mezcla` (valid project, muted tracks).
   This is the dataset for the local tier and the audit trail for the paid one.
   Done on 1-Nov: `proyectos/<slug>/trayectorias/`, one file per turn
   (`src/core/trayectoria.ts`, `/api/trayectorias`). From now on every session with
   the agent adds to the dataset; the 28-Oct sessions are lost (only summaries).
3. **The evaluator**: share of briefs that end in a valid project with no muted tracks,
   run with the same verifiers for the local model, DeepSeek and Claude. It puts a
   quality number next to each price.

Local tier (free):

4. **Synthetic, verified dataset.** Hundreds of varied briefs (style, tempo, key,
   instruments) solved by a strong model inside the agent itself, kept only if the
   parser, the transactional ops and `escuchar_mezcla` accept the result (rejection
   sampling: miuzika has verifiers, so no hand labelling). Target: 1,000 to 3,000
   trajectories.
5. **LoRA on Qwen3 8B or 14B**, a few hours on a fine-tuning service or on Lambda,
   exported to GGUF and served with local Ollama (the "Ollama local" provider already
   exists; nothing changes in the interface). Goal: learn the tool protocol and the
   compact notation well enough to **drop most of the 21 k-character prompt and the
   tool schemas**, so the context per call falls to a fraction and an 8B runs at a
   usable speed on a laptop. Not expected: composing better than a frontier model.

Advanced tier (paid):

6. **Infrastructure, not model**: accounts, token metering per user, the provider key
   on the server (today keys live in the user's `.miuzika/proveedores.json`), a cost cap
   per turn, and a margin on top.
7. **Route the paid tier through OpenRouter** with one key of ours: price, real cost per
   request and the invoice come from the same place, no reconciliation. Contract
   providers directly later if volume justifies it; the interface does not change.
8. **Terms of service**: the big providers allow building a product on top and charging
   for it, not reselling raw API access. Read each provider's terms before choosing; do
   not take this from memory.

# Plan: a small local routing classifier

Status: research and plan only, nothing trained. Written 2026-11-25. The owner's own labelled data (the Switches
👍/👎 log from 0.9.x, and reply-read labels after it) comes next week and slots into step 3.

## The goal

Today every prompt's task class comes from keyword rules, then a Haiku call (`classifierSystem` /
`classifierPrompt` in `router/hooks/policy.ts`, answer `"<label> <confidence>"`, read by `readLabel`). The class sets
the effort and, on the first prompt (3 samples must agree), the chat's model. The aim is to replace that Haiku call
with the smallest model that runs on the user's CPU, with the same answer shape, so the rest of the policy code does
not change.

What it buys: no network round trip per prompt (about a second today), no classifier spend, and the same answer every
time (the 3-sample agreement on the first prompt turns into one calibrated probability).

What it must not cost: any per-prompt hard gate, and any quality the router keeps today.

## Baseline to beat (free replay, `node fast.mjs`, 2026-11-25)

| Gate (per prompt, `evals/README.md`) | Haiku today | Pass |
|---|---|---|
| Floor downgrades | 0 | 0, hard |
| Production investigation below Opus high | 0 | 0, hard |
| Measured quality vs always Opus medium | +15.6% | -5.0% or better, hard |
| Adds value (quality or spend) | +15.6% quality, 122% spend | hard |
| False cheap vs per-case labels | 12.7% | report |
| Unstable (runs disagree) | 11.3% | 15% or less |
| False dear (2 of 3 runs) | 47.7% | 30% or less, failing today |

Subagent briefs (same classifier): false cheap 0%, unstable 5%.

## The candidate list

**The Jev Space is not a source of small models.** [jev-decision-index](https://huggingface.co/spaces/multimodalart/jev-decision-index)
is a leaderboard of open reproductions of TypeSafe's closed Jev decision model. Its entrants read as 25B to 31B
fine-tunes (mostly of a 31B base); nothing near CPU size. The repo already uses the hosted Jev as a judge
(`evals/calibrate/jev.mjs`). The one idea worth taking from it is the shape: a model that returns a probability per
option and no text. That is exactly a classification head.

**Language is a hard requirement.** About half the eval cases (137 of 283) are non-English or mixed Russian-English.
English-only bases (bge-small-en-v1.5, all-MiniLM-L6-v2, ettin, ModernBERT) are out.

| Base | Size | Licence | Russian | Runs in Node | Notes |
|---|---|---|---|---|---|
| **multilingual-e5-small** | 117.7M params (96M of it the 250K-token word table, 21M the 12-layer, 384-wide transformer; arithmetic from its config.json), int8 ONNX 118 MB | MIT | yes, in its language list with Russian benchmark scores | transformers.js build (`Xenova/multilingual-e5-small`, int8) | **Chosen base.** The only small one with confirmed Russian and a ready int8 build |
| potion-multilingual-128M (model2vec) | static table, 256 dims | MIT | 101 languages, Russian not named | no official JS; a third-party JSR port, Node unverified | Fallback if e5 is too slow or big: a lookup plus a mean, about 1 ms |
| paraphrase-multilingual-MiniLM-L12-v2 | ~0.1B | Apache-2.0 | "50 languages", Russian not named | ONNX tag | Second choice if e5 loses on the eval |
| mmBERT-small | 140M (42M non-embedding) | MIT | 1800+ languages | no ONNX | Needs our own export |
| nvidia/prompt-task-and-complexity-classifier | ~0.2B (DeBERTa-v3-base) | NVIDIA Open Model License (redistribution allowed with notice) | English only | no ONNX | Not a base. Useful as a **teacher**: 11 task types and 6 complexity scores for public prompts |

Cards: [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small),
[its int8 ONNX](https://huggingface.co/Xenova/multilingual-e5-small/tree/main/onnx),
[potion-multilingual-128M](https://huggingface.co/minishlab/potion-multilingual-128M),
[paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2),
[mmBERT-small](https://huggingface.co/jhu-clsp/mmBERT-small),
[NVIDIA classifier](https://huggingface.co/nvidia/prompt-task-and-complexity-classifier),
[NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/).
Made by the E5 authors (Wang, Yang, Huang, Yang, Majumder, Wei; [arXiv:2402.05672](https://arxiv.org/abs/2402.05672)), released mid-2023, MIT. 512-token input. No CPU latency is published: measure it (step 1).

## Training data

Public sets give coarse task types and difficulty. The router's own 33 classes (31 with rules plus `engineering`,
`message`; `CLASS_LABELS`) are finer, and about a third have no public analogue at all. So the data comes in four
layers, coarse to fine.

| Set | Licence | Rows | Labels | Maps to router classes |
|---|---|---|---|---|
| Magpie-Qwen2.5-Pro-1M / Magpie-Llama-3.1-Pro-1M | Qwen set: not stated on the card; Llama set: Llama 3.1 licence | 1M each | `task_category` (11: information seeking, advice, planning, brainstorming, coding & debugging, creative writing, reasoning, data analysis, math, editing, role play), `difficulty` very easy to very hard | coding & debugging -> engineering/scoped-code/debugging (coarse `code`); math -> math; data analysis -> data-analysis; brainstorming -> brainstorm; editing -> mechanical; information seeking -> explore/learn-explain; creative writing -> brainstorm (never final-copy: a floor class is not learned from guesses); difficulty -> effort prior |
| databricks-dolly-15k | CC BY-SA 3.0 | 15k | 8 categories | summarization, information_extraction, closed_qa -> long-read; open_qa, general_qa -> learn-explain/explore; brainstorming -> brainstorm; classification -> mechanical; creative_writing -> brainstorm |
| lmarena-ai/arena-human-preference-140k | CC-BY-4.0 (prompts) | 136k | `category_tag`: complexity, problem_solving, technical_accuracy, domain_knowledge, creativity, math, instruction following | "hard prompt" criteria -> effort high signal; math -> math; creative -> brainstorm. Has a language column (Russian share to count) |
| routellm/gpt4_dataset | Apache-2.0 | 119k | `mixtral_score` 1-5 (a weak model's answer graded) | not a class: a "a cheaper model will do" signal for the model tier |
| allenai/WildChat-1M | ODC-By | 838k | none (language, model, moderation) | unlabelled real prompts, many languages: the pool for distillation (below) |
| NVIDIA task types (as teacher labels on the pools) | model under NVIDIA licence | as run | 11 task types + complexity | Code Generation -> scoped-code/engineering; Summarization, Extraction, Closed QA -> long-read; Rewrite, Classification -> mechanical; Brainstorming -> brainstorm; Open QA -> learn-explain; Text Generation -> docs/message; Chatbot, Other -> default |

Cards: [Magpie-Qwen2.5-Pro-1M](https://huggingface.co/datasets/Magpie-Align/Magpie-Qwen2.5-Pro-1M-v0.1),
[Magpie-Llama-3.1-Pro-1M](https://huggingface.co/datasets/Magpie-Align/Magpie-Llama-3.1-Pro-1M-v0.1),
[dolly-15k](https://huggingface.co/datasets/databricks/databricks-dolly-15k),
[arena-140k](https://huggingface.co/datasets/lmarena-ai/arena-human-preference-140k),
[routellm/gpt4_dataset](https://huggingface.co/datasets/routellm/gpt4_dataset),
[WildChat-1M](https://huggingface.co/datasets/allenai/WildChat-1M). The two Magpie cards show 9 of the 11
`task_category` values between them; editing and role play in the table are from memory: confirm the list in the
dataset viewer.

Not used: lmsys-chat-1m (gated, conditions), OpenAssistant oasst2 (no task label), Arch-Router (data not released).
No public set labels coding requests by intent (bug fix / explain / refactor / review) cleanly; a few small candidates
were found and not inspected.

**The four layers:**
1. **Coarse pre-training** on Magpie + Dolly + Arena mapped as above (only rows whose mapping is unambiguous).
2. **Distillation**: the current Haiku classifier (the exact plugin prompt) labels a pool of 10-20k public prompts
   (WildChat, Arena), English and Russian. This teaches the router's own 33 labels and its "default" habit.
3. **Synthetic gaps**: Haiku writes prompts for the classes no public set has (final-copy, brand-visual,
   image-prompt, vision, devops-config, security-review, code-review, test-writing, structure, critique, rare-hard,
   repeat-agent, message), in English, Russian and mixed, with the generator rules in `evals/generate.mjs` (never the
   owner's places or projects).
4. **The owner's labels** (next week): Switches 👍/👎 and reply-read labels. They weigh most and are the only data
   from real use; held out by session for testing.

**Never trained on:** the eval cases in `evals/cases/` (they are the test set). Training prompts with high n-gram
overlap with a case are dropped.

## Training method

**Frozen embeddings plus a small head first; fine-tune only if the head fails the gates.**

1. Embed every training prompt once with multilingual-e5-small (`query: ` prefix, first 512 tokens, mean pool).
2. Train a multinomial logistic regression head (384 -> 34 including `default`), class-weighted so rare floor classes
   are not drowned out. Calibrate with temperature scaling on a held-out split, so its probability can stand in for
   Haiku's confidence (`passAt` 0.7, sure at 0.85) unchanged.
3. The head is about 13K numbers: a JSON file of ~100 KB that can live in the repo.
4. If the head misses a gate, fine-tune e5-small end to end on the same data (GPU minutes on the owner's card, through
   the GPU gate), export int8 ONNX, and re-check.

Training runs outside the plugin (Python with sentence-transformers is fine there; it is not shipped). Venv, base
weights and checkpoints on D: only, one copy. Only the head (and, if fine-tuned, our ONNX file) ships.

## Eval against the existing store

1. `run-classifier.mjs` gets a `CLASSIFIER=local` switch: the local model answers in place of the Haiku call, same
   rules first, same `readLabel` after. Local calls are free, so the whole suite runs at $0.
2. `report.mjs` scores it with the same gates. The quality gate reads measured replays already in `work/eval.db`; a
   case routed to a tier that was never measured needs a paid measure run (Opus or Sonnet: **owner's OK first**).
3. The subagent suite (`subagents/run.mjs`) reads briefs with the same classifier: run it local too.
4. Unstable drops to 0 (one deterministic answer); the first-prompt "3 samples agree" becomes "probability >= a
   threshold" tuned on the training hold-out, never on the cases.
5. One case is about 1-1.5 points: a gate missed by less than one case is re-run once (here: re-trained with another
   seed) before it counts.

## Gates it must pass

| Gate | Pass |
|---|---|
| Every per-prompt **hard** gate above | as today |
| Subagent false cheap, production investigation | as today (0%, 0) |
| False cheap | no worse than Haiku (12.7%) |
| False dear | no worse than Haiku (47.7%); the hope is under the 30% target |
| Measured quality vs always Opus medium | no worse than Haiku minus 2 points |
| Warm latency on CPU | p95 under 100 ms per prompt on a mid laptop and on the CI runners |
| Cold start | under 2 s, once per session |
| Download | one base model, under 150 MB, checksummed, into `~/.claude/router/models/` |
| Russian and mixed cases | false cheap on them no worse than on English ones |

## How it would ship

1. **Opt-in setting**, like Training: "Local classifier (beta)". On first switch-on it downloads the base model from
   Hugging Face with a checksum. Never in the git repo (118 MB); the head is in the repo.
2. **Runner**: like the SQLite runner, a Node script the plugin writes to `~/.claude/router/` and calls with
   `$.process.run` (argv, no shell). Open question below: how it runs ONNX.
3. **Shadow first**: it runs beside Haiku and the ledger counts agreement per class (no prompt text). Routing does not
   change. After a week of real use, compare.
4. **Then a cascade**, not a swap: the local answer where its probability is high, Haiku where it is unsure. Same
   shape as the Jev cascade already tried in `evals/calibrate/`. The eval picks the threshold; the share of Haiku calls
   saved is the win to report.
5. Haiku stays the fallback whenever the runner is missing, slow (timeout) or fails, so a broken install routes as
   today.
6. Out of scope at first: the session check and the mood check (their prompts include earlier turns, a different task).

## Open decisions for the owner

1. **The ONNX runtime.** Repo rules allow Node built-ins only. Options: (a) install `@huggingface/transformers`
   (WASM, no native code) into `~/.claude/router/` on opt-in, a one-time download of a few MB; (b) write the e5-small
   forward pass in plain JS (12 layers, int8, about 300 lines; slower, maybe 100-300 ms, unmeasured); (c) take the
   static potion model, which needs only a tokenizer and a table lookup in plain JS. Recommendation: measure (a) and
   (c) in step 1, then decide.
2. **Distillation spend** (layer 2): 10-20k Haiku labels at about $0.0003-0.0009 each with the system prompt cached,
   so roughly $6-18. Under the Haiku cap rule, but large enough to ask.
3. **Llama-licensed Magpie**: usable for training under its licence terms, or skip it and keep Dolly, Arena and the
   NVIDIA teacher. Recommendation: start without it.
4. **Anthropic terms**: training a 33-label router classifier on Haiku's labels is not building a competing model, but
   read the usage terms once before layer 2.

## Step 1 result (2026-11-26, $0)

Measured `Xenova/multilingual-e5-small` int8 (`model_quantized.onnx`, 118 MB, plus a 17 MB tokenizer) with
`@huggingface/transformers` 3.8 on a 12-core desktop CPU (Windows, Node 24), 40 runs each:

| Input | Median | p95 |
|---|---|---|
| Short prompt (~10 tokens, English or Russian) | 2.7 ms | 3.8 ms |
| Paragraph (~120 tokens, English or Russian) | 13 ms | 15 ms |
| Long paste (cut at 512 tokens) | 134-150 ms | 146-187 ms |
| Fresh process per prompt (start Node, load, one short prompt) | ~950 ms | |

What this changes:
1. Speed is fine once the model is loaded: well under the 100 ms gate for normal prompts. Long pastes miss it; cut the
   input at 256 tokens (the class shows in the first lines) or accept ~150 ms there.
2. Option (a) is not "a few MB, WASM": in Node the package installs the native `onnxruntime-node` (208 MB) plus
   `onnxruntime-web` (91 MB), 379 MB in all, and its Node build would not run the model on WASM. Native binaries per
   OS are what CI must check.
3. The mod cannot load Node code, so the runner is a separate process. Spawning it per prompt costs ~1 s (still faster
   than three Haiku samples); a runner that stays alive for the session costs 3-15 ms but holds ~850 MB of RAM.
4. Not measured yet: option (c), the static potion model, and a mid laptop or the CI runners.

## Steps and cost

| Step | What | Cost |
|---|---|---|
| 1 | Download e5-small int8 (D:), measure CPU latency in Node for options (a) and (c) | $0 |
| 2 | Build layers 1 and 3 (public sets, Haiku synthetic gaps ~7k prompts) | ~$3-5 Haiku |
| 3 | Layer 2 distillation (after decision 2); add the owner's labels when they land | ~$6-18 Haiku |
| 4 | Train the head, `CLASSIFIER=local` replay, gates | $0 (CPU or local GPU) |
| 5 | Fine-tune only if 4 misses | $0 local GPU; paid measure runs only if new tiers appear (owner's OK) |
| 6 | Shadow setting in the plugin, a week of real use | $0 |
| 7 | Cascade on, release gates, README | $0 |

## Risks

- **33 fine classes from ~10 eval cases each**: the eval can only see large differences; the gates' noise is about a
  case per point.
- **Floor classes** (final-copy, brand-visual, rare-hard, architecture, critique, security-review, structure) have no
  public data. A miss there is a hard-gate fail, so these lean on synthetic data and the cascade's Haiku fallback.
- **Distribution shift**: public chat prompts are not coding-assistant prompts with pasted stack traces and file
  paths. The owner's labels fix this; until then the cascade keeps Haiku on anything unsure.
- **Size and install**: a 118 MB download and a JS runtime on every OS, checked in CI on Windows, macOS and Linux.
- **Unverified facts** from the research: any CPU latency, Russian coverage of the
  potion and MiniLM models, the Qwen Magpie set's licence. Step 1 and a licence read settle them.

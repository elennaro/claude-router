# Research: how other routers pick the model and the effort

Date: 2026-11-26. Public sources only. Companion to `research-eval-design.md` and `research-session-routing.md`.
Why: the local classifier trained on public data failed (`PLAN-classifier.md`, step 3-4 result). Before a pivot, we
looked at how others route. Tags: **[fact]** = stated in the cited source or read in its code, **[guess]** = our
inference. Several papers were read at abstract level only; that is said where it applies. Stars and licences were
checked on GitHub on the date above.

## Short answer

1. **Production routers output difficulty, not a task class.** Gemini CLI asks a small model for a complexity score
   from 1 to 100 (or Flash vs Pro by a rubric). vLLM Semantic Router asks for a difficulty from 0 to 4 plus what the
   request needs, and turns that into an effort level. LiteLLM scores four tiers. Where a category exists, it is an
   input to a table, not the answer. **[fact]**
2. **Narrow questions beat broad ones.** Google routed Gemini models with one yes/no question: does answering need
   more than one sequential step? That got 50 of 50 tasks right at 13% less than the best fixed setup. A broad "simple
   or complex?" question sent nearly everything to simple; a word heuristic got 70.6% on held-out tasks. **[fact]**
   This matches TwinRouterBench in `research-eval-design.md`: Opus asked directly for the needed tier flagged 7 of 147
   steps that needed it.
3. **Effort is a first-class output.** vLLM measured that thinking off lost 27-40 points and medium lost 8-15 against
   xhigh on GPQA Diamond. Google's best setup was a mid model at low thinking. OpenRouter Auto often changes the effort
   instead of the model. **[fact]** In Claude Code an effort change keeps the prompt cache and a model change does not
   (`research-session-routing.md`), so effort can move every turn and the model only at cache boundaries.
4. **Learned routers hit a plateau.** Across 21 routers on 5 benchmarks, plain kNN averaged 76.95% against 77.01% for
   the best; more data and fine-tuning added about 1.2 points ([2606.07587](https://arxiv.org/abs/2606.07587)). Many
   routers, commercial ones included, do not beat the best single model; OpenRouter Auto was 24.7% behind
   ([2601.07206](https://arxiv.org/abs/2601.07206)). Routers trained on Arena votes alone were near random on MMLU
   ([RouteLLM 2406.18665](https://arxiv.org/abs/2406.18665)); our Arena size head was 35% against 33% for chance.
   **[fact, abstracts and summaries]**
5. **Users punish silent downgrades.** GPT-5's router misfired at launch and the manual picker came back on
   2025-08-12; Cursor Auto and Gemini CLI drew the same complaint. The fix people ask for is a visible pick and an
   override, which the router already has ("Picked X · Undo"). **[fact, news and forum threads]**

## Projects

| Project | Stars | Licence | How it decides | Output | Effort |
|---|---|---|---|---|---|
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | 266k | MIT | Length and stop words; the feature was removed on 2026-04-20 | cheap or main model | no |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | 109k | Apache-2.0 | Prompted classifier: rubric, or a 1-100 score; same rubric on a local Gemma | Flash or Pro | set per model |
| [DeerFlow](https://github.com/bytedance/deer-flow) | 86k | MIT | Lead agent and subagents; no model router found | - | - |
| [Ruflo](https://github.com/ruvnet/ruflo) (was claude-flow) | 82k | MIT | Weighted word score, Thompson-sampling bandit on outcomes | Haiku, Sonnet, Opus | no |
| [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) | 71k | Sustainable Use 1.0 | The orchestrating model picks a category when it delegates | model and variant | yes |
| [LiteLLM](https://github.com/BerriAI/litellm) | 64k | MIT (enterprise dir apart) | 7 weighted word features; optional LLM classifier near tier edges | 4 tiers | yes |
| [claude-code-router](https://github.com/musistudio/claude-code-router) | 38k | MIT | Conditions on headers and body, ordered fallbacks | model | no |
| [Plano](https://github.com/katanemo/plano) + Arch-Router-1.5B | 7.1k | Apache-2.0; model: commercial use needs a separate licence | 1.5B model matches operator-written route descriptions | route | no |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | 6.5k | Apache-2.0 | Vela-2.0-0.8B answers 6 questions; effort formula; 10 lanes | model and effort | off to max |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | 5.7k | Apache-2.0 | Trained on Arena plus GPT-4 judge labels; no commits since 2024-08 | strong or weak | no |
| [aurelio semantic-router](https://github.com/aurelio-labs/semantic-router) | 4.0k | MIT | Embeddings against example phrases per route | route | no |
| [LLMRouter](https://github.com/ulab-uiuc/LLMRouter) | 3.1k | MIT | Library of 16+ routers (kNN, MF, Elo, Router-R1) | - | - |
| [NVIDIA prompt classifier](https://huggingface.co/nvidia/prompt-task-and-complexity-classifier) | HF | NVIDIA Open Model | DeBERTa 0.2B: 11 task types, 6 complexity scores; English only | complexity score | no |
| [P2L](https://github.com/Arena-OSS/p2l) | 277 | none stated | LLM predicts per-prompt model strengths from Arena votes | model ranking | no |

Pi (124k) and OpenCode (229k) extensions, Cline, Roo, Kilo, Codex CLI, Windsurf and Copilot were not checked here;
Copilot's cache-boundary routing is in `research-session-routing.md`.

## Prompts and rules (structure only; exact text at the links)

- **Gemini CLI, Flash or Pro** ([classifierStrategy.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/routing/strategies/classifierStrategy.ts)):
  the request plus the last 4 non-tool turns. Complex if any of: 4+ dependent steps or tool calls; "how" or "why",
  architecture or strategy; a broad request needing investigation; debugging an unknown cause from symptoms. Simple
  if bounded, 1-3 tool calls; operational simplicity beats strategic wording. 6 examples. JSON: a short reasoning and
  the model choice. The same prompt runs on a local Gemma.
- **Gemini CLI, numerical** ([numericalClassifierStrategy.ts](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/routing/strategies/numericalClassifierStrategy.ts)):
  the request plus 8 turns; four bands (1-20 trivial, 21-50 routine, 51-80 high complexity, 81-100 strategic) with
  typical tasks and risk; 4 examples, one an injection attempt scored 1; the threshold comes from remote config (an
  issue describes a default A/B of 50 and 80).
- **vLLM Semantic Router, MoM V1** ([recipe README L44-120](https://github.com/vllm-project/semantic-router/blob/main/config/recipes/built-in/latest/mom-v1/README.md#L44-L120)):
  one call answers task (8 kinds), difficulty 0-4, precise facts, needs (deliberation, tools, verification, long
  output, creativity), correction and tool use. Effort = 0.3 x difficulty + 0.35 x P(deliberation) + 0.1 x
  P(verification) - 0.35 x brief request; off below 0.4, then medium, high, max. Ten lanes, each with a model and an
  effort; a conversation stays on its model for 300 s idle.
- **Google, Cost per task** ([blog, 2026-11-03](https://developers.googleblog.com/cost-per-task-using-cheap-classifiers-to-route-across-gemini-models-and-thinking-levels/)):
  TypeSafe's Jev answers one probability question (more than one sequential step?). Flash-Lite, else a Flash model at
  low thinking. 48 of 50 hand labels matched, 34 of 34 held out. No threshold stated; one run per setup.
- **LiteLLM complexity router** ([README L14-37](https://github.com/BerriAI/litellm/blob/8e8cdc6/litellm/router_strategy/complexity_router/README.md#L14-L37)):
  weights code 0.30, reasoning markers 0.25, technical terms 0.25, length 0.10, "what is" -0.05, multi-step 0.03,
  several questions 0.02; tiers at 0.15, 0.35, 0.60. The LLM mode gets one criteria line per tier, calibration
  examples and 3 prior user turns, so a bare "yes" is rated by the work it approves.
- **Arch-Router** ([model card](https://huggingface.co/katanemo/Arch-Router-1.5B/blob/main/README.md)): routes as
  name plus description, the last 16 messages; off-topic or done means "other"; no examples. Plano pins a session to
  a model for 600 s and prices the cache lost on a switch.
- **Hermes Agent** ([last version](https://github.com/NousResearch/hermes-agent/blob/5f0a91f/agent/smart_model_routing.py#L11-L107)):
  cheap model if at most 160 characters and 28 words, one newline, no backticks or URLs, none of 35 words such as
  debug, implement, refactor. Never set effort. Removed.
- **oh-my-openagent** ([categories](https://github.com/code-yeongyu/oh-my-openagent/blob/bebc53a/packages/omo-opencode/src/tools/delegate-task/openai-categories.ts#L158-L210)):
  no classifier; the orchestrator's system prompt has a domain-to-category table and right and wrong examples;
  each category maps to a model and a variant (quick: fast model, low; ultrabrain: strongest, max).
- **Ruflo** ([model-router.ts](https://github.com/ruvnet/ruflo/blob/48b04dc/v3/@claude-flow/cli/src/ruvector/model-router.ts)):
  0.2 lexical + 0.35 semantic depth + 0.25 scope + 0.2 uncertainty; Haiku below 0.4, Sonnet below 0.7; a bandit
  multiplies by a draw from each model's success record per band.
- **Ours today** (`router/hooks/policy.ts:161`): the current prompt only (2000 characters, no history); 24 labels
  plus default; "label confidence", no reasoning.

## Effort and reasoning papers (abstracts)

GPT-5's real-time router uses conversation type, complexity, tool needs and explicit intent, and is trained on live
switches, preference rates and measured correctness ([system card](https://openai.com/index/gpt-5-system-card/)).
AdaptThink ([2505.13417](https://arxiv.org/abs/2505.13417)) and ThinkSwitcher ([2505.14183](https://arxiv.org/abs/2505.14183))
learn think or no-think; ARES ([2603.07915](https://arxiv.org/abs/2603.07915)) uses a 1.7B model to pick low,
medium or high effort per agent step. No routing result for Russian was found; PolyRoute
([2611.13843](https://arxiv.org/abs/2611.13843)) covers 12 languages and code-mixing.

## What it means for the pivot [guess]

1. The classifier's answer should be difficulty and needs (a few narrow yes/no questions, or one score), mapped by a
   table to a model and an effort. The 24 classes stay where they carry floors (final copy, security review,
   production investigation), as inputs, not as the classifier's main output.
2. This needs no training: thresholds are set on the eval's measured needs, as the routing table is today.
3. Decision-model candidates to measure on the 283 cases: Haiku (today), Jev (already wired as the judge; Google used
   it as a router), Vela-2.0-0.8B (Apache-2.0, built for this; CPU runtime unchecked), a small local Gemma.
4. The owner's Training labels (0.9.6) tune thresholds and later feed a kNN or a bandit, the way Ruflo and GPT-5
   learn from outcomes. Never Claude outputs as training data.
5. Gemini CLI's rubric and examples are Apache-2.0 and can be adapted with attribution; oh-my-openagent's code cannot
   (Sustainable Use licence); Arch-Router's weights need a commercial licence.

## Not checked

The "super-manager" the owner remembered was not identified (candidates: DeerFlow, Ruflo, claude-code-router).
Jev's threshold is not in Google's post. The size of vLLM's older ModernBERT classifier. Reception of
claude-code-router, RouteLLM, LiteLLM and Hermes. Most papers beyond their abstracts.

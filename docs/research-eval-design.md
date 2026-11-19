# Research: how to build the router evals

Date: 2026-11-18. Public sources only. Companion to `research-session-routing.md`.
Tags: **[fact]** = stated in the cited source, **[guess]** = my inference, not checked. Where I only read an abstract or summary, I say so.

## Short answer

1. Every serious router paper labels with **measured outcomes**, not opinions: ground-truth correctness (MMLU, GSM8K, unit tests) or a per-prompt judged comparison of the cheap answer against the strong answer. Opinion labels ("which tier does this need?") show up nowhere as the main label. The one published test of a frontier model *predicting* the needed tier went badly: Opus 4.6 as a router flagged only 7 of 147 steps that actually needed the strong tier (TwinRouterBench). That matches what we saw: opinion labels underestimate how often cheap tiers lose.
2. A single A/B verdict is noisy. Fix it with: both orders, a win only when both orders agree, a judge that wrote neither answer, a length check, a per-category rubric, and a **null baseline** (Opus vs a second Opus sample) that tells you how often the judge says "worse" when nothing is worse. Our "cheap answer won 9 of 39" result is partly real and partly that floor. You can't separate the two until you measure the floor.
3. Multi-turn routing is new (most papers are from 2026). Published methods: counterfactual replay of the conversation under each action, paired per-episode bootstrap, and continuity metrics (span-level and conversation-level accuracy, number of switches). Switching itself has a measured cost: a single mid-conversation handoff moved scores by -8 to +13 points, and it rebuilds the cache.
4. For subagents, the best template is TwinRouterBench: rerun a successful trajectory with one step on a cheaper tier, and label that step with the cheapest tier that still passes a checkable test.

---

## 1. How router papers build eval sets and labels

| Work | Eval data | Label type | How labels are made | Metric |
|---|---|---|---|---|
| **RouteLLM** (Ong et al., ICLR 2025) | MT-Bench (160 questions), MMLU (14,042), GSM8K (~1,000+) | Measured | Train: ~65k Chatbot Arena human votes (win/tie/loss, models grouped into tiers), plus ~1,500 MMLU golden labels, plus ~120k GPT-4-judged pairs (GPT-4 vs Mixtral on Nectar prompts, ~$700). Eval items with embedding similarity ≥0.95 to training data were dropped. **[fact]** | PGR, APGR, CPT(x%) |
| **RouterBench** (Hu et al., 2024) | 405,467 outputs, 11 models, 8 datasets (MMLU, Hellaswag, Winogrande, ARC-C, GSM8K, MBPP, MT-Bench, 800-query RAG) | Measured | Exact match where possible; GPT-4 judge for MBPP, MT-Bench, RAG. All outputs pre-generated so routers can be scored offline. **[fact]** | Cost-quality plane, non-decreasing convex hull, AIQ, Oracle, "Zero router" baseline |
| **RouterEval** (Huang et al., 2025) | 200M+ records, 8,500+ models, 12 benchmarks | Measured | Benchmark correctness per model per item. **[fact, abstract-level]** | Router accuracy vs best single model |
| **FrugalGPT** (Chen, Zaharia, Zou, 2023) | HEADLINES 10k, OVERRULING 2.4k, COQA ~8k | Measured | A small DistilBERT scorer predicts whether an answer is correct and decides when to stop the cascade. **[fact]** | Cost at matched accuracy |
| **AutoMix** (Aggarwal, Madaan et al., 2023) | QA datasets | Measured | Small model checks its own answer (few-shot self-verification); a POMDP meta-verifier decides whether to escalate. **[fact, abstract-level]** | IBC (incremental benefit per cost) |
| **Hybrid LLM** (Ding et al., ICLR 2024) | MixInstruct 20k; 10k train queries | Measured, **soft** | 10 samples per model per query; label = P(small quality ≥ large quality − t), with t tuned. Quality = BART score. **[fact]** BART score agreed only weakly with GPT-4 ratings (r = 0.26–0.46), and routers got worse as that agreement dropped. **[fact]** | % calls to small model vs % quality drop |
| **MixLLM** (Wang et al., 2025) | RouterBench data | Measured | Contextual bandit using tag-enhanced embeddings; reports 97.25% of GPT-4 quality at 24.18% of the cost. **[fact, abstract-level]** | Quality / cost / latency |
| **Arch-Router** (Katanemo, 2025) | Multi-turn routing data | Policy labels (human-written domain/action policies) | Router picks a written policy; measured per turn, per span, and per conversation. **[fact, summary-level]** | Turn / span / conversation accuracy |
| **TwinRouterBench** (2026 preprint) | 970 step rows from 520 instances (SWE-bench, BFCL, mtRAG, QMSum, PinchBench) + live SWE-bench Verified (100 locked instances) | Measured, per step | Start from a passing strong-model trajectory. Downgrade one step at a time, rerun, and accept the cheaper tier only if the run still passes in no more steps. Non-low tiers are checked with 3 models. Opus gives pruning hints only, never labels. A human audited 64 steps (63 OK). **[fact]** | RowPass, TrajPass, CostSave (savings count only on passing runs) |

**Metric definitions** (RouteLLM, **[fact]**):
- PGR = (score(router) − score(weak)) / (score(strong) − score(weak)): the share of the quality gap the router keeps.
- APGR = PGR averaged over strong-call shares from 0 to 1 (they average 10 evenly spaced points).
- CPT(x%) = the smallest share of strong-model calls that reaches PGR = x%.

RouterBench's AIQ is the area under the cost-quality hull divided by the cost range. Its "Zero router" (a random mix of models along the hull) is the baseline a router has to beat. **[fact]**

**Samples per category.** Nobody justifies sample size per category. MT-Bench gets by with 160 items in 8 categories (20 each); RouterBench and RouteLLM lean on thousands of benchmark items. tinyBenchmarks shows ~100 well-chosen items per scenario estimate accuracy within ~2%, but it needs prior model-response data to pick those items. **[fact]** Plain stratified random sampling has larger error. **[fact, per tinyBenchmarks]**

**Two findings that apply to us directly:**
- RouterBench: cascades beat the baseline only while the judge's error rate stays under ~0.1, and they fall apart above ~0.2. **[fact]** Judge noise isn't a side issue: it sets the ceiling on what the router can learn.
- Hybrid LLM: one sample per model gives hard 0/1 labels. Several samples give a probability label, which handles the randomness of each model's answer. **[fact]** This is the fix for "the cheap answer sometimes wins by luck".

## 2. LLM-as-judge reliability for pairwise comparisons

**Known biases (measured):**
- **Position bias.** MT-Bench paper, with answer order swapped: GPT-4 gave the same verdict both ways only 65% of the time, GPT-3.5 46%, Claude-v1 24%, mostly favoring the first answer. **[fact]** In a 2023 study, just reordering let Vicuna "beat" ChatGPT on 66 of 80 queries. **[fact]** Position bias varies by judge and task, and it is worst when the two answers are close in quality. **[fact, Shi et al.]** Close pairs are exactly the cases our router decides on.
- **Verbosity bias.** A padded "repetitive list" attack fooled GPT-3.5 and Claude-v1 91% of the time, GPT-4 9%. **[fact]** AlpacaEval's length control (a regression that sets the length difference to zero) raised its correlation with Chatbot Arena from 0.94 to 0.98. **[fact]** Arena's style control also adjusts for markdown headers, bold, and lists; length mattered most. **[fact]**
- **Self-preference.** Judges favor their own outputs, and the bias grows with how well they recognize them. **[fact, Panickssery et al., summarization tasks]** In MT-Bench, GPT-4 favored itself by ~10% and Claude-v1 by ~25%, but the authors call this inconclusive. **[fact]**
- **Agreement ceiling.** GPT-4 vs humans: 66% with ties counted, 85% without ties. Human vs human: 63% and 81%. **[fact]** So even a good judge disagrees with a careful reader on ~1 in 6 non-tie pairs.

**Controls that work:**
1. **Swap order and require agreement.** Judge A|B and B|A, and count a win only when both agree; otherwise it's a tie. This is the MT-Bench conservative rule. Arena-Hard also judges both orders for every prompt. **[fact]**
2. **Reference-guided judging** where there is a right answer. On MT-Bench math, judge failures fell from 70% (default) to 30% (chain-of-thought) to 15% (reference-guided). **[fact]**
3. **Evidence first, verdict last** (Multiple Evidence Calibration), and average the two orders (Balanced Position Calibration). **[fact]**
4. **A panel of judges from different families** tracked humans better than a single GPT-4 judge, at about 1/7 the cost. **[fact, abstract-level]** We only have Claude judges, so the closest thing is "the judge never wrote either answer", plus a second judge used as a tiebreaker. **[guess]**
5. **Allow ties and a graded scale.** Arena-Hard uses 5 labels (A≫B, A>B, A≈B, B>A, B≫A). **[fact]**
6. **Check repetition stability before reading anything into a position effect** (judge the same pair twice). **[fact, Shi et al.]**

**Estimating judge noise (do all four; cheap):**
- **Null pairs:** Opus-medium answer vs a second independent Opus-medium answer to the same prompt. The rate of "B clearly worse" verdicts here is the false-alarm floor. Then true degradation for a cheap tier ≈ its "clearly worse" rate minus this floor. **[guess: the standard design, but no router paper reports it]**
- **Identical pairs:** the same text on both sides. Any non-tie verdict is pure position or random bias. **[guess]**
- **Test-retest:** re-judge ~10% of pairs and report the agreement rate. **[fact as a method, Shi et al.]**
- **Inter-judge agreement:** Cohen's kappa between the Fable and Opus verdicts on the same pairs. Then the owner reads ~30 of the disagreements as the gold label. **[guess]** On creative categories, Claude's blind picks have disagreed with the owner before, so owner judging matters more there.

**Recommended judge protocol (~$0.05–0.10 per case) [guess, priced from list rates]:**
- Prices: Fable 5.2 $8/$40 per MTok, Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, Haiku 5.5 $0.10/$0.50. Batch API is 50% off.
- A typical judging call is ~6k input tokens (prompt, context, two answers) and ~0.8k output tokens with thinking. That is ≈ $0.08 on Fable or ≈ $0.04 on Opus per order at list price, and half that in batch.

Steps:
1. **Checkable categories** (code that runs, a factual answer, a file-state outcome): don't use a judge. Run the check. Cost ≈ $0.
2. **Everything else: primary judge = Fable 5.2, batch, both orders** ≈ $0.08 per case. Fable wrote neither answer when we compare Opus against Sonnet or Haiku, so self-preference is avoided. Use a per-category rubric (3–5 concrete checks), require evidence before the verdict, use the 5-point scale, and tell the judge length is not a virtue.
3. **Only when the two orders disagree, or the verdict is "≫ worse"** (~25% of cases, a guess): Opus re-judges both orders in batch, ≈ +$0.04 × 0.25 ≈ +$0.01.
4. **Final label:** the cheap answer is "not worse" if both orders say ≈ or better. It is "worse" if both orders of at least one judge say worse and the other judge doesn't contradict that. Anything else is "uncertain"; keep it out of the gates and report it separately.
5. **Length check:** save both answer lengths. Once you have ~200 verdicts, fit a logistic regression of verdict on length difference (AlpacaEval LC) and report the length-controlled loss rate next to the raw one.
6. **Noise budget:** 60 null pairs + 20 identical pairs per run, ≈ $7. Re-run them whenever the judge prompt changes.

Expected ≈ $0.09 per judged case and ≈ $0 per checkable case. A mix of half and half averages ≈ $0.05. **[guess]**

## 3. Representative cases from one person's usage, kept anonymous

**Sampling [mostly guess, built on cited patterns]:**
- **Work from local logs, never send raw logs anywhere.** Follow Clio's pattern: an LLM extracts abstract facets per conversation (task type, language, tools used, files touched, turn count, outcome), clusters them, and only the clusters are viewed. **[fact for Clio's design]** For us, a local script turns each Claude Code session into facet rows: category, prompt length, context size, number of tool calls, whether tests ran, subagents spawned, model used, and whether the user corrected the result.
- **Stratify by the facets that change which tier is needed**, not by topic alone: (a) category, (b) one-shot vs multi-step agentic, (c) context size bucket, (d) whether the outcome is checkable. Sample in proportion to real frequency, **plus an oversample of rare but costly strata** (big refactors, debugging, architecture). Report both the frequency-weighted and the per-stratum numbers. This is Neyman allocation in spirit: put more samples where variance and stakes are high. **[guess]**
- **Real-shaped synthetic.** Keep the structure: length, number of constraints, file types, ambiguity, references to earlier turns. Rewrite names, paths, and domain nouns. Run a PII and secret scan on every case (a `scan_secrets` tool is available locally). Arena-Hard's BenchBuilder takes real prompts, clusters them, and filters with an LLM on 7 quality criteria (specificity, domain knowledge, complexity, problem-solving, creativity, technical accuracy, real-world application). **[fact, Arena-Hard paper]** We can use the same criteria to make sure synthetic cases aren't easier than the real ones they stand in for.
- **Watch for drift.** Compare the facet histogram of the eval set to the last 30 days of logs every month, and resample a stratum once its share moves by more than ~5 points. **[guess]**

**Agentic and multi-step tasks, where a single prompt doesn't show the work:**
- **Score the outcome, not the transcript.** Tau-bench compares the final database state to a goal state, and SWE-bench runs the repo's unit tests. **[fact]** Anthropic's agent-eval guidance combines code-based, model-based, and human graders, and it separates the transcript from the final outcome. **[fact, partly via secondary summary]**
- **Cheap fixtures:** small throwaway repos (a few files) with a failing test, a lint rule, a config to change, or a doc to update to a checklist. Each case is the repo snapshot, the prompt, and a `check.sh` that exits 0 or 1. This makes the label cost "run 3 tiers and run the check". **[guess]**
- **Randomness:** agents vary from run to run. Tau-bench's pass^k (all k runs succeed) exposed big drops: GPT-4o went from <50% pass^1 to <25% pass^8 in retail. **[fact]** Use 2–3 runs per tier per case and label with the success rate, not a single run (as in Hybrid LLM). **[guess]**
- **Count the whole bill:** spend on failed runs, the extra turns a cheap tier needs, and cache rewrites on a tier switch. TwinRouterBench gives savings credit only on passing runs. **[fact]**

## 4. Session-level and multi-turn routing evaluation

What's published (almost all 2026 preprints; I read abstracts or summaries unless noted):
- **Switch-matrix drift** (arXiv 2603.03111): one model runs the early turns and another runs the last turn, compared against a no-switch baseline, with paired episode-level bootstrap CIs. A single handoff moved Multi-IF strict success by −8 to +13 points and CoQA F1 by ±4, which is about the gap between model tiers. Some models get worse with any history another model wrote. **[fact, abstract]** Our "downgrade mid-session" action has a quality cost on top of the cheaper tier itself.
- **vLLM Semantic Router experiment** (blog, read in full): five arms (always strong, always small, protection on but gate off, gate observe-only, gate enforced) on 160 sessions / 960 calls, with thresholds frozen before looking at the holdout. Enforced switching cut strong-model turns by 31.8 points, but final-task passes fell from 32/32 to 29/32 (paired −9.4 points, 95% CI [−21.9, 0]). The gate was rejected. Separately, upgrading *before* a known hard tool step raised success from 37.5% to 100% across 8 paired seeds. Switching dropped the prefix-cache hit rate from ~81% to ~65%. **[fact]** Two takeaways: run new policies in **observe mode first** with a frozen holdout, and score the final task, not each turn.
- **MTRouter** (ACL 2026): turn-level routing under a per-episode budget, learned from logged trajectories, with fewer switches than Router-R1 at equal success. **[fact, summary-level]**
- **DialRouter** (arXiv 2604.12385): uses MCTS over the choice of LLM per turn to find trajectories with high total reward, then trains a light policy on them. In plain words, labels come from search over counterfactual continuations. **[fact, abstract]**
- **Arch-Router** scores per turn, per span (consistent route over a stretch of turns), and per whole conversation. **[fact, summary]** This is the closest published flip-flop metric.
- **Cache fact:** caches belong to one model, so every switch rebuilds the cache on the new model. **[fact, Anthropic API docs]**

Nothing I found labels the four actions we need (stay / upgrade / compact+downgrade / new session) directly. The recipe below adapts counterfactual replay to them. **[guess]**

**How to label the right action [guess]:** take a snapshot at turn t (recent prompts, todo/plan, model, effort, context size, cache state). For each action, replay the **next K real prompts** (K = 3–5) under that action, then score the final outcome (check or judge) and the total cost, including cache rebuild and compaction. The label is the cheapest action whose outcome is "not worse" than *stay on current or upgrade*. Mark the case **ambiguous** when two actions tie within the noise; the router passes on either.

**How to measure flip-flopping [guess, built on Arch-Router and vLLM-SR]:**
- Switches per 100 turns, against a target set from the owner's tolerance.
- **Reversal rate:** share of switches undone within 3 turns (A→B→A).
- **Span accuracy:** share of maximal stretches where the router keeps the right tier throughout.
- **Hysteresis test cases:** sequences where difficulty wobbles around the threshold. The correct behavior is one switch or none.
- **Cost of churn:** cache rebuild dollars spent on switches that were later reversed.

## 5. Recipe for our three suites

Sample-size math (95% CI, normal approximation; use Wilson intervals when p < 0.1): ±5 points needs n ≈ 385 at p = 0.5, 246 at p = 0.2, 139 at p = 0.1. ±10 points needs n ≈ 97 at p = 0.5, 62 at p = 0.2. **[fact: standard formula]** Compare the router against the null baseline with paired, per-question differences and clustered standard errors when several cases come from one session. **[fact, Miller 2024]**

Our 31 categories can't each get ±5% (that would take ~12k cases). Get **±5% overall** and **±10% per stratum** over **6–8 strata** grouped by what drives tier need (for example: quick Q&A, writing, small code edit, debugging, multi-file or agentic, design and architecture, creative). Keep the 31 categories as tags for diagnosis only. **[guess]**

### Suite A: per-prompt (replace the opinion labels)

- **Case schema:** `id, stratum, category_tag, prompt, context_summary, context_tokens, checkable (bool), check_ref (test/expected/fixture), rubric_id, freq_weight, source (real-shaped|synthetic), pii_scanned`.
- **Label:** for each tier × effort the router can pick, the measured P(not worse than Opus medium). Use checks where possible, otherwise the judge protocol in §2. The **needed tier** is the cheapest one with P(not worse) ≥ 0.9 (tolerance set by the owner). Cases with conflicting verdicts get 2 more samples per tier (Hybrid-LLM soft label).
- **Size:** ~400 cases (≈ 50–60 per stratum), plus 60 null pairs and 20 identical pairs.
- **Gates (the owner sets the numbers; these are suggestions):**
  1. Overall routed "worse" rate minus null "worse" rate ≤ 5 points, with the upper 95% bound ≤ 8 points.
  2. No stratum above +15 points.
  3. Length-controlled and raw results agree within 3 points.
  4. Cost ≤ X% of all-Opus-medium.
  5. Report APGR and CPT(90%) so routers can be compared.
- **Budget [guess]:** cheap-tier answers ≈ $0.01–0.03, Opus reference ≈ $0.05–0.10, judge ≈ $0.05 on average → ≈ $0.15 per case × 400 ≈ **$60**. Batch halves the generation part. Re-runs after router changes need only the judge for changed routes.

### Suite B: session

- **Case schema:** `id, window (last 5–10 prompts, each with tier used + outcome flag), todo_plan, current_model, current_effort, context_tokens, cache_age, turns_since_compact, next_K_prompts, label_action ∈ {stay, upgrade, compact_downgrade, new_session}, ambiguous_ok [list], label_source (replay|owner|opinion)`.
- **Label:** counterfactual replay as in §4 for a **core set of ~80 snapshots**. For ~120 more, use opinion labels from two LLM labelers, **calibrated** against the core set: check how often opinion matches replay on the core set and report that rate. Owner review on disagreements.
- **Sequence cases (flip-flop):** ~40 scripted sessions of 15–30 turns, each with expected decision points. These need **only router calls**, no answer generation, so they are almost free.
- **Size:** 200 snapshots gives ±7 points on wrong-action rate at p ≈ 0.2. **[computed]** That's enough to gate on the costly error classes below.
- **Cost matrix:** a missed upgrade on a hard turn costs quality, an unnecessary upgrade costs money, and a wrong downgrade costs both. Weight errors by that matrix; don't use plain accuracy.
- **Gates (suggested):**
  1. Missed "upgrade" on must-upgrade cases ≤ 5%.
  2. Wrong compact+downgrade ≤ 5%.
  3. Reversal rate ≤ 1 per 20 turns.
  4. Zero A→B→A within 3 turns on the stable sequence cases.
  5. Any new policy runs in observe mode on real sessions for a week before it is enforced (vLLM-SR lesson).
- **Budget [guess]:** 80 snapshots × 4 actions × K = 4 prompts ≈ 1,280 generations at ≈ $0.08, plus judging ≈ **$130–180**. The opinion and sequence parts cost < $20.

### Suite C: subagent

- **Case schema:** `id, agent_type, task_brief, parent_context_summary, fixture_repo, check_cmd, expected_artifact, label_tier, label_effort, pass_rate_by_tier`.
- **Label:** the TwinRouterBench approach. Run the subagent brief on Haiku, Sonnet, and Opus (2 seeds each) against a fixture with a checkable outcome. The label is the cheapest tier whose pass rate is ≥ the Opus pass rate minus the tolerance. Briefs with no checkable output (research summaries, reviews) use the §2 judge, comparing against the Opus output with a rubric built from the brief's own requirements.
- **Size:** ~150 briefs across the agent types you actually use, weighted by log frequency, with at least 15 per common type.
- **Gates (suggested):**
  1. Under-tier rate on briefs that need the strong tier ≤ 5% (TwinRouterBench found an Opus router missed 95% of these).
  2. CostSave counted on passing runs only.
  3. Parent-session success unchanged on 20 end-to-end runs.
- **Budget [guess]:** 150 × 3 tiers × 2 seeds; Haiku is negligible, Sonnet ≈ $0.10–0.30 and Opus ≈ $0.20–0.60 per agentic run → ≈ **$100–250**.

**Total first build ≈ $300–500 [guess]**, mostly one-time label creation. Later re-runs cost about the judge share only (≈ $30–60).

### What still needs testing
- The actual null-pair false-alarm rate for Fable as judge on our prompts. It decides whether the ±5 gates are reachable at all.
- Whether Fable-judge verdicts match the owner on ~30 disputed cases, especially creative ones.
- Real token sizes per case. The budgets above assume ~6k input tokens per judgment.
- Whether a mid-session switch hurts Claude models the way arXiv 2603.03111 found for others (run 30 paired handoff cases).

## Sources

- RouteLLM: https://arxiv.org/html/2406.18665v4 (ICLR: https://iclr.cc/virtual/2025/poster/30737)
- RouterBench: https://arxiv.org/html/2403.12031v2 (code: https://github.com/withmartian/routerbench)
- RouterEval: https://arxiv.org/abs/2503.10657
- FrugalGPT: https://arxiv.org/abs/2305.05176
- AutoMix: https://arxiv.org/abs/2310.12963
- Hybrid LLM: https://arxiv.org/html/2404.14618v1
- MixLLM: https://arxiv.org/html/2502.18482v1
- Arch-Router: https://arxiv.org/html/2506.16655v1
- TwinRouterBench: https://arxiv.org/html/2605.18859
- SWE-Router: https://www.alphaxiv.org/abs/2607.00053
- MasRouter (per-agent LLM routing in multi-agent systems): https://aclanthology.org/2025.acl-long.757
- MT-Bench / Chatbot Arena judge paper: https://arxiv.org/html/2306.05685v4
- LLMs are not Fair Evaluators: https://arxiv.org/abs/2305.17926
- Judging the Judges (position bias): https://arxiv.org/abs/2406.07791
- Length-Controlled AlpacaEval: https://arxiv.org/abs/2404.04475
- Arena style control: https://arena.ai/blog/style-control/ ; Arena-Hard / BenchBuilder: https://arxiv.org/abs/2406.11939 , https://arena.ai/blog/arena-hard/
- Self-preference: https://arxiv.org/html/2404.13076v1
- Panel of judges (PoLL): https://arxiv.org/abs/2404.18796
- Error bars for evals: https://arxiv.org/abs/2411.00640
- tinyBenchmarks: https://arxiv.org/abs/2402.14992
- tau-bench (pass^k, state-based grading): https://arxiv.org/abs/2406.12045
- Anthropic, Demystifying evals for AI agents: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Clio: https://arxiv.org/html/2412.13678v1
- Model-switch drift: https://arxiv.org/abs/2603.03111
- vLLM Semantic Router multi-turn switching: https://vllm-sr.ai/blog/multiturn-model-switching/
- MTRouter: https://arxiv.org/abs/2604.23530
- DialRouter: https://arxiv.org/abs/2604.12385
- Prices and cache scoping: Anthropic API reference via the bundled claude-api skill (model table cached 2026-11-03)

# Next version: plan

Written 2026-11-20, after the judge was locked to Jev, then Opus (95% right on 239 gold pairs, 93% without the easy
Kotlin test pairs). Ordered: each step decides whether the next one is worth doing.

## Why

Pairwise judging in both orders is the expensive habit. Every new tier needs new pairs, each pair two calls, and Opus
takes about half of them (on real router answers Jev is sure only about 30% of the time). Scoring each answer once
against acceptance criteria (ACs) makes adding a tier cost one score per prompt, removes order bias, and turns every
comparison (pairs, triplets, "cheapest tier within X of the best") into arithmetic on cached numbers.

Already known: the "solo" Jev variant (`calibrate/jev-variants.mjs`: each answer scored on its own against three
generic criteria) was as accurate as pairwise (Jev alone 84%). Per-category ACs are untested.

## 0. Finish the judge switch (paused 2026-11-20)

The code judges with Jev, then Opus only (`judge.mjs judge`); the old Fable judge is gone. The per-case labels in
`labels-measured/` and `results/noise.jsonl` were still made by the Fable judge, so the report keeps using them
until they are all re-judged; mixing two judges in one gate would compare unlike things.

- Done and cached in `work/eval.db` (replays for $0): the noise floor (64 resample + 22 identical pairs) and 65 cases
  (33 re-judged, 32 newly measured, filling the first six categories to 9 cases each). Spent $48.10.
- Left: re-judge the other 117 labeled cases, about $50-55:
  `EVAL_CAP_USD=55 MEASURE_LABELED=1 node measure.mjs`, then `node noise.mjs` ($0, cached), then re-score the gates.
  `MEASURE_LABELED=1` keeps the run to cases that already have labels (the first run lacked it and measured new
  cases, which also needed fresh answers from every tier).
- Optional: all 9 cases in every category (279 in total), about $150.
- New-judge noise floor, for reference: identical answers 22 of 22 "same"; Opus medium against itself 24 worse,
  25 better, 15 same of 64 (the Fable judge's floor was about 19% worse).

## 1. Acceptance criteria per category

- About 8-10 AC sets, not 31: related categories share one (code review, debugging and engineering mostly reuse the
  code set). Draft from `results/accept-checklists.jsonl` where it covers a category.
- Two kinds of criteria:
  - **Gates**, must pass: a failed gate loses regardless of the rest. Code: does what was asked; follows every
    explicit instruction; does not break what worked.
  - **Weighted quality** criteria, compared only among answers that pass the gates. Code example: follows the
    codebase's patterns (3), clear accurate names (3), small single-purpose functions with behavior kept by its data
    (2), errors handled where they can happen (2), compact with no unneeded code (1).
- Score = gates passed × weighted sum of AC probabilities.
- Each AC a concrete, checkable condition ("names say what the thing is or does", not "good naming"), per Jev's own
  guidance. Weights coarse (3 / 2 / 1), 5-7 ACs per set.
- **The owner sets the weights**; data only checks them (step 2).
- ACs, weights and thresholds live in one file, versioned together; any change means a re-check on gold pairs.

Done when: the owner has reviewed every AC set and its weights.

## 2. Test on gold pairs (about $0.05)

- Write AC sets for the gold sets too (judgebench, codegen, coderepair, testgen, smells, kotlin).
- Jev scores each answer once (all ACs in one call; Noul per AC, or Score where levels are describable).
- Compare scores in code; a gap under a margin = unsure, goes to Opus (cached verdicts exist for every pair).
- Tune margin and fitted weights on half the pairs, read the result on the other half (as `jev-variants.mjs` does).
  A fitted weight replaces the owner's only if it wins on the held-out half by more than noise.

Done when: Jev-alone accuracy and the cascade's right / wrong / sent-to-Opus are known on the test half, against
today's 84% (Jev alone) and 95% / 93% (cascade).

### Ready-made judgment tables on HuggingFace (licenses checked 2026-11-20; contents from memory, verify first)

| Dataset | License | What it holds | Use |
|---|---|---|---|
| nvidia/HelpSteer2 | CC BY 4.0 | answers rated by people 0-4 on helpfulness, correctness, coherence, complexity, verbosity | per-attribute human scores: a ready check of AC weighting, and LoRA training data |
| nvidia/HelpSteer3 | CC BY 4.0 | human preference pairs, code and multilingual included, with annotators' reasons | code gold pairs judged by people; LoRA training data |
| lmsys/mt_bench_human_judgments | CC BY 4.0 | expert pairwise votes on MT-Bench answers | more human gold pairs |
| prometheus-eval/BiGGen-Bench | CC BY-SA 4.0 | a rubric per item with scored answers | a model for writing per-category ACs; share-alike if derivatives are published |
| prometheus-eval/Feedback-Collection | CC BY 4.0 | rubric + score per answer, but written by GPT-4 | rubric examples only: not human, not gold |
| allenai/reward-bench-2 | ODC-BY | a reward-model benchmark built from several sources | a test set; each subset keeps its own source license |

Human-rated sets (HelpSteer2/3, MT-Bench judgments) are the ones that can serve as gold or as training data;
model-written ones (Feedback-Collection) only as examples. Skipped: lmsys/chatbot_arena_conversations (gated, license
unclear) and PRISM (license variant unclear).

## 3. Use it for the router's labels (if step 2 wins)

- Score every cached answer once; rebuild `labels-measured/` from the scores ("the cheapest tier that passes the gates
  and is within the margin of Opus medium").
- Keep pairwise judging as a spot-check on a sample: checklists miss quality nobody wrote down.
- Re-score every gate; report what moved.

## 4. Session labels measured by replay (the real gap)

Today the session check (64 checkpoints) and subagent briefs are tuned against two labeler models' opinions, not
against replayed, judged answers. Plan: replay each checkpoint's chain of prompts per tier, score with the AC judge,
label the cheapest tier that keeps quality over the session. Needs a cost estimate before it starts: whole chains
per tier are the expensive part.

## 5. A local judge from the Jev Decision Index

<https://huggingface.co/spaces/multimodalart/jev-decision-index> lists 326 open-weight Jev reproductions; the top ones
(karpo-decision-31B, GLiDE-27B, KnowLine-31B; 9B versions exist, e.g. GLiDE-9B) beat Jev on the index (about 74 vs
60). But none of its 53 benchmarks is answer-quality judging, so its ranking says nothing about our use.

- Before using any: check its license (Gemma-based models carry Gemma's terms, Qwen-based usually Apache), and how
  it was trained: a model trained on Jev's outputs may itself breach TypeSafe's terms §2.3(b).
- Test the top 2-3 on gold pairs and on AC items, untrained, before anything else.
- A 31B model needs 4-bit quantization on the local GPU; a 9B is easier to run and to train. Weights go to D: only.
- If one is close: train a LoRA on licensed labels only (gold sets, other licensed preference data). Never on Jev's
  verdicts (TypeSafe §2.3(b) forbids training a model to imitate them); training on Claude's verdicts needs a check
  of Anthropic's terms first. Keep the gold pairs out of training: they are the test.
- Backup judge for the rare unsure cases: whichever measures best then. Today that is Opus; Fable high was no more
  accurate and about 3x the cost, Fable medium netted +1 pair of 80 at about 3x the cost.

## Smaller items

- **Spend cap overshoot**: the cap blocks new calls but calls already in flight still finish (a $5 cap recorded
  $6.25). Reserve the expected cost of a call before it starts, or lower concurrency near the cap.
- **Parquet**: the store is SQLite (`work/eval.db`, built into Node, no dependency). Add a Parquet export only if
  the data is wanted in outside tools.
- `calibrate/run.mjs` writes "Spend this run $0.00" when replayed without `EVAL_OFFLINE`; harmless.

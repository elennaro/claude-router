# Router evals

Four suites test the router's decisions against labeled cases, through `claude -p` on a subscription. All of them run the plugin's own code (`router/hooks/policy.ts`) on its **built-in** config. To test a candidate config, set `EVAL_ROUTING=<file>`; the machine's own `~/.claude/routing.json` is never read.

| Suite | What it decides | Cases | Run (from `evals/`) |
|---|---|---|---|
| Per prompt | the turn's class, model and effort | `cases/` (31 categories), measured labels in `labels-measured/` | `node run-classifier.mjs`, `node measure.mjs` (quality of routed-down tiers), `node report.mjs` |
| Session check | offer a switch up or down mid-session | `session/cases/` (64 cases, 10 sequences) | `node session/run.mjs`, `node session/report.mjs` |
| Subagents | a subagent's model and effort from its type or brief | `subagents/cases.jsonl` (40 briefs) | `node subagents/run.mjs`, `node subagents/report.mjs` |
| Tool loop | whether Haiku can do its jobs: find, count, run and report, and a tiny self-contained edit | `toolloop/tasks.mjs` (12 tasks on a seeded synthetic repo, real tools, exact checks, no judge) | `node toolloop/checks.test.mjs`, `node toolloop/run.mjs`, `node toolloop/report.mjs` |
| Big pastes | whether the cheaper model's analysis alone carries what the request needs (the plugin's own paste prompt and model choice) | `paste/run.mjs` (6 synthetic pastes, 12K to 70K tokens, facts planted at seeded places, exact string checks, no judge). Gate: 90% of facts kept on each model, every analysis keeps its headings | `node paste/run.mjs --test`, then `node docker.mjs paste/run.mjs` |

**Docker runs.** `node docker.mjs --check` (free) builds a clean Linux image (`docker/Dockerfile`: Node 22, Claude Code, the repo, nothing from your machine) and runs the engine tests, validate, the db check, the eval self-checks and the offline replay, each in a fresh container. `node docker.mjs <suite.mjs>` runs a paid suite the same way, billed to the platform API key in `ROUTER_EVAL_API_KEY` from your shell (its own name, so Claude Code on your machine never bills it; the container gets it as `ANTHROPIC_API_KEY`) (passed by name, never written to the image or a log), not the subscription. Only `evals/work` is mounted, so the store still pays each answer once. The cap is `EVAL_CAP_USD` (default $10 here, refused above $50).

Haiku writes code only as a self-contained edit of about 10 lines that nothing else uses (a private helper, a one-off script). Renames and any change that reaches other files are `scoped-code`. The tool-loop suite keeps one such change (`rename`) as a control.

Labels: the **needed tier** is the cheapest model and effort that keeps top quality. Per prompt, it is measured by replay (`measure.mjs`): candidate answers judged against Opus medium in both orders by the one judge (Jev where sure, else Opus; `judge.mjs judge`). The labels committed now were made by the earlier Fable judge; re-judging them is step 0 of `docs/NEXT-VERSION.md`. A deciding verdict (a cheaper tier worse, Opus high better) is confirmed on a second, independent answer and stands only if the repeat agrees: one judgment flips about 19% of the time, two agreeing ones by chance about 4%. The session and subagent labels come from two labelers (Opus high, Fable high). Where they disagree, Fable's label wins, except production-code investigation, where the stronger label wins. Each run spends at most `EVAL_CAP_USD` (default $5, counted for that run only); `work/spend.jsonl` keeps every call.

## Acceptance criteria (release gates)

A release ships only when every **hard** gate passes on the built-in config. **Targets** are where the cost win is: they are tracked every run, and a miss is reported but does not block a release.

### Engineering (hard)

| Gate | Pass |
|---|---|
| `claude plugin test router` | all pass |
| `node router/tests/db.check.mjs` | ok |
| `claude plugin validate router` | passes |
| Mutation check on changed logic (break it, a test fails) | every mutation caught |
| Clean install from the marketplace into an empty config | loads, routes a prompt, writes `router.db` |
| Anonymity: term scan of every published file, model audit of every eval case | 0 hits, all cases pass |

### Per prompt (measured labels, 3 runs per case)

| Gate | Meaning | Pass | |
|---|---|---|---|
| Floor downgrades | a floor class routed below the main default | 0 | hard |
| Production-code investigation below Opus high | debugging, code review, security review of production code | 0 | hard |
| False cheap | any of 3 runs below the needed tier | <= 3% | hard |
| Quality kept, noise-relative | on cases routed below Opus medium, from their measured replays: judged "worse" rate <= the noise rate + 5 points (noise: Opus medium vs itself, 19% worse), and worse minus better <= +5 points | both | hard |
| Unstable | runs disagree on the tier | <= 15% | target |
| False dear | 2 of 3 runs dearer than needed | <= 30% | target |
| Cost | spend vs all-Opus-medium on the same cases | report | target |

Tier match is reported, not gated: with labels this noisy (one judge verdict flips about 20% of the time), an exact-match gate measures the labels more than the router.

### Session check

| Gate | Meaning | Pass | |
|---|---|---|---|
| False downgrade | an offer below the gold model | <= 3% | hard |
| Flips | A->B->A in the router's path beyond gold's own | 0 | hard |
| Proposal precision | offers with the gold action and model / all offers | >= 85% | hard |
| Missed upgrade | gold says up, no up offered | <= 20% | hard |
| Needless offers on "stay" cases | an offer where gold says stay | <= 5% | target |

Missed upgrade was 10% in the first draft. It is set to 20% because an upgrade offer needs 2 of 3 Haiku samples to agree, and one case is about 1.2 points.

### Subagents

| Gate | Meaning | Pass | |
|---|---|---|---|
| False cheap | any of 3 runs below the needed tier (Fable needs count as Opus at that effort: subagents have no Fable button) | <= 3% | hard |
| Production-code investigation below Opus high | as above | 0 | hard |
| Unstable | briefs whose runs got different tiers | <= 15% | target |
| Moved | runs that left the parent's model | report | target |

### Tool loop

| Gate | Meaning | Pass | |
|---|---|---|---|
| Haiku on explore tasks | pass rate within 5 points of Opus medium (3 runs per task) | yes | hard: else `explore` leaves Haiku |
| Haiku on tiny edits | pass rate within 5 points of Opus medium | yes | hard: else `mechanical` code leaves Haiku |
| Rename control | pass rates per tier | report | target |

## The store and the fast loop

Every model output an eval has paid for (answers, judge verdicts, Jev and Haiku replies) lives in one SQLite file,
`work/eval.db` (gitignored). A run reads it first and asks a model only for what is missing; each output is paid once.

```
node fast.mjs               # all suites replayed from the store, every gate, $0 (EVAL_OFFLINE=1: a miss fails, never pays)
```

Free to change and re-score with `fast.mjs`: the class table's models and efforts, rules, thresholds, effort logic,
report gates. Paid once, then free: a change to the classifier's words or labels (run the suite without EVAL_OFFLINE;
only the changed prompts are asked), and new cases.

An offline miss stops the run, like the spend cap, so `fast.mjs` fails and names the missing call instead of
scoring it as "the classifier failed". The usual cause: a policy change that alters what a model is shown. The
session check's prompt includes the last class, so a change to how classes are read needs a small paid session run.

The measurements replay too. `EVAL_OFFLINE=1 MEASURE_OUT=<file> SAMPLES=3 node measure-class.mjs` rebuilds the
per-class judgments from the store (checked: 663 of 663 identical, $0), and `EVAL_OFFLINE=1 node calibrate/run.mjs`
rebuilds the judge calibration. So a new judge, threshold or scoring rule over the same answers costs only its own
new calls. Two things do not replay: tool-loop runs (a run edits a throwaway repo, so only its checked result in
`results/toolloop.jsonl` is kept; changing a check means re-running), and the first per-case Fable labels, made before
the store existed (only their verdicts survive). Neither feeds a hard gate now.

Quality is scored from `results/class-measure.jsonl` (`measure-class.mjs`): each case's tiers judged against Opus
medium, with a null pair (Opus medium against itself) showing what "no difference" looks like. The router's pick on a
case gets that tier's score on the case, else the tier's pooled score.

## Judge calibration

The judges are checked on gold pairs where the better answer is known without asking a model (public data only, so
outside services such as Jev may see it): JudgeBench (MIT), CodeJudgeBench (codegen, repair, test writing;
Apache-2.0), Java code smells rated by professional developers (MLCQ, CC BY 4.0: a method or class every reviewer
rated major or critical against one every reviewer rated clean; code fetched from Apache projects at the rated commit),
idiomatic Kotlin against a Java-style rewrite, and Kotlin HumanEval answers with one hidden bug that the task's own tests
catch (needs `kotlinc` and `java`; Apache-2.0). Every judge call is cached on disk, so a re-run is free. MLCQ replaced
human-rated Java readability (se2p/code-readability-merged) on 2026-11-20, because that set states no license.

Result (2026-11-20, 239 pairs; in brackets the 95% interval, the range the true rate likely falls in):

| Judge | All 239 pairs | Without the 105 easy Kotlin test pairs | Code smells (44) |
|---|---|---|---|
| Production (Fable + Opus split) | 95% (91-97) | 92% (86-95) | 82% (68-90) |
| Opus, both orders | 95% (91-97) | 92% (86-95) | 84% (71-92) |
| Jev, both orders | 84% (78-88) | 72% (64-79) | 70% (56-82) |
| **Cascade: Jev if at least 0.8 sure, else Opus** | 95% (92-97) | 93% (87-96) | 86% (73-94) |
| Share the cascade sends to Opus | 33% | 53% | 43% |

The honest headline is the middle column: about 92% right on pairs that are not trivial. The "all" figure is lifted
by the Kotlin test pairs, which every judge gets nearly all right. Design judgment (code smells) is the weak spot for
every judge. The cascade (Jev where it is at least 0.8 sure, else Opus) is 95% right on all pairs at 15% of the
production judge's cost.

Tried to push the cascade to 97% (2026-11-20, tuned on half the pairs, read on the other half), and none of it helped:
- **Jev questions** (`calibrate/jev-variants.mjs`, $0.04): a sharper pairwise question with a "same" exit, and scoring
  each answer on its own (correct, complete, craft) so order cannot matter. Every variant tops out at the same rate:
  on the pairs Jev hands over, Opus's own accuracy is the limit. Jev alone is 84% under every wording.
- **Thresholds**: higher thresholds only send more pairs to Opus; where Jev is sure and wrong, Opus is wrong too.
- **Opus prompt** (`calibrate/opus-variant.mjs`, $8.43 for 64 of the 80 pairs Jev hands over): work out the right
  answer first, then compare, and weigh maintainability for code. One pair fixed, two made worse: no gain.
- **Ties to Jev's lean**: reaches 97% on gold pairs, because gold pairs always have a winner, but on real router
  answers it turns 24 of 28 correct "same" verdicts (Opus medium against itself) into invented wins and losses.

What blocks 97%: 5 of the 11 misses are pairs where Jev, Opus and Fable all prefer the "worse" answer, mostly MLCQ
data classes and JudgeBench; the gold label there is debatable. So the current question and prompt stay.

```
node calibrate/gold.mjs          # public pairs -> work/gold/pairs.jsonl
node calibrate/kotlin.mjs        # Kotlin test-checked pairs (kotlinc), added to the same file
node calibrate/run.mjs           # production judge, Opus alone, Jev, and the Jev cascade -> results/calibration.md
node calibrate/jev-variants.mjs  # Jev question variants in the cascade -> results/jev-variants.md
node calibrate/opus-variant.mjs  # the Opus prompt variant -> results/opus-variant.md
```

Jev needs `TYPESAFE_API_KEY` in the environment.

## Reading the numbers

One case is about 1-1.5 points. A gate missed by less than one case is re-run once before it counts as a fail. Reports list every failing case with its runs, so a fix can go after the cause, not the number.

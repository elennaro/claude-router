# Lessons log: calibrating a model router

Right and wrong moves made while building and calibrating the router's evals, kept as raw material for an article.
Newest at the bottom. Each entry: what we did, what happened, what we learned. No private data here.

## Wrong moves

1. **Tuning the table to the eval, one failure at a time.** Each failing case got a rule tweak or a class move. The
   numbers improved; the router didn't get more right. Lesson: when every fix is local, you are fitting noise. Stop and
   audit the measuring stick before touching the thing measured.
2. **Gates a do-nothing router passes.** "False cheap ≤ 3%" with a one-step effort slack, plus quality checked only on
   cases routed down, meant "always send Opus medium" passed every hard gate. Lesson: run the trivial baseline through
   your gates first. If it passes, the gates measure nothing. Fix: a savings gate the baseline fails by definition.
3. **Effort slack that hid errors.** Counting one effort step below the need as a "match" hid most false cheap cases
   (1.1% with slack, 14.7% strict). Lesson: slack belongs on the side whose errors are cheap (false dear), never on the
   side that costs quality.
4. **Comparing confirmed verdicts with an unconfirmed noise rate.** The quality gate used settled (repeated) verdicts
   but compared them with a single-judgment noise floor. Lesson: compare like with like: same judge, same number of
   judgments, same "uncertain" rule on both sides.
5. **Confirming only the expensive verdicts.** "Worse" going down and "better" going up were repeated; "same" never
   was. Every unconfirmed verdict pointed to the cheaper tier, so labels leaned cheap. Lesson: a confirmation rule must
   be symmetric, or it is a bias.
6. **A tie shortcut that leaned cheap.** "A tie plus a slight lean counts as same" decided 26% of all judgments without
   a tie-breaker, and "same" always means "the cheaper tier is enough". Lesson: every shortcut in a judge has a
   direction; find it.
7. **Per-case labels from one sample per tier.** Our own research notes (Hybrid LLM) warned that one sample gives a
   hard 0/1 label dominated by the model's own randomness. We did it anyway. Two Opus medium answers to the same prompt
   were judged different 70% of the time. Lesson: read your research notes before the expensive run, not after.
8. **Blaming the judge before measuring it.** The 35%/35% split looked like a broken judge. It wasn't (see right move
   4). Lesson: when a measurement is noisy, find out which part is noisy before replacing parts.
9. **Keying the production rule on category.** "Investigation of production code needs Opus high" was checked only on
   the debugging/review categories; a production log read filed under long-read escaped it. Lesson: label the property
   the rule is about (is this production work?), not a proxy for it.
10. **Eval runners drifting from the plugin.** The classifier runner had its own copy of classify(), and the runners
    ignored per-project config. Lesson: evals must call the shipped functions, never a re-implementation.
11. **Costing the cascade from the gold pairs.** On the clear-cut gold pairs, Jev was sure 68% of the time; on real,
    open-ended cases only 31%. So Opus judged most pairs, and a judgment cost about twice the estimate. Lesson: measure
    the escalation rate on a small sample of the real workload before budgeting a big run.
12. **Re-asking the classifier for every policy tweak.** Until the store existed, scoring a change to the class table
    re-ran Haiku on every case, though the table never reaches Haiku's prompt. Lesson: separate what a model sees from
    what your code decides afterwards; cache the first, and the second is free to tune.
13. **Expecting wording to fix uncertainty.** Sharpening the classifier's debugging line ($0.51) moved production
    misses from 5 to 6: one fixed, two new ones on a single run of three, which is Haiku's sampling noise. The misses
    were prompts where Haiku is unsure, and better words don't make an ambiguous prompt clear. Because both wordings
    were cached, going back was free. Lesson: before paying for a prompt change, check whether the misses are wrong
    answers (wording can help) or unsure ones (it can't).
14. **Pinning effort on classes that match the default.** Eleven classes said "Opus medium" outright, which was also
    the default. A production repo that raised its default to Opus high still got medium on those classes, and rules
    that lift a class to the default never fired because the class already "was" the default. Lesson: a value that
    only repeats the default should be left out, so it follows the default when someone changes it.
15. **An offline mode that failed quietly.** The runners caught any classifier error as "Haiku failed, keep the
    earlier class", and that catch also swallowed the offline miss (and, through an `e.name` check that never matched
    a subclass, the spend cap). A change that altered the session check's prompt replayed "for free" and scored 4
    fewer upgrades, purely from missing data. Lesson: in a replay, a miss must stop the run; a fallback written for
    real failures turns missing data into a plausible, wrong number.

## Right moves

1. **Asking for an independent audit of our own work** once the owner pushed back. It found the gate, slack and
   confirmation biases in one pass.
2. **A null baseline.** Opus medium against a second Opus medium answer, plus identical pairs, under the same judge.
   Identical pairs: 16/16 "same", so the judge was consistent. Resampled pairs: the spread came from the answers.
3. **Pooling per tier pair.** Pooled over 150 cases, noise cancelled to 0% net, and the signal was clear: Opus high
   29% net better than Opus medium, Sonnet high 38% worse, Haiku 33% worse in chat (±11–23).
4. **Calibrating the judge on gold pairs** where the better answer is known without a model: JudgeBench,
   CodeJudgeBench, human-rated Java readability, idiomatic Kotlin against a Java-style rewrite, and Kotlin with one
   hidden bug that the task's own tests catch. Result: the production judge and Opus alone both 97% right with 1–2%
   order flips; Jev 88%, strong on style, weak on hard code and reasoning.
5. **Test-verified hidden bugs** when the benchmark was too easy (Haiku passed 176 of 180 Kotlin HumanEval answers):
   a model plants one realistic bug, and the pair counts only if the real tests catch it. 105 hard gold pairs for
   about a dollar.
6. **A cheap-first cascade, set on data.** Jev decides when sure (≥ 0.8), Opus takes the rest: 97% right at 14% of the
   production judge's cost. On the hard sets alone it matched Opus exactly while skipping a third of the Opus calls.
7. **Caching everything the models produce or decide**, in one SQLite store: answers per case, tier and seed;
   judgments and classifier replies per prompt hash (plus a sample id, so deliberate repeat samples stay distinct).
   Re-running a judge or a report costs nothing, so trying a new judge pays only for itself. An offline mode turns a
   cache miss into an error, so the tuning loop can never spend by accident. Lesson learned late: this should have
   been there from the first paid run; before it, every policy tweak re-asked Haiku.
8. **Spend caps on every paid run**, and round-robin job order so a cap leaves every category covered.
9. **Tool loops measured with exact checks, no judge.** A seeded synthetic repo with 12 tasks showed Haiku is fine for
   lookups and tiny edits inside tool loops, even though it loses in chat answers.
10. **A fast offline loop.** All suites replay from the store in under two seconds for $0, so a rule change is scored
    across every gate before it is kept. First use: three rules (a log or trace read for what broke, a PR link, a
    secret in a public variable) cut production investigations sent below Opus high from 11 to 5, with no cost to the
    measured quality.
11. **Keeping private data out of outside services.** Only public datasets went to the non-Anthropic judge during
    calibration; the owner's mined prompts stay on Anthropic models unless the owner says otherwise.
12. **Proving the cache, not trusting it.** Every measurement was rebuilt offline into a scratch file and compared with
    the paid one: 663 of 663 per-class judgments identical, judge calibration identical, $0. Lesson: a cache you haven't
    replayed end to end is a hope; one replay shows which outputs are missing (here: tool-loop runs, which act on a
    repo and can't be replayed from text).
13. **Reading the classifier's doubt by direction.** Three of the last five production misses were Haiku answering
    "debugging" every time, but at 0.4–0.6, under the 0.7 cut, so the turn fell to the default. An unsure answer that
    names an investigation class now still counts from 0.5, because it can only raise the turn; unsure answers that
    would lower it still count for nothing. With four narrow rules (build warnings, a list that skips items, numbers
    that are off, proving what a source file does), misses went from 5 to 0 and measured quality from +13.9% to
    +15.6%, at 130% of Opus-medium spend, all scored offline for $0.
14. **Letting the data change the pitch.** The router was built to save money. Measured, every cheaper tier lost on
    chat answers, and a variant that put four Opus-high classes back to medium saved only 10 points of spend (1.3× to
    1.2×) while sending 10 production bug reports below Opus high. The owner kept the quality-first table and the
    README now says what it buys: better answers for more spend, not savings. Lesson: when the evals contradict the
    product's promise, change the promise, not the evals.

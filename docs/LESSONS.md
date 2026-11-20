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
16. **Measuring savings against a fixed model.** The spend report priced every step "as if on Opus medium". A chat
    the person had set to Sonnet showed a large saving the router never made, a turn raised from medium to high cost
    nothing extra, and a turn moved to Haiku was charged a full Opus cache write that a warm Opus cache would have
    read cheaply. Netting everything into one "saved" number also hid the extra spend behind cheap subagents. Lesson:
    compare against what would have run with the router off (the asked model and effort), and keep saved and extra
    spend apart.
17. **Keywords in two languages.** The rules carried Russian words next to the English ones, because the first eval
    cases were written in both. A user in any third language got worse routing than a Russian speaker, and the eval
    looked better than the product was. Removing them moved 3 Russian production prompts (of 279) from Opus high to the
    default, which no change to the classifier's wording fixed. Lesson: keep hand rules in one language and let the
    classifier read the rest; measure the gap and document the fix (here, a production project sets its default to
    Opus high) instead of hiding it.
18. **Spending a capped eval on the baseline first.** The acceptance eval graded every tier on all 288 cases, tier by
    tier, so the Opus medium baseline took $35 of the $43 cap and the tier being decided got 20 cases. Lesson: under a
    cap, choose the cases the decision needs first and run the tiers in pairs on them.
19. **Pricing from a table instead of from the bill.** The spend code used one cache-write price (5-minute, 1.25x),
    but Claude Code's main thread writes 1-hour entries (2x). Every session's spend read 4-14% low, and nobody noticed
    because nothing compared the ledger with an outside record. Lesson: check money code against an independent count
    (here, the app's own transcripts) before quoting any total.
20. **Claims rounded up in the notes.** "Sonnet was accepted on every case Opus was" was written in a comment and in
    these notes; the counts per class were equal, the cases were not (one explore case each way). Lesson: write the
    number you measured, not the sentence it suggests.
21. **Chasing a boundary with wording.** The unhappy check went through four wordings in an hour ($0.16): complaints
    caught 100/83/93/94%, false alarms 15/6/17/14%. Each wording traded one error for the other, and the second one
    quoted two eval cases word for word as its examples, which would have flattered the score. The errors sat on one
    real boundary (is "I meant X" a fix of my words or of the assistant's guess?), and Haiku's answer there flips
    between runs. Lesson: once two wordings swing the same cases back and forth, stop tuning and hand the trade-off to
    the owner; never use an eval case as a prompt example.
22. **Fixing the owner's rule instead of following it.** "Darker means more effort" failed the dark-theme check, so
    effort quietly became "color strength" (lighter on a dark page). The owner meant darker, full stop, and had to say
    it twice. The rule could have been kept, with a light edge on the dark steps for contrast. Lesson: when a stated
    rule fails a check, keep the rule and fix what fails, or ask; don't swap in a different rule.

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
   order flips; Jev 88%, strong on style, weak on hard code and reasoning. (Rerun 2026-11-20 with MLCQ code smells in place of the readability set: 95% overall; smells are the hardest set, 70-75% right for every judge; the cascade keeps 95% at 14% of the cost.)
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
15. **Measuring effort's price instead of guessing it.** Effort changes how many tokens a model writes, not its
    price per token. `evals/effort-cost.mjs` reads the replay store's paid runs: Opus high wrote 1.40x the output of
    medium (n=158), low 0.72x. The spend report scales output by those factors, so a raised effort shows as extra.
16. **Grading each answer alone against the person's checklist.** The side-by-side judge picked a side even between
    two Opus medium answers, so every cheaper tier looked worse. A checklist written from the request only, and a
    grader that sees one answer and no model name, asks the question that matters: would the person accept this as
    done? In messages, mechanical edits, lookups, long reads, data and tests, Sonnet medium was accepted as often as
    Opus medium (same count per class; 75 cases in all, about $5), so those chats now start on Sonnet. Lesson: measure "good enough", not "as
    good as".
17. **Owner cases expose class edges.** "Write a simple email" was read as final copy and offered Fable, because
    every final-copy case in the eval was public copy and none was a note to one person. A new `message` class with no
    keywords, and four cases like it, fixed it in every language. Lesson: when the owner says a pick is wrong, add the
    case first, then look for the missing neighbour class.
18. **Two independent checks of the savings.** A script re-counted every session's spend from Claude Code's own
    transcripts with separate price code; a second model reviewed the accounting code without seeing our conclusions.
    The script found the cache price and a day of double counting (two router copies loaded); the review found four
    logic bugs (warm-cache credit, effort scaling, nested agents, re-spawns) and a routing bug. Neither would have
    found the other's. Lesson: verify money twice, once against data and once against the code.
19. **Checking colors with a script, in both themes.** The model palette went through a validator (lightness band,
    chroma, color-blind separation, contrast) before any chart used it. It failed the first teal (it read grey) and
    its distance to the green. The effort ramps then failed in dark mode: "darker means more effort" made low and high
    both dark on a dark page. Effort became color strength (fade for low, away from the page for high), checked per
    ramp. Lesson: a rule stated for one theme needs its own check in the other. (Then undone: see wrong move 22.)
20. **Making one error cheap instead of rare.** The unhappy check misread about one calm reply in ten, and no wording
    fixed it. The owner changed what a reading does: the first unhappy reply in a task acts on nothing, the second
    raises effort. A false raise now needs two misreads in one task (about 1%), while a real struggle still gets help
    by its second complaint (89%). Lesson: when a classifier's error rate won't move, change the action so a single
    error costs nothing.

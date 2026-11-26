# Article notes: building and measuring a model router

Raw material for an article. The story in order, what each step taught, and how to check the savings claim with
real usage. Per-move detail is in [LESSONS.md](LESSONS.md); the numbers come from `evals/results/` and the ledger.

## The story in order

1. **A local mod (0.1-0.3).** The router started as a Claude Code mod: keyword rules picked an effort per turn, and a
   JSON file kept the spend. The goal was saving money while working on Opus.
2. **A plugin with evals (0.4.0).** Moved to its own repo as a plugin, with 279 real-work eval cases mined from the
   owner's own prompts, labelers, a judge calibrated on gold pairs, a null baseline (Opus medium against itself) and
   hard release gates. The first honest finding: the gates passed a router that did nothing (wrong move 2).
3. **The pitch flipped.** Judged side by side, every cheaper tier lost on chat answers, so the router became
   quality-first: Opus high where it pays, about 1.2-1.3x the spend of always Opus medium, answers about 15% better.
   The README changed its promise instead of bending the evals (right move 14).
4. **Honest spend (0.5.0).** Savings were measured against a fixed "Opus medium" price, which booked savings the
   router never made. Changed to "no router": the model and effort each request asked for, at the same tokens, with
   saved and extra spend kept apart (wrong move 16).
5. **Where Sonnet fits (0.6.0).** The owner asked why Sonnet had no place. Diagnosis: the side-by-side judge picks a
   side even between two equal answers. A new acceptance eval grades each answer alone against a checklist written
   from the request. Sonnet medium was accepted as often as Opus medium on messages, mechanical edits, lookups, long
   reads, data and tests, so those chats now start on Sonnet; subagents on defined tasks go to Sonnet high (right
   move 16). An owner case ("a simple email" offered Fable) added a `message` class (right move 17). Keyword rules
   became English-only (wrong move 17).
6. **Auditing the savings (0.6.1).** A transcript cross-check and an independent code review found the spend math off
   in several places; see below.
7. **Seeing where the money goes (0.7.0).** The owner asked for the numbers to be readable at a glance: one color per
   model (Opus in Claude's clay, Fable ruby, Sonnet teal, Haiku green), effort as shade, a band of the chat's spend by
   model, cost per turn as bars up or down from "no router", and the cache hit, now logged per step. The palette was
   checked with a script, not by eye: the first teal read grey and sat too close to the green, and "darker means more
   effort" broke on a dark page, where low and high both went dark. Effort became color strength for a while, but
   the owner wanted darker = more effort everywhere: it went back to darkness, with wider steps and a faint light
   edge on the dark steps in dark mode (wrong move 22). The router also stopped forgetting moved subagents after a
   restart.
8. **When the person is unhappy (0.7.0).** The owner pointed out a missing signal: "it's still broken" should raise
   the work, not repeat it at the same level. The owner turned down a word list ("Haiku has to understand the
   context"). One Haiku sample reads the request, the end of the answer and the next prompt. A new 44-exchange eval
   (complaints in five languages, clarifications, next steps, new tasks) scored four wordings for $0.16 in all:
   complaints caught 100 / 83 / 93 / 94%, false alarms 15 / 6 / 17 / 14%, all of one shape, "I meant X" after the
   assistant guessed wrong (wrong move 21). The owner fixed it in the design, not the prompt: the first unhappy reply
   does nothing, the second raises effort a step, the fourth raises again and offers the next model up; and the label
   became "clearly and strongly unsatisfied", with "sorry / my bad / I mean" never counting. Result ($0.04): 94% of
   complaints caught, 10.6% of calm replies misread, so about 1% of tasks get a raise they didn't need (right move 20).
9. **Cache-aware token economy (0.8.0 to 0.8.4).** The owner reframed the goal: not the cheapest model, but the
   cheapest path once the prompt cache is counted. Effort changes keep the cache, a model switch rebuilds it, and an
   hour idle loses it. So the router now changes effort freely and moves the model only when the rebuild pays back.
   New features came from one replay of two weeks of transcripts: big pastes read first by a cheaper model, sized
   reader and researcher subagents, keep awake (a hidden nudge every 50 minutes; resumes after an hour idle were about
   a fifth of all spend), and a per-chat *Compact at* point (a 300K window would have cut main-chat spend by about 7%).
   The first replay overstated everything about five times (wrong move 23).
10. **Settling the cache features (0.8.5 to 0.8.8).** A *Compact at* slider up to the model's limit, coloured green
   at the cheapest point and red where compactions get too frequent or dear, which can write the point into Claude
   Code's settings. A UI kit with its own checks (text fit, contrast, overlap at three widths, both themes) that every
   surface now passes. Keep awake learned to stop: a chat that is clearly finished gets no nudge (one Haiku read of the
   last exchange), and once 20 idle stretches have closed, the router knows how likely people are to come back at each
   hour of the day and nudges only while the expected saving beats the nudges' cost (backward induction over the
   nudges left; a rebuild costs about 40 reads on Opus and Sonnet, 80 on Fable). Learned from the machine's own use,
   not from the author's hours. Also: keep awake off for one chat, routing turned on in one session reaches the others
   within about 10 seconds, and a units switch shows savings as a share of the plan's weekly limit, priced from what
   this machine spent per point this week.
11. **The +$30 that read as a saving (2026-11-25).** The owner saw the Board say "+$33" for a week and "+$22" for
   the month around it, read both as savings, and concluded the math was broken. The figures were net overspend: the
   router had spent more than no router that week, and the day before it had saved a little. The math held up
   against Claude Code's own transcripts (2% apart over 8 days); the display didn't. The Board now says "saved $x" or
   "$x extra" in words, like the band (wrong move 24). The same check showed the real result for the article below.
12. **Recording why each effort was chosen (0.8.9, 0.9.0, 2026-11-25).** An independent review of the new
   keep-awake and units code found five real bugs. The worst: plan % read up to 9x low on the day the week reset,
   because the ledger counts whole days and the week starts at a clock time. The fix uses the ledger's total when
   the new window is first seen as the week's zero. Then the owner pointed at the bigger gap: effort is the router's
   main lever, yet the ledger kept no effort, so the $96 of extra spend could not be traced. 0.9.0 adds an `efforts`
   table (effort, no-router effort, class, and why: class, unhappy, pick, asked, agent, nudge, as-is). The ledger
   also trims itself: effort detail after 60 days, the rest after 400.
13. **Labelled data, and stepping aside (0.9.1, 2026-11-26).** The owner's plan, first half: an opt-in *Training*
   switch logs each switch the router makes (model, effort, quick turn, subagent) to the ledger, with no prompt text,
   and the **Switches** list rates each 👍 or 👎; 👎 goes back like Undo, with a toast when going back costs a cache
   rebuild over $0.10. Same release: a prompt with "ultrathink" or "ultracode", and every workflow agent, runs exactly
   as asked; the router only measures. The owner's reasoning: someone who writes ultrathink has already decided.
   Later, labels read from the person's replies instead of buttons.
14. **Next: a local classifier.** The "Jev decision index" models turned out to be 25-31B, far from CPU-sized. The plan
   (`docs/PLAN-classifier.md`) is multilingual-e5-small (118M parameters, MIT, multilingual) with a small trained
   layer on top, data from public sets plus Haiku labels, never the eval cases. First measurement, int8 in Node on a
   desktop CPU: 3 ms for a short prompt and 13 ms for a paragraph once loaded, but about 1 s for a fresh process, 850 MB
   of memory to keep it loaded, and a 379 MB runtime install. Whether the runtime cost is worth it is the next decision.

## How the savings are measured

- **Spent:** each model step's tokens at list price. Main-chat cache writes are 1-hour entries (2x input), subagent
  writes 5-minute ones (1.25x); Haiku past 100K prompt tokens costs 5x on every side.
- **No router:** the same step on the model and effort it would have used with the router off (the chat's model, the
  person's own picks, "use X" in the prompt, a subagent's parent model before any routing). Effort is priced by its
  measured cost ratio (high 1.4x medium, low 0.72x). A step moved to another model gets credit, once, for the cache
  the original model already held.
- **Saved / extra:** per step, the part below the no-router cost is saved, the part above is extra. The router's own
  Haiku calls are all extra. A subagent run that a re-spawn replaced counts as saving nothing.

## What the 0.6.1 audit found (2026-11-19)

Proved, with the data or a traced code path:

| Problem | Effect on "saved" | Size seen |
|---|---|---|
| 1-hour cache writes priced as 5-minute ones | spend shown about 7-15% too low | the steady gap in every session |
| Haiku past 100K: output not at 5x | Haiku moves look cheaper than they are | small |
| Warm-cache credit given on every moved step, not once | savings understated | about 60% of a moved step's saving |
| Effort ratio (measured on whole cost) applied to output only | effort savings and extra about halved | per effort change |
| A nested subagent compared with its parent's routed model | savings understated | per nested agent |
| A re-spawn kept the first run's saving | savings overstated | about one run's baseline per re-spawn |
| "use opus" on an Opus chat could still move a quick turn to Haiku | routing bug, not just accounting | rare |
| Two router copies loaded on 2026-11-18 (mod and plugin) | that day's steps counted twice | about 1.8x for that day |

How each was found: the transcript cross-check (`router/bin/check-savings.mjs`) showed the gaps; a second model,
given only the code, traced the logic bugs; every fix has a test and a mutation check.

Known limits, not fixed:

- Compaction and other forks are booked as "as asked" (no saving, no extra) even when the chat runs on Sonnet.
- Fixed in 0.7.0: a restart forgot which subagents were moved, so a resumed one was booked as asked. The memory is now
  kept per session in the plugin store; a chat resumed after more than 30 newer sessions still loses it.
- Ledger rows from before 0.6.1 carry the old prices; rows from 2026-11-18 are partly doubled. Measure from the day
  0.6.1 is in use.

## Checking the savings after a few days

1. Note the date 0.6.1 went in (the app restart after 2026-11-19). Measure from then.
2. Run `node router/bin/check-savings.mjs <that date>` (from the repo, or the plugin's folder).
   - **Ledger vs transcript spend:** should now agree within a few percent per session. Before the fix the gap was
     -4% to -14%. If a session is far off, look at that session first: missed or doubled steps.
   - **No router, saved, extra:** the router's claim. Write down the totals.
3. Open Board in Claude (Router → Board) for the same window: spend by model shows how much moved to Sonnet and Haiku,
   and the cache hit (from 0.7.0 on) shows whether moves cost cache: a model switch starts a cold cache.
4. Spot-check one chat by hand: pick a chat the router started on Sonnet, take one step's tokens from its transcript,
   and price it both ways with the pricing page. It should match the ledger's two numbers.
5. Record for the article: days measured, sessions, spend, no-router cost, net, saved, extra, share of spend by model,
   and the ledger-vs-transcript gap.

What the numbers can and cannot say:

- They price what was spent against what would have been spent on the same tokens. They do not see that a cheaper
  model may need more turns, or that the person may redo an answer they didn't accept; the acceptance eval is the
  evidence for quality, the ledger is not.
- Prices are API list prices. On a subscription plan they track usage against limits, not money.

## Live ledger, first 8 days (2026-11-18 to 2026-11-25)

One machine, the author's real work, all sessions. Source: `router.db` summed by day, and `check-savings.mjs 8`.

| Figure | Value |
|---|---|
| Spent (API list prices) | $1,898 |
| No router, same tokens | $1,867 |
| Net | **$31 extra, about 1.7% more than no router** |
| Saved (steps the router made cheaper) | $73 |
| Extra (stronger steps, its own Haiku calls, nudges) | $104, of which $96 in the main chat on Opus |
| Router's own classifier calls | $0.34 |
| Ledger vs Claude Code's transcripts | $1,906 vs $1,867, 2% apart |
| Main-chat cache writes that were 1-hour entries | 212M of 215M tokens (99%), as the price code assumes |

What it means:
- The ledger is trustworthy to a few percent. The one session far off (+26%) was the checker's cut-off on 2026-11-18,
  the day two router copies ran (known limit above); per day after that, it matched within about 5%.
- The router does not yet spend less than no router in real use. Most extra comes from raising effort on Opus main-chat
  turns (a high step costs about 1.4x a medium one). Effort raises keep the cache and buy quality in the evals, but
  the ledger kept no effort per row, so it could not say which classes or raises the $96 bought. The owner called
  that a bug: effort is the router's main lever. 0.9.0 adds an `efforts` table (effort, no-router effort, class, why)
  and trims the ledger itself (effort detail 60 days, the rest 400). Next: a week of live per-class statistics,
  anonymized, to tune which raises pay.
- Compared with the eval's 1.21x spend, real use came out at 1.02x: closer to the baseline than the evals predicted.

## Numbers to quote (with their source)

- Evals: 283 cases; answers +15.6% better than always Opus medium at 1.21x its spend (`evals/results/report.md`).
- Acceptance: Opus medium 85% accepted, Sonnet medium 80%, same 75 cases; per class in `evals/results/accept-report.md`.
- Ledger before the fixes, 2026-11-19: spend and the no-router figure within 0.3% of each other (the router had
  just started moving work off Opus).
- Live ledger, 8 days of real work: $1,898 spent against $1,867 with no router (1.7% more), $73 saved and $104 extra;
  ledger and transcripts 2% apart (section above).
- Eval spend for the whole project: a few hundred dollars at API prices (`evals/work/spend.jsonl`).

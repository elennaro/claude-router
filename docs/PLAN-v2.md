# Router v2 plan (draft for the owner's OK)

Inputs: the per-prompt baseline (evals/results/report.md), docs/research-session-routing.md, the owner's answers of 2026-11-18.

## What the baseline proved

| Gate | Result | Pass |
|---|---|---|
| Floor downgrades | 1 | 0 |
| False cheap | 9.3% | ≤3% |
| Tier match | 30% | ≥85% |
| Quality kept on routed-down turns | 54% (18 of 39 worse) | ≥90% |

1. Keyword rules cause most false-cheap cases: "hooks"/"angle" → brainstorm (Opus low) on real script work; "log" → explore (Haiku) on hard debugging.
2. Low effort hurts: Opus low lost to Opus medium in 10 of 22 replays (won 3); Haiku low lost 4 of 5. Haiku medium was a coin toss (4 worse, 5 better of 11).
3. The labelers say most tasks need Sonnet high or Opus high, rarely Opus medium: the table sits at the wrong points (too low effort, too high model).
4. Judge noise: the cheaper answer won 9 times, so roughly a quarter of verdicts are noise; net loss is still ~25%.

## 1. Per-prompt classification (feeds the first-prompt switch)

1. Rules may only raise a tier (floors, explicit asks). A downgrade needs the classifier.
2. First prompt: 3 Haiku samples, all must agree (cost ~$0.0006). Later prompts: 1 sample, effort only.
3. New table, from the labels, effort chosen apart from the model (Anthropic: Sonnet high beats Opus low at the same price):
   - mechanical, explore: Haiku medium (never low).
   - scoped-code, docs, data-analysis, long-read, learn-explain, test-writing: Sonnet medium/high.
   - brainstorm, image-prompt, devops-config, structure, critique, debugging, code-review, math: Sonnet high.
   - engineering, vision, final-copy, brand-visual, architecture, security-review: Opus high (floors).
   - rare-hard: Opus xhigh, with a Fable button (Anthropic: Fable after Opus xhigh falls short; long agent sessions, deep research, analysis to a finished deck).
   Each change is checked by replaying its cases before it ships.

## 2. First prompt of a chat

The router sets model and effort before the first request (`/model` via `$.command.run`, effort per turn). Down: automatic when 3 of 3 agree. Up: a button. The band says what it picked and why, with an Undo.

## 3. Mid-session check

- Triggers: after compaction, a todo list finished and a new one started, a plan approved, a clear topic change, every 20 turns, struggle signals (repeated failures, the owner correcting; these only push up).
- Reads: last 5-8 prompts, the todo list, the plan file, the last summary, session state (4-8K tokens), never only the last prompt.
- Decides: Haiku x3; up needs 2 of 3, down needs 3 of 3 and a saving of at least 2x the cache cost of switching. No new tip for 10 turns after one, none after a decline until a different trigger.
- Acts: never by itself. Buttons: "Compact and switch to X" (same work) or "New session on X" (unrelated work).

## 4. Subagents

1. Type table first (Explore, Plan, reviewers...), frontmatter pins and explicit models still win.
2. Generic agents (general-purpose, claude): Haiku reads the brief (~$0.0005, ~1-2 s).
3. Forks never re-routed; siblings of one fan-out share a model (shared cache).
4. One tier up when the parent re-spawns the same brief or the agent fails.

## 5. Stats, band, manual switch

1. Session cost from `$.session.usage().cost.usd` (the app's own number). Savings only over turns the router saw, labeled so.
2. Settings: "This chat: Auto / Haiku / Sonnet / Opus / Fable" and an effort row; a manual pick turns auto-switch off for the chat.
3. Band: tips never truncate the model and savings; buttons instead of instructions.
4. Ledger stays one file per day per session; subagent rows add type, source of the choice, model, effort, tokens, cost, outcome, re-spawned, brief hash. No text stored.

## 6. Evals and tests

1. Per-prompt suite (this one): re-run the classifier ($1.2) on every change; replay only changed decisions.
2. Session suite: cases = the window the check sees + state + the right answer; sequence cases for flip-flopping. Gates: ≥85% right, wrong downgrades ≤3%, no flips, net saving after switch cost.
3. Subagent suite: briefs by agent type with labeled tiers.
4. Code audit and test coverage of every hook and the band/Settings UI.

## Owner decisions (2026-11-18)

1. Order as above; each Sonnet-high move is replay-checked first (≥90% not worse).
2. Final copy and brand work: Opus high floor, with a Fable button (never automatic).
3. Label disputes: Fable's label, except investigation of production code, where the stronger label wins ("stronger models have more knowledge"). So debugging, code review and security review of production code stay on Opus high and are not candidates for the Sonnet-high move.
4. Evals use measured labels (replay + both-order judging + noise floor), full build, on the subscription via `claude -p`.
5. Replay gate is noise-relative (2026-11-18, after the noise run: Opus medium vs itself got "worse" 19%, "better" 23%, identical answers 0%). A class moves to Sonnet high only if Sonnet high's "worse" rate on its cases is at most the noise rate + 5 points (≤24%) and worse minus better is at most +5 points. The old "≥90% not worse" was unreachable even for Opus against itself.

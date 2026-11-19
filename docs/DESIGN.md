# Router: settled design (grilling, 2026-11-18)

Terms are defined in [GLOSSARY.md](../GLOSSARY.md).

## Repo and install
1. One git repo. `.claude-plugin/marketplace.json` sits at the root and the plugin lives in `router/`, so the repo installs as a marketplace (from GitHub, or a local clone while developing).
2. Your data stays in `~/.claude`: `routing.json`, the ledger and the Board.
3. The plugin is Claude-only: it routes Claude models and calls Codex and Antigravity as outside agents, but never writes their config files.

## Models: never a version, always the newest
4. Claude uses family names only (haiku, sonnet, opus, fable). Claude Code resolves them to the newest model it knows.
5. Codex and Antigravity read their CLI's own model list: Codex from `models_cache.json` or `codex debug models`, Antigravity from `agy models`. The plugin picks the newest listed version per family and keeps the list for a day.
6. An exact version written in an agent or skill file is read as its family, so it runs on the newest model.
7. Once a week the plugin checks Claude Code, the Codex CLI and the Antigravity CLI against their latest release. When one is behind, the band's Settings shows an Update button for it, and the Board shows what's behind and which models would change. The button runs the update; nothing updates on its own.
8. Prices are checked weekly on the official page. New prices are written only if every family is found and no price changed more than 4x. Otherwise the old table stays and you get a warning with the diff.

## Outside agents
9. The plugin adds tools for Codex and Antigravity. Claude passes a role, a brief, a folder and optional images. The plugin builds the command with the newest model for that role, the role's effort and your standard flags.
   - A `codex exec` or `agy -p` that Claude runs in Bash is stopped and pointed to the tool.
   - Skills and memories that hard-code a model are updated to use the tool.
10. Codex roles, as families:

    | Role | Family and effort |
    |---|---|
    | review, validate, cross-check | sol high |
    | deep | astra high |
    | visual | terra medium |
    | quick | luna low |

    The Antigravity role table gets researched and shown to you before use.

## Routing behaviour
11. An explicit ask in the prompt wins for that turn, floors included. "From now on" makes it last the session. It reaches subagents when the prompt says so. It is logged as "you asked".
12. New classes are added before the baseline: data analysis, learn and explain, debugging, test writing, DevOps and config, code review (apart from creative critique), long-file reading, long agent runs, info lookup, math, and security review. Each class's tier is researched and matched to the labeling rubric.

## Eval
13. There are about 33 categories: the task classes plus the tricky groups (follow-ups, Russian and mixed language, very short prompts, mixed tasks, misleading words, project-specific meaning, explicit asks). Each gets 8-10 cases, about 300 in total.
14. How cases are made:
    - A script reads your typed prompts only to learn their shape and how often each kind comes up.
    - Cases are then written fresh and generic.
    - Working files are rebuilt as fakes in `evals/fixtures/`.
    - Everything is committed, so every case must be fully anonymized.
15. Anonymity:
    - Realistic fake names instead of tags, one mapping per case.
    - Quasi-identifiers (place, date, price, client, product) and style tells are removed.
    - Two Anthropic models audit each case: one tries to guess who or what is behind it, the other compares the case with its source. Both are Anthropic, so nothing goes to another vendor.
    - Failed cases are fixed and re-audited.
16. Labels give the needed tier.
    - Opus and Fable label separately. Their brief states your goal (top quality at the lowest price) and includes Anthropic's model-choice guides.
    - Where they disagree, you decide on a private claude.ai page with buttons.
17. Layers:
    1. The classifier runs on real Haiku, 3 runs per case.
    2. Decisions run in the test kit: floors, the 90K guard, explicit asks, outside-agent commands and newest-version resolution.
    3. Quality: every case routed below the main tier is replayed in the `claude plugin eval` sandbox. Fable judges each answer blind against the main tier, and Opus re-judges every "worse".
18. Gates (missing any one fails the eval):

    | Gate | Pass mark |
    |---|---|
    | Floor downgrades | 0 |
    | False cheap | 3% or less (a case counts if any of its 3 runs goes wrong) |
    | Tier match | 85% or more (same model, effort within one step, majority of runs) |
    | Quality | 90% or more rated as good or acceptable |

19. Budget: $40 cap. The eval stops and asks before going over.
20. Order: update Claude Code, Codex and Antigravity to their latest releases → move to the repo → add the new classes, explicit asks, agent tools, newest-version resolution and update buttons → build the eval → baseline run → report. You're asked before any tuning.

# claude-router

A Claude Code plugin (a "mod": a TypeScript hooks module the engine loads) that picks the model and effort for each turn, subagent and outside-agent call. It is released publicly: every change must work on a clean install with nothing from the author's machine. Terms are defined in [GLOSSARY.md](GLOSSARY.md); settled decisions are in [docs/DESIGN.md](docs/DESIGN.md) and [docs/PLAN-v2.md](docs/PLAN-v2.md); the current plan (cache-aware token economy) is [docs/PLAN-v3.md](docs/PLAN-v3.md).

## Layout

- `.claude-plugin/marketplace.json`: the repo is its own marketplace; the plugin is `router/`.
- `router/hooks/register.tsx`: every hook (prompt, turn step, subagent spawn, compaction, session end, band, Settings, pane).
- `router/hooks/policy.ts`: pure routing logic and the built-in config `BUILTIN`. Calibrated defaults live here, never only in a user's `~/.claude/routing.json`.
- `router/hooks/db.ts`: the ledger. All SQL and the node runner text; the plugin writes the runner to `~/.claude/router/sqlite.mjs` and sends it batches on stdin.
- `router/hooks/outside.ts`: Codex and Antigravity tools, price and CLI version checks.
- `router/hooks/view.ts`: band, Stats card and Board HTML.
- `router/types/index.d.ts`: the `$.state` contract and shared types.
- `router/tests/`: `router.test.ts` (engine tests), `outside.test.ts`, `db.check.mjs` (the real SQL on a throwaway database).
- `evals/`: eval suites run with `claude -p` on the subscription. `evals/work/` and `evals/results/` are private and gitignored.

## Commands (run from `router/`)

- `claude plugin test .`: all engine tests. Must pass.
- `node tests/db.check.mjs`: the ledger SQL against real SQLite (Node 22.13+). Must pass.
- `claude plugin validate .`: manifest and hooks as the engine reads them.
- `node tests/typecheck.mjs`: strict TypeScript check of hooks, types and tests (`router/tsconfig.json`: strict, no unchecked index access, no unused locals or parameters). Takes the plugin API types Claude Code wrote (beside the plugin after a session loaded it, or from the plugin-authoring skill). Needs `npm install -g typescript`. Must pass; the pre-commit hook runs it.
- `node tests/ui.check.mjs`: what the plugin draws (Stats card, rail bars, Board) from fixtures: wording, number formats, snapshots (`tests/ui-snapshots/`, `--update` after a change you meant), and with Chrome or Edge text fit, overlap, WCAG contrast, sideways scroll and target size at 500/800/1200 px, light and dark (~5 s). `--shots <dir>` saves PNGs; `--trees` adds the band and Settings as a terminal mock-up. The band, Stats and Settings trees are checked at 40-120 cells by `tests/ui.test.ts` (part of `claude plugin test .`). Must pass. Screenshots can be reviewed by the cached Haiku judge, `node evals/ui/judge.mjs <dir>` (about $0.002 a picture, $0 when cached).
- Eval scoring checks (from `evals/`, free, no model calls): `node toolloop/checks.test.mjs`, `node store.test.mjs`, `node paste/run.mjs --test` and `node docker.mjs --self-test`. Must pass. `node docker.mjs --check` runs all the checks in a clean Linux container (needs Docker). The suites themselves cost money: see `evals/README.md`.
- Router tuning loop (from `evals/`, free): `node fast.mjs` replays every suite from the store (`work/eval.db`) with no model calls and prints every gate. Use it for any change to the table, rules or thresholds; pay for a fresh run only when the classifier's words or labels change.
- Install your working copy: `claude plugin marketplace update claude-router`, then `claude plugin update router@claude-router` (bump `router/.claude-plugin/plugin.json` version first). Restart Claude Code to load it.

## Rules

1. **Self-sufficient.** No absolute paths, user names or machine-specific folders in code, docs or tests. Paths come from `$.env` (`USERPROFILE`/`HOME`) at run time. Defaults go in `BUILTIN`. Data migrations from older versions belong in the plugin (see `importLegacy`), never in a one-off script.
2. **Mod limits.** No Node or DOM inside the module; `$.fs` has no delete or append; `$.process.run` takes an argv with no shell. Never build a command through `cmd /c` or `sh -c` with user data.
3. **Tests prove behaviour.** New logic gets a test, and a few deliberate mutations (break the code, see a test fail, restore). A surviving mutation means a missing test.
4. **Smallest complete change.** No options, layers or "for later" code nobody asked for. A known limit gets a `shortcut: <limit>, <when to upgrade>` comment.
5. **Privacy.** The ledger stores no prompt text except the first 60 characters of a chat's first prompt (reminders stripped, long tokens masked). One opt-in exception (owner, 2026-11-26): with *Training* on, each main-chat switch or stay row keeps its prompt, masked the same way, up to 2000 characters, on this machine only, for training a local router; off, nothing. Never log briefs or answers (a brief is the model's text).
6. **Anonymity before publishing eval data.** Eval cases are written from real work. Any new or changed case must pass `node evals/audit-json.mjs` / `node evals/audit.mjs` (term scan against the private `evals/work/identity.txt`, then a model attack and verify). Generators must never name the author's real places or projects, not even as "avoid X".
7. **Model choices.** Never a pinned model version: family names only (haiku, sonnet, opus, fable). Fable is never picked automatically. Production-code investigation (debugging, code review, security review) stays on Opus high or above. A cheaper default needs eval evidence that clears the gate in `evals/README.md`.

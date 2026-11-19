# claude-router

A Claude Code plugin (a "mod": a TypeScript hooks module the engine loads) that picks the model and effort for each turn, subagent and outside-agent call. It is released publicly: every change must work on a clean install with nothing from the author's machine. Terms are defined in [GLOSSARY.md](GLOSSARY.md); settled decisions are in [docs/DESIGN.md](docs/DESIGN.md) and [docs/PLAN-v2.md](docs/PLAN-v2.md).

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
- Type check: run `claude --plugin-dir router` once (the engine lays types into `router/.claude-plugin/types/`), then `npx tsc -p router/.claude-plugin/types`.
- Eval scoring checks (from `evals/`, free, no model calls): `node toolloop/checks.test.mjs` and `node store.test.mjs`. Must pass. The suites themselves cost money: see `evals/README.md`.
- Router tuning loop (from `evals/`, free): `node fast.mjs` replays every suite from the store (`work/eval.db`) with no model calls and prints every gate. Use it for any change to the table, rules or thresholds; pay for a fresh run only when the classifier's words or labels change.
- Install your working copy: `claude plugin marketplace update claude-router`, then `claude plugin update router@claude-router` (bump `router/.claude-plugin/plugin.json` version first). Restart Claude Code to load it.

## Rules

1. **Self-sufficient.** No absolute paths, user names or machine-specific folders in code, docs or tests. Paths come from `$.env` (`USERPROFILE`/`HOME`) at run time. Defaults go in `BUILTIN`. Data migrations from older versions belong in the plugin (see `importLegacy`), never in a one-off script.
2. **Mod limits.** No Node or DOM inside the module; `$.fs` has no delete or append; `$.process.run` takes an argv with no shell. Never build a command through `cmd /c` or `sh -c` with user data.
3. **Tests prove behaviour.** New logic gets a test, and a few deliberate mutations (break the code, see a test fail, restore). A surviving mutation means a missing test.
4. **Smallest complete change.** No options, layers or "for later" code nobody asked for. A known limit gets a `shortcut: <limit>, <when to upgrade>` comment.
5. **Privacy.** The ledger stores no prompt text except the first 60 characters of a chat's first prompt (reminders stripped, long tokens masked). Never log briefs or answers.
6. **Anonymity before publishing eval data.** Eval cases are written from real work. Any new or changed case must pass `node evals/audit-json.mjs` / `node evals/audit.mjs` (term scan against the private `evals/work/identity.txt`, then a model attack and verify). Generators must never name the author's real places or projects, not even as "avoid X".
7. **Model choices.** Never a pinned model version: family names only (haiku, sonnet, opus, fable). Fable is never picked automatically. Production-code investigation (debugging, code review, security review) stays on Opus high or above. A cheaper default needs eval evidence that clears the gate in `evals/README.md`.

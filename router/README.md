# router

Router mode for Claude Code: each turn, subagent and outside-agent call gets a fitting model and effort: more effort where the work needs it (production-code investigation always Opus high), Haiku for lookups inside subagents, and never a tier below what the work needs. In the evals: answers 15.6% better than always Opus medium, at about 1.3× its spend.

## Install

```
/plugin marketplace add OWNER/claude-router
/plugin install router@claude-router
```

From a local clone instead: `/plugin marketplace add <path to the clone>`.

**Needs:** Claude Code 2.1.325 or newer. Node.js 22.13 or newer on PATH for the ledger (savings, Stats, Board); without it routing still works and one toast says what is missing. Optional: the Codex CLI (`npm install -g @openai/codex`) and Antigravity CLI (`agy`) for the outside-agent tools.

No setup is needed: the built-in rules apply until you add a `~/.claude/routing.json`.

## What it does

| Where | What happens | Who decides |
|---|---|---|
| Effort, every turn | Keyword rules (EN/RU), then Haiku with a confidence score, name a task **class** for each new task of 12+ characters; follow-ups ("ok, do it") keep the current one. The turn's effort follows the class. Rules may only raise a tier; a cheaper class needs the classifier. Effort changes keep the prompt cache. | Automatic |
| The chat's model, first prompt | Before anything is cached, 3 Haiku samples read the first prompt. Only if all 3 agree on a cheaper, non-floor class does the chat move (shown as "Picked X for this chat · Undo"). A harder task later moves it back. | Automatic down; never up |
| One quick turn | A sure quick task (explore, mechanical) runs its own turn on Haiku, then the chat goes back to its model. Not past 90K tokens of context. | Automatic |
| Model tip | A class that needs a stronger model shows "X fits <class> better" with a **Switch** / **Compact and switch** button. Never a cheaper model from one prompt. | You |
| Session check | After a compaction, a finished todo list, an approved plan, or every 20 prompts, 3 Haiku samples read the last 8 prompts, the todo list and the plan, and judge the work still ahead. Up needs 2 of 3; down needs 3 of 3, all sure, with no floor task at hand. The band offers **Compact and switch to X** (same work) or **Fresh start on X** (new topic), and **Not now**. Never switches by itself; quiet for 10 prompts after an offer, and after Not now until a different trigger. | You |
| Subagents | A type in the `agents` table (Explore, Plan) gets its entry. Any other agent with no `model:` in its file (general-purpose, claude, your own) is routed by its brief: a sure class moves it; anything unsure runs on the parent's model. Fable is never picked automatically. Forks and resumed agents are never re-routed. The same brief spawned again goes one tier up; agents of one workflow run never go below each other (same model, shared cache). A model on the Agent call or in the agent file always wins. | Automatic |
| Codex, Antigravity | The `mcp__router__codex` and `mcp__router__antigravity` tools run them read-only on the newest model of the role's family, with the standard flags. Calling `codex exec` / `agy -p` in Bash is pointed to the tools. | Automatic |

**Floors:** classes marked `floor` in routing.json never get a lower model or effort than the main default.
**Your words win:** "use sonnet", "high effort", "think harder", "run haiku subagents", with "from now on" to keep it for the chat, beat every rule and floor.

## Band and Settings

One row above the prompt: `● Router · <model> <effort> · saved $x` (or `$x extra`, in the warning color), then **Board**, **Stats** and **Settings**. Offers and tips get a second row, so the model and spend never truncate.

All spend is measured against **no router**: the model and effort each request asked for (yours, or the parent chat's for a subagent), at the same tokens. A different effort is priced by its measured output length (high about 1.4× medium, low about 0.72×). Saved and extra spend are summed apart, so cheap subagents never hide a dearer turn.

- **Stats**: this chat against no router (saved and extra), this project across chats, the model and effort now, what this chat cost in total (the app's own figure), turns and subagents re-routed, and cost per turn (a pale bar for no router, orange where the router spent more; hover a bar on the desktop for its numbers). Two columns in a narrow window, four in a wide one.
- **Board** opens `~/.claude/router/board.html`, filtered by 1d to All: spent, without router and the difference, every session (named by its first prompt), every project, requests by model, subagents by type, and this chat turn by turn. On a phone-width window the less important columns hide.
- **Settings**: *Routing* Everywhere and In <project> On/Off (written to routing.json; the project wins). *This chat*: Off / Effort / Models / Both. *Model*: Auto / Haiku / Sonnet / Opus / Fable, and *Effort*: Auto / Low … Max (a pick wins for this chat, Auto gives it back). *Tools*: update the CLIs. Show or hide the widget, edit the rules.

**Ledger:** one SQLite file, `~/.claude/router/router.db` (about 20 KB for a busy day), written through node's built-in `node:sqlite` by a small runner the plugin keeps at `~/.claude/router/sqlite.mjs`; node must be on PATH. Four tables: `sessions` (id, project, label), `days` (turns per session per local day), `usage` (steps, spend, no-router cost and extra spend per day, session, who and model; who is `main`, `router` for the classifier, or a subagent type) and `spawns` (subagent runs, routed, re-spawned). Rows are batched and saved about every 2 s and at the session's end; if a save fails, the rows wait for the next one. Query it with any SQLite tool. The only text kept is the first 60 characters of a chat's first prompt, which names it on the Board (injected reminders dropped, long tokens such as keys masked); no other prompt or brief text is stored. A `/clear` starts a new session row. The Haiku classifier's cost counts as extra spend. Rows from before 0.5 were measured against the main model and have no extra split. Prices are API-equivalent; on a Max plan they track limit usage, not money.

**Widget:** a two-row glance over the cost bars. Turn it on in Settings, then drag it into the session rail (a mod can't place it there).

`/route status` · `/route board` · `/route widget` · `/route on|off` (this chat) · `/route effort on|off` · `/route models on|off` · `/route effort retest` · `/route reload` (after editing routing.json).

## Configuration

`~/.claude/routing.json` holds the defaults. A project's `.claude/routing.json` overrides any key; the maps (`classes`, `agents`, `keywords`) merge per entry.

```json
{
  "keywords": { "structure": ["beat plan", "episode plan"] },
  "agents": { "probe-agent": { "class": "mechanical" } }
}
```

For a production codebase, raise the project's default: classes that sit at the default (explain, docs, data analysis, long reads and others) follow it, so a production log read or an "explain why this fails" gets Opus high even when neither the rules nor the classifier see debugging in it.

```json
{ "main": { "model": "opus", "effort": "high" } }
```

## Tools

- `node bin/pin-agents.mjs <agentsDir> '<json>' [--fill] [--dry]` pins `model:`/`effort:` in agent files.
- `../evals/`: the eval suites (per prompt, session check, subagents) and their reports.

## Limits (Claude Code 2.1.325)

- `claude -p --agent X` ignores the agent file's `effort:`; pass `--effort`.
- Headless runs (`claude -p`, no surface) are counted, never re-routed. Desktop-app sessions start the same way and switch to routed once the app attaches.
- A subagent's "parent model" is the session's model, not a one-turn move, so an unsure brief inherits the session model.

## Checks

`claude plugin test .` · `claude plugin validate .` · `node tests/db.check.mjs` (the ledger's SQL on a real, throwaway database)

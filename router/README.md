# router

Router mode for Claude Code: each turn, subagent and outside-agent call gets a fitting model and effort: more effort where the work needs it (production-code investigation always Opus high), Sonnet for chats that open with a message, translation, lookup, long read, data or test task, Sonnet high for subagents on defined tasks, Haiku for lookups inside subagents, and never a tier below what the work needs. In the evals: answers 15.6% better than always Opus medium, at about 1.2× its spend.

## Install

```
/plugin marketplace add elennaro/claude-router
/plugin install router@claude-router
```

From a local clone instead: `/plugin marketplace add <path to the clone>`.

**Needs:** Claude Code 2.1.325 or newer. Node.js 22.13 or newer on PATH for the ledger (savings, Stats, Board); without it routing still works and one toast says what is missing. Optional: the Codex CLI (`npm install -g @openai/codex`) and Antigravity CLI (`agy`) for the outside-agent tools.

No setup is needed: the built-in rules apply until you add a `~/.claude/routing.json`.

## What it does

| Where | What happens | Who decides |
|---|---|---|
| Effort, every turn | Keyword rules (English only), then Haiku with a confidence score (any language), name a task **class** for each new task of 12+ characters; follow-ups ("ok, do it") keep the current one. The turn's effort follows the class. Class efforts are set for Opus: on Fable, high and above run one step lower (Opus high is Fable medium, Opus xhigh is Fable high). Rules may only raise a tier; a cheaper class needs the classifier. Effort changes keep the prompt cache. | Automatic |
| The chat's model, first prompt | Before anything is cached, 3 Haiku samples read the first prompt. Only if all 3 agree on a cheaper, non-floor class does the chat move (shown as "Picked X for this chat · Undo"). Built in, that is Sonnet for a message to one person (write, fix or translate), mechanical edits, lookups, long reads, data analysis and test writing: the classes where Sonnet medium's answers were accepted as often as Opus medium's. Public copy (posts, landing pages, scripts) stays final copy. A harder task later moves it back. | Automatic down; never up |
| One quick turn | A sure quick task (explore, mechanical) runs its own turn on Haiku, then the chat goes back to its model. Not past 90K tokens of context. | Automatic |
| Not happy with an answer | After each answer, one Haiku sample reads your request, the end of the answer and your next prompt (any language, no word list) and says whether you are clearly unhappy with it, going on with the same task, or starting a new one. "Sorry", "my bad", "I mean" never count. An unhappy reply keeps the task's class. The first one changes nothing, so one misread costs nothing; the second raises the effort one step for the rest of the task; the fourth raises it again (medium, high, xhigh at most) and shows the model tip for the next model up (Haiku to Sonnet, Sonnet to Opus; never Fable). Effort changes keep the prompt cache. A new task starts calm again. In the eval (44 exchanges, 3 runs): 94% of complaints caught, 100% of new tasks read right, 10.6% of calm replies misread (nearly all "I meant X" after a wrong guess), so about 1% of tasks get a raise they didn't need. | Automatic |
| Model tip | A class that needs a stronger model shows "X fits <class> better" with a **Switch** / **Compact and switch** button. Never a cheaper model from one prompt. | You |
| Session check | After a compaction, a finished todo list, an approved plan, or every 20 prompts, 3 Haiku samples read the last 8 prompts, the todo list and the plan, and judge the work still ahead. Up needs 2 of 3; down needs 3 of 3, all sure, with no floor task at hand. The band offers **Compact and switch to X** (same work) or **Fresh start on X** (new topic), and **Not now**. Never switches by itself; quiet for 10 prompts after an offer, and after Not now until a different trigger. | You |
| Subagents | A type in the `agents` table (Explore, Plan) gets its entry. Any other agent with no `model:` in its file (general-purpose, claude, your own) is routed by its brief. A defined task goes to **Sonnet high** (`subagent` in routing.json): a brief no class claims surely, a class at the main tier, and scoped code. Lookups and tiny edits a class is sure of go to Haiku; production debugging, review, security and the floor classes keep Opus high, even when the classifier is unsure; one that must also reproduce the failure (a local repro, a load or stress test) runs a long tool loop and gets Opus xhigh. A brief too short to read runs on the parent's model. Fable is never picked automatically. Forks and resumed agents are never re-routed. The same brief spawned again goes one tier up; agents of one workflow run never go below each other (same model, shared cache). A model on the Agent call or in the agent file always wins. So do the main model's own words in the brief ("use high effort", "use opus"): the Agent call has no effort field, so the brief is where an asked effort lives, and it beats the router's tier. | Automatic |
| Hand lookups down | The main model is fixed for a turn, so a search step inside a bigger task would run on it. When subagent routing is on and the Agent tool is offered, the router adds one paragraph to the system prompt: searches and reading across several files, pages or logs go to a subagent with a short brief (then routed as above); judgment, design, code changes and the final writing stay in the main chat; a single quick lookup stays too. | Automatic |
| Codex, Antigravity | The `mcp__router__codex` and `mcp__router__antigravity` tools run them read-only on the newest model of the role's family, with the standard flags. Calling `codex exec` / `agy -p` in Bash is pointed to the tools. | Automatic |

**Floors:** classes marked `floor` in routing.json never get a lower model or effort than the main default.
**Your words win:** "use sonnet", "high effort", "think harder", "run haiku subagents", with "from now on" to keep it for the chat, beat every rule and floor.

## Band and Settings

One row above the prompt: `● Router · ■ <model> <effort> · saved $x · cache hit N%` (or `$x extra`, in the warning color), then **Board**, **Stats** and **Settings**. Offers and tips get a second row, so the model and spend never truncate.

All spend is measured against **no router**: the model and effort each request asked for (yours, or the parent chat's for a subagent), at the same tokens. A model reached by pressing a router tip or offer counts as the router's choice: the baseline stays on the chat's model from before that switch, so a move up to Fable shows as extra spend. A model you pick in Settings or name in a prompt is yours, and the baseline follows it. A different effort is priced by its measured cost (a high-effort step about 1.4× a medium one, low about 0.72×). Saved and extra spend are summed apart, so cheap subagents never hide a dearer turn.

**Colors:** Haiku green, Sonnet teal, Opus clay (Claude's own), Fable ruby, the same in Stats, the Board and Settings. A darker shade is a higher effort, in both themes: a light tint for low, the model's own color for medium, darker for high and darker still for max (xhigh shows as max). On a dark page the dark steps get a faint light edge so they stay visible. The palette was checked for color-blind separation and contrast on both themes; names and tooltips always say the model too.

**Cache hit** is the share of prompt tokens read from the prompt cache instead of sent fresh or written to it. High is cheap: a read costs a tenth of fresh input.

- **Stats**: this chat against no router (saved and extra), this project across chats, the model and effort now, what this chat cost (the app's own figure) and its cache hit. Under them, **Models this chat**: one band of this chat's spend by model and effort, with each model's share, and how many turns and subagents were re-routed. Then **Cost per turn vs no router**: one bar per turn, up when it cost more than with no router, down when it cost less (square-root scale, so small turns stay visible; hover for exact numbers), in its model's color. Under it, **Cache hit per turn**: a bar per turn in the same column, taller and more solid for a higher hit, scaled by the share that missed in tenfold steps (99.9% full, 99% two thirds, 90% a third), so 99% and 99.9% look different; a missed token costs about 10x a read. Hover a bar or a band segment on the desktop for its numbers. Two columns in a narrow window, four in a wide one.
- **Board** opens `~/.claude/router/board.html`, filtered by 1d to All: spent, without router, the difference and the cache hit; every session (named by its first prompt) with a small band of its models; every project; spend by model (one band, then each model's spend, requests and cache hit); subagents by type; and this chat turn by turn with the model's color and the cache hit. On a phone-width window the less important columns hide.
- **Settings**: *Routing* Everywhere and In <project> On/Off (written to routing.json; the project wins). *This chat*: Off / Effort / Models / Both. *Model*: Auto / Haiku / Sonnet / Opus / Fable, each with its color, so the row is also the legend; and *Effort*: Auto / Low … Max (a pick wins for this chat, Auto gives it back). *Tools*: update the CLIs. Show or hide the widget, edit the rules.

**After a restart:** which subagents were moved, their spend so far, and this chat's Stats are kept per session in the plugin's own store (the last 30 sessions), so a resumed chat goes on measuring them right.

**Ledger:** one SQLite file, `~/.claude/router/router.db` (about 20 KB for a busy day), written through node's built-in `node:sqlite` by a small runner the plugin keeps at `~/.claude/router/sqlite.mjs`; node must be on PATH. Four tables: `sessions` (id, project, label), `days` (turns per session per local day), `usage` (steps, spend, no-router cost, extra spend and prompt tokens (fresh, cache read, cache write; from 0.7) per day, session, who and model; who is `main`, `router` for the classifier, or a subagent type) and `spawns` (subagent runs, routed, re-spawned). Rows are batched and saved about every 2 s and at the session's end; if a save fails, the rows wait for the next one. Query it with any SQLite tool. The only text kept is the first 60 characters of a chat's first prompt, which names it on the Board (injected reminders dropped, long tokens such as keys masked); no other prompt or brief text is stored. A `/clear` starts a new session row. The Haiku classifier's cost counts as extra spend. Rows from before 0.5 were measured against the main model and have no extra split. Prices are API-equivalent; on a Max plan they track limit usage, not money.

**Checking the savings:** `node bin/check-savings.mjs [days | YYYY-MM-DD]` re-counts each session's spend from Claude Code's own transcripts, with its own price code, and prints it next to the ledger's spend, no-router cost, saved and extra. The two spend columns should agree within a few percent; a bigger gap means steps were missed or counted twice. Prices follow the pricing page: main-chat cache writes are 1-hour entries (2× input), subagent writes 5-minute ones (1.25×). A run a re-spawn replaced counts as saving nothing. `--test` checks the script itself.

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

For a production codebase, raise the project's default: classes that sit at the default (explain, docs, data analysis, long reads and others) follow it, so a production log read or an "explain why this fails" gets Opus high even when neither the rules nor the classifier see debugging in it. Do this if you write prompts in a language other than English: the keyword rules are English only, and when Haiku is unsure such a prompt runs at the default (in the evals, 3 production prompts in Russian out of 279 cases).

```json
{ "main": { "model": "opus", "effort": "high" } }
```

## Tools

- `node bin/pin-agents.mjs <agentsDir> '<json>' [--fill] [--dry]` pins `model:`/`effort:` in agent files.
- `../evals/`: the eval suites (per prompt, session check, subagents) and their reports.

## Limits (Claude Code 2.1.325)

- `claude -p --agent X` ignores the agent file's `effort:`; pass `--effort`.
- Headless runs (`claude -p`, no surface) are counted, never re-routed. Desktop-app sessions start the same way and switch to routed once the app attaches.
- A subagent's "parent model" is the session's model, not a one-turn move. The Sonnet default only ever lowers: on a Sonnet or Haiku session an unsure brief gets the main default (Opus) instead.
- Code mode (experimental, `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE`) does not start while the router is installed: it refuses any plugin that hooks tool calls or subagent spawns, and the router hooks both (checked in Claude Code 2.1.323). Disable the plugin for a code-mode session.

## Checks

`claude plugin test .` · `claude plugin validate .` · `node tests/db.check.mjs` (the ledger's SQL on a real, throwaway database)

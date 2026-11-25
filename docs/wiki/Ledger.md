# The ledger

Everything the router measures goes into one SQLite file, `~/.claude/router/router.db`. Stats, the Board and `check-savings.mjs` all read it. Open it with any SQLite tool.

## What it keeps

| Table | One row per | What is in it |
|---|---|---|
| `sessions` | chat | project folder name, and the first 60 characters of the first prompt (secrets masked) to name it on the Board |
| `days` | chat and day | turns, first and last step time |
| `usage` | chat, day, who, model | steps, spend, the no-router cost, extra spend, prompt tokens (fresh, cache read, cache write) |
| `efforts` | chat, day, who, model, effort, class, reason | the same steps by the effort they ran at, the effort they'd have had with no router, the task class, and why the effort was set |
| `spawns` | chat, day, subagent type | runs, how many were moved to another model, how many were sent again |

**who** is `main` (your chat), `router` (the classifier's own calls), `awake` (keep-awake nudges), `paste` (big-paste reading), or a subagent type.

**why**, in `efforts`:

| why | the effort came from |
|---|---|
| `class` | the task class |
| `unhappy` | the class's effort raised after unhappy replies |
| `pick` | your pick in Settings |
| `asked` | your words in the prompt ("high effort") |
| `agent` | a subagent's routed effort |
| `nudge` | keep awake (always low) |
| `as-is` | the effort the step came with, unchanged |

No other prompt or brief text is ever stored.

## It stays small

At each session start the router trims the ledger:
- effort detail (`efforts`) after **60 days**, which is enough to tune routing;
- everything else after **400 days**, since the Board goes back a year;
- chats with no day left.

A busy day adds about 20 KB.

## Where the extra spend went

```sql
SELECT cls, why, effort, asked,
       round(sum(extra), 2) AS extra,
       round(sum(base - usd + extra), 2) AS saved
FROM efforts WHERE who = 'main'
GROUP BY 1, 2, 3, 4 ORDER BY extra DESC;
```

A row like `debug | class | high | medium | 12.40 | 0.00` means debugging turns raised from medium to high cost $12.40 more than running them at medium. That's what the next tuning step reads.

## Checking it

`node bin/check-savings.mjs 7` (from the `router/` folder of a clone) re-counts the last 7 days from Claude Code's own transcripts. On the author's first 8 days the two were 2% apart.

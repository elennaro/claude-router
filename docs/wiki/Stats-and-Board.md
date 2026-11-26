# Stats and the Board

## The band

`● Router · ■ <model> <effort> · saved $x · cache 96K, 60 min left · hit N%`, then **Board**, **Cache**, **Stats**, **Settings**.

- **saved $x** or **$x extra**: this chat against no router.
- **cache 96K, 60 min left**: the cache's size and the minutes before it expires (warning colour at 10 and under).
- **hit**: the share of prompt tokens read from the cache. High is cheap.
- The coloured square is the model: Haiku green, Sonnet teal, Opus clay, Fable ruby. A darker shade means a higher effort.
- The band is one row and never grows; an offer, a tip or the away report adds one row. **Cache**, **Stats**, **Settings** and **Switches** open as tabs of one **Router** panel beside the chat.

## Cache

The cache's size against the model's limit, the minutes left, a bar of what is in it, and what it costs now, prices in one column: losing the cache, a switch to each other model, compacting now, `/clear`, keeping it warm. Keep awake On/Off for this chat sits under them.

## Stats

| Cell | What it tells you |
|---|---|
| This chat / this project | saved and extra spend against no router |
| Cache | its size, how many minutes it stays warm (counts down while open), what rebuilding it costs |
| Where it went | the reason that saved most, and the biggest extra |
| Keep awake | what it saved, when the next nudge goes, what the nudges cost, or why it stopped (work done, unlikely back, off for this chat) |
| Plan | on a Claude plan: the weekly and 5-hour limits used, and what one weekly point cost on this machine |

Hover any cell for its full text. Below the cells: what a switch or a compaction costs right now, this chat's spend by model, cost per turn against no router (bars up cost more, down cost less), and cache hit per turn.

## The Board

`/route board` opens `~/.claude/router/board.html`. Pick 1d to All. It shows spend, the no-router figure, the **net** in words ("saved $x" or "$x extra"), the cache hit, a line with what was saved and what was spent extra, a keep-awake line, every session and project, spend by model, subagents by type, and this chat turn by turn.

## Plan % instead of dollars

Settings → *Units* → **Plan %** shows savings and extra spend as a share of your plan's weekly limit. The rate comes from this machine: the dollars spent this week divided by the weekly points Claude Code reports as used. It starts once the week has 3 points and $3 of spend. Spend elsewhere (claude.ai, another computer) moves the limit but not the ledger, so the share then reads high. On an API key it stays in dollars. The Stats **Plan** cell shows the week and 5-hour limits used, and what one point cost here.

## How the numbers are counted

- **Spent:** each model step's tokens at API list price. Main-chat cache writes are 1-hour entries (2x input), subagent writes 5-minute ones (1.25x).
- **No router:** the same tokens on the model and effort that would have run with the plugin off: the chat's model, your own picks, "use X" in a prompt, a subagent's parent model. A different effort is priced by its measured cost (high about 1.4x medium, low about 0.72x).
- **Saved and extra:** per step, the part below the no-router cost is saved, the part above is extra. The classifier's own Haiku calls and keep-awake nudges are all extra. A rebuild a nudge avoided counts as saved when you come back.
- **Net** = saved − extra.

## Why a longer range can show a smaller saving

The net is saved minus extra, so it can go either way. If the days you add ran extra (a lot of raised effort, say), a month can show less net saving than the week inside it, or a smaller overspend. Saved on its own only grows with the range; so does extra. The Board's split line shows both.

## Checking the numbers

`node bin/check-savings.mjs 7` (from the `router/` folder of a clone) re-counts the last 7 days from Claude Code's own transcripts and prints it next to the ledger. The two should agree within a few percent. On the author's first 8 days of real use they were 2% apart.

Prices are API prices. On a Max plan they track how fast you use your limits, not money you pay.

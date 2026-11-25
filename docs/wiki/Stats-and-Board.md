# Stats and the Board

## The band

`● Router · ■ <model> <effort> · saved $x · cache hit N%`

- **saved $x** or **$x extra**: this chat against no router.
- **cache hit**: the share of prompt tokens read from the cache. High is cheap.
- The coloured square is the model: Haiku green, Sonnet teal, Opus clay, Fable ruby. A darker shade means a higher effort.

## Stats

| Cell | What it tells you |
|---|---|
| This chat / this project | saved and extra spend against no router |
| Cache | its size, how many minutes it stays warm (counts down while open), what rebuilding it costs |
| Where it went | the reason that saved most, and the biggest extra |
| Keep awake | what it saved, when the next nudge goes, what the nudges cost |

Hover any cell for its full text. Below the cells: what a switch or a compaction costs right now, this chat's spend by model, cost per turn against no router (bars up cost more, down cost less), and cache hit per turn.

## The Board

`/route board` opens `~/.claude/router/board.html`. Pick 1d to All. It shows spend, the no-router figure, the difference, the cache hit, a keep-awake line, every session and project, spend by model, subagents by type, and this chat turn by turn.

## Checking the numbers

`node bin/check-savings.mjs 7` (from the `router/` folder of a clone) re-counts the last 7 days from Claude Code's own transcripts and prints it next to the ledger. The two should agree within a few percent.

Prices are API prices. On a Max plan they track how fast you use your limits, not money you pay.

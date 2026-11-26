# What's new

Newest first. Update with `/plugin marketplace update claude-router`, then `/plugin update router@claude-router`, then restart Claude Code.

## 0.9.2: one quiet band, a Router panel, settings that stay

- **The band is one row** and never grows with what you open, so the chat no longer jumps and the mouse wheel scrolls the chat again. It shows the cache's size and minutes left.
- **Router panel**: Cache, Stats, Settings and Switches are tabs of one panel beside the chat.
- **Cache tab**: what is in the cache, the minutes left, and what losing it, a switch, compacting and `/clear` cost now.
- **Compact at** is a slider coloured by cost, with a mark every 100K and marks for now, the cheapest point and Claude Code's own.
- **This chat's settings stay**: Routing, Effort, Keep awake and Compact at come back after a restart. Routing can be turned off for one project.

## 0.9.1: rate the router, and it steps aside for ultrathink

- **Training** (Settings, off by default): the router logs each switch it makes (the chat's model, its effort, a quick turn on Haiku, a routed subagent) to `router.db` on this machine, with no prompt text. **Switches** on the band lists this chat's last 10; rate each 👍 or 👎. 👎 on a model pick goes back like **Undo** (a toast first if re-reading the chat costs over $0.10); 👎 on an effort pins the chat's own effort back. The labels are training data for a future local router.
- **Ultrathink and ultracode**: a prompt with either word, every agent started in that turn, and every workflow agent run exactly as you set them. No classifier, no tip, no switch; the ledger still counts the spend, with no saving and no extra.

## 0.9.0: the ledger says why

Each step's effort is now recorded, with the effort it would have had with no router, the task class, and why the effort was set: the class, a raise after unhappy replies, your pick, your words, a subagent's routing, or a keep-awake nudge. With this, the extra spend can be traced to the raises that cause it, which is the next tuning step. The ledger also trims itself: effort detail after 60 days, everything else after 400. See [The ledger](Ledger.md).

## 0.8.9: plain words and review fixes

- The Board says "saved $x" or "$x extra" instead of a sign. A bare "+$30" had been read as a saving.
- Plan % counts the week from the moment it resets, not from the start of that day.
- A chat keep awake stopped nudging still gets the compact-first offer when you come back.
- A slash command counts as you coming back.

## 0.8.8: units, smarter keep awake, routing in sync

- **Units** (Settings): dollars, or a share of your plan's weekly limit. Stats gets a **Plan** cell.
- **Keep awake stops when it doesn't pay.** A finished chat gets no nudges. After 20 idle stretches, it learns how likely people on this machine are to come back at each hour of the day, and nudges only while that beats the cost. See [Saving features](Saving-features.md#when-keep-awake-stops-by-itself).
- **Keep awake off for one chat**: Settings → *This chat*, or **Stop for this chat**.
- **Routing in sync**: switching routing on or off in one session reaches the others within about 10 seconds.

## 0.8.7: a readable UI

Contrast, narrow panes and the Board at phone width, all checked automatically in light and dark themes.

## 0.8.5: Compact at, up to the limit

Pick a compaction point up to the model's own context limit. Each point is coloured (green near the cheapest, red where it compacts too often or costs too much) and shows how often it compacts and what that costs.

## 0.8.0 to 0.8.4: cache-aware

The router started counting the prompt cache: effort changes keep it, a model switch rebuilds it, an hour idle loses it.
- Big pastes are read first by a cheaper model.
- Two shipped subagents, document reader and web researcher, are sized per brief.
- Keep awake holds an idle chat's cache warm.
- A compact-first offer appears after a break.
- *Compact at* per chat.
- The chat moves to a cheaper model by itself only when the rebuild pays back.

## Earlier

- **0.7**: model colors, cache hit, the unhappy-reply check, restart memory, read-only outside agents, cross-OS CI.
- **0.6**: Sonnet where it passed the acceptance eval.
- **0.5**: spend against no router, with saved and extra apart.

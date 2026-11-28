# What's new

Newest first. Update with `/plugin marketplace update claude-router`, then `/plugin update router@claude-router`, then restart Claude Code.

## 0.9.14: your model picker wins, switches wait for the turn

- **The app's model picker always wins.** When the router or a band button moves the chat to another model, it switches the session's own model (`/model`, for this session only), so the picker shows what actually runs. Anything you pick there is yours for the chat, the model it already shows included. An effort you set in the picker stays yours too.
- **A switch pressed during a turn is queued.** A toast and the offer row say so, with **Cancel**. It runs once when the turn ends; if the engine still refuses, a toast says why.
- **Short chats swap, long chats compact first.** Under 100K tokens or 5 answered turns the model just changes and every detail stays. Above both, the button says **Compact and switch**, used only when compacting costs less than re-reading the whole chat.
- **The router never clears a chat.** The **Fresh start** button is gone.
- **Stop router** / **Start router** in the band turns the whole router off or on for this chat in one press. It's kept after a restart. Off also clears the router's status line.
- Toasts say "router:" once.

## 0.9.9: stop the nudges from the band

**Stop nudges** in the band turns keep awake off for this chat only, in one press. It then reads **Nudges off**; press it again to turn them back on. It shows once the chat is over 20K tokens and keep awake is on in Settings, and on a narrow row it gives way before the Stats and Settings buttons.

## 0.9.8: the band stays on one row

- When the row is short of room, parts drop in turn: the hit, the word "Router", **Switches**, then **Board** (both stay as tabs of the Router panel). The desktop app's wider buttons are counted, so "Settings" no longer wraps to a second line.
- The expired-cache offer is shorter: what the next message re-reads and what compacting first adds and pays back.

## 0.9.7: the band fits its words

- The cache is the **Cache** button itself, in the longest words that fit: `Cache 96K · 60 min left`, `Cache 96K · 60m`, `60m left`, or `Cache`.
- **Cache expired** shows at every width, in the warning colour.
- A chat that grows under 1K a step says so in tokens (410 tokens), not 0K.

## 0.9.6: Training learns from your own use

With Settings → *Training* on, the router now keeps what a local model needs to learn your routing: the prompt with each switch (masked like the Board labels, up to 2000 characters, only in `router.db` on this machine; never a subagent brief), a row for each turn it kept as it was (unless you named or picked the model or effort), and labels from your next message: an unhappy reply marks the turn before 👎, a short "thanks" or "good" 👍. Your 👍/👎 buttons always win. Unrated rows are trimmed after their day to 2 per rated one, so the data stays small and balanced. With Training off nothing changes.

## 0.9.5: Compact at fixes

- The slider runs to the model's own context limit, not to the compaction window set in settings.json.
- Colours and the cheapest point show right after a restart: this chat's growth per step is kept.
- When the chat is smaller than the first point, its size shows as ◀ at the left end.

## 0.9.4: Compact at colours both ways

The slider is one gradient: purple where the chat would compact too often and lose detail, green at the cheapest point, amber then red where it costs more.

## 0.9.3: a real Compact at slider on the desktop

- **Compact at** is drawn: cost colours along the track, a tick every 100K, the knob at your pick, ★ for the cheapest point and a line for Claude Code's own. Under it, a row of points to press, each with its cost dot.
- **Settings breathe** on the desktop: air between rows, and each feature's note on its own line under its switch.
- The chat's growth per step shows to a tenth (0.4K), not as 0K.

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

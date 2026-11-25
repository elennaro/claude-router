# Saving features

All of these are switchable in **Settings**. Each one is about the prompt cache: a cached read costs a tenth of fresh input, and rebuilding the cache costs the most.

| Feature | What it does | Turn it off when |
|---|---|---|
| **Move down** | Moves the chat to a cheaper model by itself, only when the cache rebuild pays back | you want the chat to stay put no matter what |
| **Helpers** | Two shipped subagents, document-reader and web-researcher, sized per brief: Haiku for finding things, Sonnet for judgment | you never want reading done outside the main chat |
| **Big pastes** | A message over about 10K tokens is saved to a temp file and read first by Haiku or Sonnet; the chat gets the analysis plus the file path | you paste text the main model must read word for word (or start the message with "raw") |
| **Keep awake** | 50 minutes after the last step, a hidden one-line nudge keeps an idle chat's cache warm, for up to the hours you set, and only while it pays; then it compacts the chat as a handoff. Off for one chat: Settings → *This chat* → *Keep awake*, or **Stop for this chat** | you work on API keys with a 5-minute cache (it turns itself off then), or never leave chats idle |
| **Compact at** | Your own compaction point for this chat, with the cheapest point marked; **Make it my default** writes it to `~/.claude/settings.json` | you are happy with Claude Code's own window |

## Why keep awake pays

After an hour idle, your next message re-reads the whole chat at the cache-write price, about 40 times a cached read. A nudge reads it from cache instead. On a big chat, one avoided rebuild pays for many nudges. No nudge is sent while a question or permission dialog is waiting on you.

## When keep awake stops by itself

Nudges only pay if you come back. So the router asks two things:

1. **Is the chat finished?** Before the first nudge, one Haiku call reads your last message and the end of the answer. A chat that is clearly done ("thanks, that's all") gets no nudges.
2. **Will you come back in time?** Each idle stretch is remembered: when the chat went idle, and when you came back (or that you haven't yet). Only times are kept, no text. Once 20 stretches have closed, the router knows how likely people on this machine are to come back at each hour of the day. Before each nudge it checks whether the nudges still allowed cost less than the rebuild they could save, given those chances. A nudge is one cached read; a rebuild is about 40 reads on Opus and Sonnet, 80 on Fable.

So a chat left late at night that is rarely picked up again stops being nudged, and one you usually come back to keeps going. This is learned from your own use, not from fixed hours. When it stops because you're unlikely back soon, it still compacts the chat into a handoff if you're likely to return later. Only your own messages count as coming back, not a notification or another session's message.

## Why a smaller compaction point can pay

A chat that compacts at a point grows from what a compaction leaves up to that point, then starts again. Each step pays about a half-way read plus a share of one compaction. A lower point means cheaper steps but more compactions; the Settings note shows where the two balance for your chat.

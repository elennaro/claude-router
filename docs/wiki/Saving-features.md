# Saving features

All of these are switchable in **Settings**. Each one is about the prompt cache: a cached read costs a tenth of fresh input, and rebuilding the cache costs the most.

| Feature | What it does | Turn it off when |
|---|---|---|
| **Move down** | Moves the chat to a cheaper model by itself, only when the cache rebuild pays back | you want the chat to stay put no matter what |
| **Helpers** | Two shipped subagents, document-reader and web-researcher, sized per brief: Haiku for finding things, Sonnet for judgment | you never want reading done outside the main chat |
| **Big pastes** | A message over about 10K tokens is saved to a temp file and read first by Haiku or Sonnet; the chat gets the analysis plus the file path | you paste text the main model must read word for word (or start the message with "raw") |
| **Keep awake** | 50 minutes after the last step, a hidden one-line nudge keeps an idle chat's cache warm, for up to the hours you set; then it compacts the chat as a handoff | you work on API keys with a 5-minute cache (it turns itself off then), or never leave chats idle |
| **Compact at** | Your own compaction point for this chat, with the cheapest point marked; **Make it my default** writes it to `~/.claude/settings.json` | you are happy with Claude Code's own window |

## Why keep awake pays

After an hour idle, your next message re-reads the whole chat at the cache-write price, about 40 times a cached read. A nudge reads it from cache instead. On a big chat, one avoided rebuild pays for many nudges. No nudge is sent while a question or permission dialog is waiting on you.

## Why a smaller compaction point can pay

A chat that compacts at a point grows from what a compaction leaves up to that point, then starts again. Each step pays about a half-way read plus a share of one compaction. A lower point means cheaper steps but more compactions; the Settings note shows where the two balance for your chat.

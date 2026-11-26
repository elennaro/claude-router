# FAQ

**The band says "$x extra". Is the router wasting money?**
Not necessarily. Extra is spend above no router: a raised effort on a hard or unhappy task, a stronger model you pressed a button for, the classifier's own Haiku calls, or keep-awake nudges. Stats → *Where it went* names the biggest extra. Saved and extra are summed apart on purpose.

**The week shows a bigger saving than the month around it. How?**
The Board's net is saved minus extra. If the extra days are in the month but not the week, the month's net is smaller. Saved alone only grows with a longer range. The line under the totals shows saved and extra apart. More in [Stats and the Board](Stats-and-Board.md).

**Can I see savings as a share of my plan instead of dollars?**
Settings → *Units* → **Plan %**. It is priced from what this machine spent per point of your weekly limit this week, so spend on other devices makes it read high.

**I turned routing on in one session, but another still says it's off.**
Other open sessions pick up the change within about 10 seconds, or on their next prompt.

**How do I stop keep awake for one chat only?**
Settings → *This chat* → *Keep awake* → Off, or **Stop for this chat** on the away report.

**It moved my chat to Sonnet. I want Opus back.**
Press **Undo** on "Picked X for this chat", pick Opus in Settings → *Model*, or say "use opus from now on".

**I wrote "ultrathink" and the router did nothing.**
On purpose. A prompt with "ultrathink" or "ultracode" runs as you set it, and so does every agent under it and every workflow agent. The router only measures those turns. Claude Code's session-wide ultracode switch is not visible to plugins.

**A switch was wrong. How do I tell the router?**
Turn on Settings → *Training*, then press **Switches** on the band and 👎 the switch. A model pick or effort change goes back; a quick turn or subagent run is already over, so it is only recorded. The labels stay in `router.db` on this machine.

**Can I stop it touching the model and only set effort?**
Settings → *This chat* → *Effort*, or `/route models off`.

**I don't see the keep-awake nudges.**
They are hidden on purpose. ctrl+o shows the nudge. Stats → *Keep awake* shows how many ran and what they cost.

**Will a nudge break a question I haven't answered?**
No. While a turn is open (a question, a permission dialog) no nudge is sent.

**Routing works, but Stats and the Board are empty.**
The ledger needs Node.js 22.13+ on PATH. A toast says so when it is missing.

**I write prompts in another language.**
The keyword rules are English only; the Haiku classifier reads any language. When it is unsure, the prompt runs at the default. For production code, raise the project's default in `.claude/routing.json`:

```json
{ "main": { "model": "opus", "effort": "high" } }
```

**Code mode won't start.**
Code mode refuses plugins that hook tool calls or subagent spawns, and the router hooks both. Disable the plugin for a code-mode session.

**I edited routing.json and nothing changed.**
Run `/route reload`.

**Where is my data?**
`~/.claude/router/router.db`: token counts and spend. The only text kept is the first 60 characters of a chat's first prompt, with long tokens masked. With Settings → *Training* on, the prompts of the turns the router switched or kept are kept too, masked, on this machine only, as training data for a local router. Big pastes sit in `~/.claude/router/pastes/` until the session ends.

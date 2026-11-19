# claude-router

A Claude Code plugin that picks the model and effort for every turn, subagent and outside-agent call: hard work and production-code investigation get Opus at high effort, a chat that opens with a message, translation, lookup, long read, data or test task starts on Sonnet, subagents on defined tasks go to Sonnet and lookups to Haiku, and nothing drops below the tier its work needs. Fable is offered as a button, never picked automatically.

What it buys, measured on 283 real-work cases ([evals/README.md](evals/README.md)): answers judged 15.6% better than always running Opus medium, for about 1.2× its spend. It spends more where that pays off. It moves work to Sonnet only where Sonnet's answers passed the person's checklist as often as Opus medium's did.

```
/plugin marketplace add OWNER/claude-router
/plugin install router@claude-router
```

Needs Claude Code 2.1.325+ and Node.js 22.13+ (for the spend ledger). Full docs: [router/README.md](router/README.md).

| Folder | What is in it |
|---|---|
| `router/` | the plugin |
| `evals/` | the eval suites and their release gates ([evals/README.md](evals/README.md)) |
| `docs/` | design notes and research |

Contributing: [CLAUDE.md](CLAUDE.md) has the layout, commands and rules.

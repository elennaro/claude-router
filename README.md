# claude-router

A Claude Code plugin that picks the model and effort for every turn, subagent and outside-agent call: hard work and production-code investigation get Opus at high effort, lookups inside subagents go to Haiku, and nothing drops below the tier its work needs. Fable is offered as a button, never picked automatically.

What it buys, measured on 279 real-work cases ([evals/README.md](evals/README.md)): answers judged 15.6% better than always running Opus medium, for about 1.3× its spend. It spends more where that pays off; it is not a cost cutter, because in the evals every cheaper tier lost quality on chat answers.

```
/plugin marketplace add OWNER/claude-router
/plugin install router@claude-router
```

Needs Claude Code 2.1.325+ and Node.js 22.13+ (for the savings ledger). Full docs: [router/README.md](router/README.md).

| Folder | What is in it |
|---|---|
| `router/` | the plugin |
| `evals/` | the eval suites and their release gates ([evals/README.md](evals/README.md)) |
| `docs/` | design notes and research |

Contributing: [CLAUDE.md](CLAUDE.md) has the layout, commands and rules.

# claude-router

A Claude Code plugin that picks the model and effort for every turn, subagent and outside-agent call, so hard work gets more thinking and simple work doesn't pay for it.

- **Production-code investigation** (debugging, code review, security review) always runs on Opus at high effort.
- **Simpler chats start on Sonnet**: a chat that opens with a message to write, a translation, a lookup, a long read, data or test work.
- **Subagents** on defined tasks go to Sonnet, lookups inside them to Haiku. Nothing drops below the tier its work needs.
- **When you're not happy** with the answers ("still broken", "you missed X", in any language), the effort goes up for that task, and a stronger model is offered as a button.
- **Fable is never picked automatically**: it is only ever offered, and you decide.
- **Your words win**: "use sonnet", "high effort", "think harder" beat every rule.

What it buys, measured on 283 real-work cases ([evals/README.md](evals/README.md)): answers judged 15.6% better than always running Opus medium, for about 1.2× its spend. It spends more where that pays off, and moves work to Sonnet only where Sonnet's answers passed the person's checklist as often as Opus medium's did. It is a quality router first, not a savings tool.

## Install

```
/plugin marketplace add elennaro/claude-router
/plugin install router@claude-router
```

Needs Claude Code 2.1.325+. Node.js 22.13+ on PATH for the spend ledger (routing works without it). No setup: built-in rules apply until you add a `~/.claude/routing.json`. Full docs: [router/README.md](router/README.md).

## What you see

One row above the prompt: the model and effort now, what the router saved or spent extra against running with no router, and the prompt-cache hit. **Stats** shows this chat's spend by model, cost per turn against no router, and cache hit per turn. **Board** opens a page with every session and project. **Settings** turns routing on or off per project or chat and lets you pin a model or effort.

## Privacy

- The classifier sends each new prompt (and, for the unhappy check, the end of the last answer) to Haiku through your own Claude Code session. Nothing goes anywhere else.
- The local ledger (`~/.claude/router/router.db`) keeps token counts and spend. The only text it keeps is the first 60 characters of a chat's first prompt, to name it on the Board, with long tokens such as keys masked.
- The eval cases in `evals/` are written to look like real work but name no real person, company, place or project; each set passed a term scan and a model attack before publishing.

## Repository

| Folder | What is in it |
|---|---|
| `router/` | the plugin |
| `evals/` | the eval suites, their release gates and reports ([evals/README.md](evals/README.md)) |
| `docs/` | design notes, research, and lessons from building it |

Contributing: [CLAUDE.md](CLAUDE.md) has the layout, commands and rules. Checks: `claude plugin test router` and `node evals/fast.mjs` (replays every suite from the store for $0).

## Credits and license

The judge calibration downloads public datasets at run time and does not ship them: [JudgeBench](https://huggingface.co/datasets/ScalerLab/JudgeBench) (MIT), [CodeJudgeBench](https://huggingface.co/datasets/mattymchen/codejudgebench) (Apache-2.0), [Kotlin HumanEval](https://huggingface.co/datasets/JetBrains/Kotlin_HumanEval) (Apache-2.0) and [code-readability-merged](https://huggingface.co/datasets/se2p/code-readability-merged) (no license stated). No third-party code is included.

MIT, see [LICENSE](LICENSE).

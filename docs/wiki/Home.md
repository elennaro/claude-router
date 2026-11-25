# claude-router wiki

Short pages for people who use the router. The full spec is [router/README.md](../../router/README.md).

| Page | Read it when |
|---|---|
| [What's new](Whats-new.md) | you updated and want to know what changed |
| [How it works](How-it-works.md) | you want the picture: what decides the model and effort, and when |
| [Saving features](Saving-features.md) | you want to know what Move down, Helpers, Big pastes, Keep awake and Compact at do |
| [Stats and the Board](Stats-and-Board.md) | a number in the band or the Board puzzles you |
| [The ledger](Ledger.md) | you want to know what is recorded, for how long, and how to query where extra spend went |
| [FAQ](FAQ.md) | something looks wrong, or you want to turn a part off |

## In one paragraph

The router picks the model and effort for every turn, subagent and outside-agent call. Hard work (debugging, code review, security) gets Opus high. Simple work gets cheaper models only where they passed the same checks. It changes effort freely, because that keeps the prompt cache. It changes the model only when the switch pays for rebuilding the cache, and it never moves you up by itself. Fable is only ever offered. Your own words ("use sonnet", "high effort") beat every rule.

In real use so far (8 days): 1.7% more spend than with no router. The ledger now records each step's effort, class and reason, so the raises that don't pay can be found and cut.

## Install

Two `/plugin` commands, listed in the [README's Install section](../../README.md#install). Needs Claude Code 2.1.325+, and Node.js 22.13+ on PATH for the spend ledger.

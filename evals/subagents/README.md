# Subagent routing eval

Tests the `agent.spawn` hook: which model and effort a subagent gets from its type or its brief.

## Cases

- `cases.jsonl`: 40 briefs. `agentType` (general-purpose, claude, custom unpinned types, Explore), `kind`
  (mechanical, explore, code-review-prod, debugging-prod, internal-code, docs, research, scoped-code, custom, short),
  `project`, `parentModel`/`parentEffort`, the `brief`, and for a few `priorModel` (the same brief spawned again) or
  `siblingModel` (a workflow sibling already runs on it).
- `labels.jsonl`: Opus high and Fable high labels and the `need` tier. Same model with effort within one step =
  agreed (the higher effort). Otherwise production-code investigation takes the stronger label, everything else
  takes Fable's.

Written fresh by Opus from the shape of real briefs (`../session/mine-windows.mjs`, private), anonymized with
`../audit-json.mjs`, labeled with `label.mjs`.

## Run

From `evals/`, in Git Bash:

```
node subagents/run.mjs      # 3 runs per brief, at most 1 Haiku call per run, ~$1
node subagents/report.mjs   # -> results/subagents-report.md
```

The runner mirrors `register.tsx`: a type in the routing table (`~/.claude/routing.json` over BUILTIN) uses its entry;
any other type goes through `briefClass` (rules, then one Haiku sample; briefs under 12 characters are left alone) and
`briefTier` (only a sure >= 0.85 class moves it; unsure = the parent's model; Fable never automatic), then the
repeat climb (`stepUp`) and the sibling floor. Effort is the tier's, else the parent's. Frontmatter pins and explicit
per-call models are not tested: the plugin passes them through untouched.

## Gates and numbers

| Number | Meaning | Pass |
|---|---|---|
| False cheap | briefs where any of 3 runs got a weaker model, or the same model 2+ effort steps lower, than needed | <= 3% |
| Moved | share of runs that left the parent's model | info |
| Unstable | briefs whose 3 runs got different tiers | info |

Each false-cheap brief is listed with its 3 runs, the class Haiku gave and the needed tier.

# Session check eval

Tests the mid-session check (docs/research-session-routing.md D2/D3): at a compaction, a finished todo list, an
approved plan or every 20 turns, Haiku reads the window 3 times and `adviseSwitch` may offer a switch up or down.

## Cases

- `cases/<category>.jsonl`: 8 cases each in topic-shift, difficulty-drop, difficulty-rise, stay, struggle, misleading,
  ru-mixed, explicit-ask. A case is the window the check sees (`window.prompts`, `window.todos`, `window.plan`), the
  state (`model`, `turns`, `trigger`), the `gold` answer (`action` none/up/down, `model`, `kind` compact/fresh) and a
  one-line `rationale`. `intent` and `writerRationale` are the case writer's own answer, kept for reference only.
- `cases/sequence-*.jsonl`: 10 sessions with 3-4 checkpoints each (same fields per checkpoint), to catch A->B->A flips.
- `labels.jsonl`: both labelers' raw answers per checkpoint and how the gold was chosen (`by`).

Built from the owner's real sessions (shape only), written fresh by Opus and anonymized:
`mine-windows.mjs` (private, to `work/`), `generate.mjs`, `../audit-json.mjs`, `label.mjs`.
Labels: Opus high and Fable high independently. Same action and model = agreed. Otherwise production-code
investigation takes the stronger label, everything else takes Fable's.

## Run

From `evals/`, in Git Bash (spend counts against `EVAL_CAP_USD`, the total in `work/spend.jsonl`):

```
node session/run.mjs      # 3 whole runs (RUNS=3), ~1,300 Haiku calls through claude -p, under $1
node session/report.mjs   # -> results/session-report.md
```

The runner mirrors the plugin exactly: `sessionCheckSystem`, `sessionCheckPrompt`, `parseSessionCheck`, `adviseSwitch`
from `router/hooks/policy.ts`, and from `register.tsx` the window format, "no offer of the same family" and "quiet for
10 turns after an offer". `lastClass` is what the plugin's classifier would leave (rule, else one Haiku sample on the
newest non-continuation prompt). Sequences run twice: as written for the metrics, and following the router's own
offers (accepted) for the flip count. Differences from the plugin: 60 s timeout instead of 8 s, and `claude -p` has no
40-token output cap.

## Gates

| Gate | Meaning | Pass |
|---|---|---|
| Proposal precision | offers with the gold action and model / all offers. Wrong buttons teach the owner to ignore them | >= 85% |
| False downgrade | offers landing on a cheaper model than gold / all checkpoints. The costly error | <= 3% |
| Missed upgrade | gold says up, no up offered / gold ups | <= 10% |
| Flips | A->B->A in the router's model path on a sequence, beyond what gold's own path does | 0 |

Haiku answers vary run to run and the labels are opinions (judge noise measured at ~20% on single verdicts), so read
the numbers as rates with wide error bars: one case is ~1.0-1.5 points.

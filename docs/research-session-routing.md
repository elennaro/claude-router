# Research: whole-session model switching

Date: 2026-11-18. Public sources only. Every claim has a URL. Lines marked **Guess** are my inference, not a source.

## Short answer

1. Anthropic's own line: effort is the first lever, model the second. "Tuning effort is often a better lever than switching models." Fable is for work where Opus at `xhigh`/`max` still falls short, not a task type you pick up front.
2. In Claude Code, on the 5.5 models and Fable 5.1+, an effort change keeps the prompt cache (API key or subscription). A model change never does. So effort can change every turn. The model should change only at cache boundaries: the first prompt, right after compaction, or a new session.
3. GitHub Copilot Auto does exactly this. It picks the model after the first prompt and re-routes only "at natural cache boundaries": the first turn and after compaction. OpenRouter Auto prefers to change effort and switches models "only when the gain is worth it". Cursor routes every request and accepts the cache misses.
4. Measured cost of a mid-session switch is small but real. In Anthropic's test, a cache-breaking change mid-session cost $0.20 more per session than the same change at a boundary ($0.95 vs $0.75 total).
5. Claude Code already gives a plugin what it needs. The `PreModelSwitch` hook receives `context_tokens`, `prompt_cache_warm` and `estimated_cache_write_usd`, and can answer `ask`.

---

## A. What Anthropic says

### Model choice
Source: https://platform.claude.com/docs/en/about-claude/models/choosing-a-model

1. "Most workloads start with Claude Opus 5.5."
2. The selection matrix:
   - **Fable 5.2:** "Agent sessions that run for hours, multistep deep research, analysis carried through to a finished document, spreadsheet, or deck."
   - **Opus 5.5:** "Multihour autonomous coding agents, large-scale refactoring, complex systems engineering, vision-heavy workflows, computer use."
   - **Sonnet 5.5:** "Code generation, data analysis, content creation, visual understanding, agentic tool use."
   - **Haiku 5.5:** "Real-time applications, high-volume intelligent processing, … subagent tasks."
3. Escalation path, capability-first: implement on Opus 5.5, then lower effort or downgrade over time. Move to Fable 5.2 only "if your evals at `xhigh` or `max` effort still fall short on demanding reasoning or long-horizon agentic work."
4. Fable's own page says the same thing. "For most workloads, start with the latest Claude Opus model … and move to Claude Fable 5.2 when your evals on a Claude Opus model at higher effort still don't meet your requirements." https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2
5. The Claude Code article frames it as a question: did it "not *try* hard enough, or did it not *know* enough?" Not trying hard enough calls for more effort. Not knowing enough calls for a bigger model. It also says:
   - "Pick a larger model when the problem is genuinely hard" (subtle bugs, unfamiliar domains, architecture decisions).
   - Smaller models suit "edits you can describe precisely, mechanical changes, or questions about code that's already in context."
   - On Fable: "it finished jobs Opus and Sonnet can't reach at any effort level", meaning long multi-step work.
   - "For most tasks you should use the model's default effort level."
   - On hard multi-step work, total cost "can come out lower" on the larger model, because it needs fewer steps.

   https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code

**Is any task type "Fable only"?** No. Anthropic never says a task class needs Fable. It says start on Opus and move up when Opus at high effort fails. The three Fable rows in the matrix (hours-long agent runs, multistep deep research, analysis carried through to a finished deliverable) are "consider starting with" hints, not requirements. **Guess:** those three are the only defensible candidates for a Fable *suggestion* on the first prompt. They don't justify an automatic upgrade.

### Effort, chosen separately from the model
Source: https://platform.claude.com/docs/en/build-with-claude/effort

1. API defaults:
   - `medium` on Opus 5.5 and Haiku 5.5.
   - `high` on Fable 5.2 and Sonnet 5.5.
2. Claude Code defaults differ. "Fable 5.2, Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`." https://code.claude.com/docs/en/model-config
3. Fable 5.2:
   - "Most of the gain in capability is already present at `high`."
   - Use `xhigh` for the hardest long-running work "where you've measured a gain".
   - `max` is "for measuring the model's ceiling".
4. Sonnet 5.5:
   - For agentic coding, "start with `medium` for well-specified tasks and move to `high` for harder or longer ones."
   - Use `medium` or `low` for chat.
5. Haiku 5.5:
   - Start at `medium`. Use `low` for chat and short tool tasks.
   - At `low`, "the model is more likely to skip a search, stop early, or skip a check" in long agent prompts.
   - Use `high` for knowledge work and strict instruction following.
6. Best practice: "Consider dynamic effort … Simple queries might warrant low effort", and use per-message effort to keep the cache.

### Big model at low effort vs small model at high effort (measured)
Source: https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence

Internal coding benchmark, cost per attempt:

| Config | Pass | $/attempt |
|---|---|---|
| Opus 5.5 low | 74.8% | 0.35 |
| Opus 5.5 medium (default) | 86.6% | 0.84 |
| Opus 5.5 high | 88.4% | 1.38 |
| Opus 5.5 xhigh | 91.1% | 4.11 |
| Sonnet 5.5 high (default) | 77.8% | 0.33 |
| Sonnet 5.5 medium | 62.7% | 0.16 |

What this shows: on this coding set, **Opus at `low` roughly matches Sonnet at `high` for about the same cost** (74.8% at $0.35 vs 77.8% at $0.33). Sonnet at `medium` drops sharply. The same page reports a SWE-bench Pro result: Opus 5.5 at `medium` scored about 2.5 points below `high` for about 70% of the cost. At `low` it scored about 8 points lower for about a third of the cost.

**Guess:** for coding, the cheap end of the quality frontier is "Sonnet high ≈ Opus low", and "Sonnet medium" sits well below it. The router should not treat Sonnet medium as a safe default for real coding.

### Advisor / escalation pattern
- The advisor helps "only when the executor consults it". When the executor rarely consulted, results were within noise of the executor alone, or lower.
- A consult that fires on most tasks "costs more than running the stronger model itself."

  https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- In Claude Code, `/advisor` toggling **keeps** the main model's cache. The advisor re-reads the full transcript on every call, uncached. https://code.claude.com/docs/en/advisor
- **Guess:** for "hard first task on a cheap model", an advisor is a cache-safe middle ground. Use it instead of a full model switch when only a few decisions are hard.

### Multi-agent (engineering blog)
- Token usage explained about 80% of performance variance on BrowseComp.
- Multi-agent systems use about 15× the tokens of chat.
- Effort rules were embedded in prompts: 1 agent and 3–10 tool calls for a simple lookup, more than 10 subagents for complex research.
- Their eval started with about 20 real queries and an LLM judge with a rubric.

  https://www.anthropic.com/engineering/multi-agent-research-system

---

## B. How other routers decide

| System | When it decides | Signals | Cache / oscillation handling | How it's evaluated |
|---|---|---|---|---|
| **GitHub Copilot Auto** (HyDRA) | After the first prompt, then only "at natural cache boundaries": first turn and after compaction | Task intent: reasoning depth, code complexity, debugging difficulty, tool orchestration. Model health. For long agent sessions, trained on full multi-turn conversations (original intent, recent replies, metadata) | Says switching mid-conversation "breaks that cache, which can cost more than the routing change saves". Stays on one model between boundaries | Offline labels: weak vs strong model answers scored on quality. Held-out telemetry set across 19 languages. SWE-bench: ties OpenRouter Auto (70.8%) at 3.3× the savings |
| **OpenRouter Auto** | Per request, session-aware | A fast model rates 11 aspects (task type, difficulty, speed need, vision, codebase). Also "how much context is already cached" and whether the model is struggling | Prefers changing effort and switches models "only when the gain is worth it". Session id or message fingerprint keeps requests sticky | Not published |
| **Cursor Router** (Auto) | Per request | ML classifier on "task type and complexity". Picks "the cheapest model that still produces comparable results" | Cache resets on a model change. A forum post (staff status unconfirmed) says savings hold "even accounting for cache misses" | Claims Intelligence mode gives about 20–30% higher quality. Method not given |
| **Not Diamond** | Per query | Input analysis only (signals not published). Quality, cost or latency mode. Custom routers trained on your evals | Not covered | Not published |
| **Claude Code `opusplan`** | Per mode: Opus in plan mode, Sonnet for execution | The user's plan-mode toggle | Every toggle is a model switch and a fresh cache | None published |
| **Aider architect/editor** | Every request, two calls in a fixed split | Role (reason vs format edits) | Not applicable | Fixed benchmark. o1-preview + DeepSeek editor scored 85% vs o1-preview alone at 79.7% |
| **RouteLLM** (LMSYS) | Per query, two models | Prompt only. Predicts win probability of strong over weak. Route strong if P ≥ α | Not applicable (single-turn) | APGR and CPT(x%): the strong-model call share needed to recover x% of the quality gap. On MT Bench, matrix factorization reached CPT(50%) = 13.4% and APGR 0.802. Arena-only routers did no better than random on MMLU and GSM8K (out of distribution) |
| **FrugalGPT** | Cascade per query | A scorer judges the cheap answer; escalate if below threshold | Not applicable | Matches GPT-4 "with up to 98% cost reduction" |
| **AutoMix** | Cascade per query | The small model's self-verification plus a POMDP meta-verifier | Not applicable | Over 50% cost cut at comparable quality |
| **Hybrid LLM** | Per query | Predicted difficulty / quality gap. Threshold tunable at test time | Not applicable | "Up to 40% fewer calls to the large model, with no drop in response quality" |
| **Multi-turn research (2025–26)** | Per turn, history-aware | SWRouter: similarity-based segmentation of history, which avoids both "information loss" and "information confusion" from stale turns. DialRouter: long-horizon planning instead of "myopic" per-turn choice | DialRouter adds a cost-aware reward. None model cache loss explicitly (from abstracts) | SWRouter scores routing and context-building separately |

Sources:
- Copilot: https://github.blog/ai-and-ml/github-copilot/getting-more-from-each-token-how-copilot-improves-context-handling-and-model-routing/
- OpenRouter: https://openrouter.ai/docs/guides/routing/routers/auto-router
- Cursor: https://cursor.com/help/models-and-usage/cursor-router and https://forum.cursor.com/t/model-changes-mid-conversation-in-the-auto-routers/166831
- Not Diamond: https://docs.notdiamond.ai/docs/what-is-model-routing
- opusplan: https://code.claude.com/docs/en/model-config
- Aider: https://aider.chat/2024/09/26/architect.html
- RouteLLM: https://arxiv.org/html/2406.18665v4 and https://lmsys.org/blog/2024-07-01-routellm/
- FrugalGPT: https://arxiv.org/abs/2305.05176
- AutoMix: https://arxiv.org/abs/2310.12963
- Hybrid LLM: https://arxiv.org/abs/2404.14618
- SWRouter: https://arxiv.org/abs/2609.11414
- DialRouter: https://arxiv.org/abs/2604.12385

Martian: I found no public method details, so it's left out rather than guessed.

**Patterns worth copying**
1. Session-level routers that care about cost (Copilot, OpenRouter) decide at cache boundaries and change effort freely in between.
2. They read conversation state, not only the last prompt: original intent, recent turns, signs the model is struggling.
3. Thresholds are tuned on a cost–quality curve, not set by hand (RouteLLM α, Hybrid LLM test-time threshold).
4. Routers trained on one distribution fail on another (RouteLLM on MMLU and GSM8K). Labeled cases must look like the owner's real sessions.

---

## C. Switching mid-conversation

### Facts (proved by docs)
1. "Each model has its own cache. Switching with `/model` means the next request reads the entire conversation history with no cache hits." https://code.claude.com/docs/en/prompt-caching
2. Effort changes keep the cache "on Fable 5.1 and later, Opus 5.5, Sonnet 5.5, and Haiku 5.5" with an API key or subscription. On Bedrock, Vertex, a gateway, or HIPAA setups, they don't. Same page.
3. Compaction "invalidates the conversation layer" anyway. The summary request reads the warm cache on the current model, and "the turn after compaction rebuilds the conversation cache for only the much shorter history." So **compact, then switch** pays one summary request on the old model plus a cache write of the short summary on the new one. Same page.
4. What survives compaction:
   - CLAUDE.md, auto memory and the plan-mode plan, all re-injected.
   - Up to 5 recently modified files, re-read.
   - Skill bodies, capped.
   - `SessionStart` hooks with source `compact`, which run again.

   https://code.claude.com/docs/en/context-window
5. `/clear` "costs nothing" when you want a fresh start. The docs say to clear "when switching to unrelated work". https://code.claude.com/docs/en/costs
6. Measured cost of where a break happens (Sonnet 5, 5 sessions per arm):
   - No change: $0.81 per session.
   - Change at a boundary: $0.75.
   - Change mid-session: $0.95.

   "Make cache-breaking changes at the compaction boundary, not mid-session." https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
7. Moving *off* Fable 5.2 to any other model drops Fable's thinking blocks for those turns. The reasoning is lost, though not billed. Moving *onto* Fable keeps reasoning from Opus, Sonnet and Haiku 5.5. https://platform.claude.com/docs/en/models/fable-5-2/whats-new-fable-5-2
8. The `PreModelSwitch` hook gets:
   - `context_tokens`, `prompt_cache_warm`, `cache_ttl` and `estimated_cache_write_usd`.
   - `source`: `command`, `picker` or `sdk`.

   It can return `allow`, `deny` or `ask`, and fires for `/model`, the pickers, and SDK `set_model`/`apply_flag_settings`. `PostCompact` gets `trigger` and `compact_summary`. https://code.claude.com/docs/en/hooks
9. Claude Code already confirms a `/model` switch only while the cache is warm. Once the TTL has passed, the switch is free. https://code.claude.com/docs/en/prompt-caching
10. Default cache TTL: 1 hour for the main conversation on a subscription within plan usage, 5 minutes on API key or credits. Same page.

### Switch-cost arithmetic (list prices, 5-minute write)
Switch penalty ≈ `context_tokens` × new model's cache-write price, minus the cache read you'd have paid anyway.

| Switch | at 150K context | at 15K (after compaction) |
|---|---|---|
| Opus → Sonnet | 150K × $2.50 = **$0.375** | $0.04 |
| Sonnet → Opus | 150K × $5 = **$0.75** | $0.075 |
| Opus → Fable | 150K × $10 = **$1.50** | $0.15 |
| Any → Haiku | 150K × $0.625 (>100K tier) = $0.09, but every later request is billed at the >100K rate | $0.002 |

Per-request savings after Opus → Sonnet at 150K context: the cache read drops by $0.015 ($0.03 → $0.015), and output is half price. With about 2K output tokens per request, that's about $0.035 saved per request. **Break-even ≈ 10 model requests.** An agentic user turn often makes 5–30 requests (tool calls), so that's about 1–2 user turns. **Guess:** a downgrade at full context pays off only if several substantial turns remain. After compaction, it pays off almost at once.

### Topic shift and difficulty from context
- Copilot trains its router on multi-turn context: original intent, recent assistant replies, metadata.
- OpenRouter adds a "model is struggling" signal.
- SWRouter warns that both too little history and stale history hurt routing. It segments history by similarity.

**Guess:** cheap topic-shift signals, in order of reliability:
1. A new todo list replaces a finished one, or a plan is approved.
2. The user says so in words ("next", "now let's", "different thing").
3. The new prompt names files or areas not touched in the window.
4. Embedding or lexical distance from the window.

Difficulty signals from state:
- Number of pending todos and how they're phrased.
- Repeated test failures or reverts.
- The user correcting the model ("no, that's wrong").
- The share of turns that are mechanical edits vs design questions.

None of this was found as published, validated guidance. Needs testing.

---

## D. Recommended shape

### D1. First prompt
**Inputs:** the first prompt, the existing Haiku classifier output (tier and effort), any explicit ask, and project floors.

**Rule:**
1. An explicit ask wins, as already settled in DESIGN.md.
2. Choose **effort and model separately**. The classifier outputs (model, effort). Effort is always applied, because it's cache-free on the 5.5 models.
3. **Easy class with high confidence** (3/3 classifier runs agree on haiku/sonnet, no floor hit): auto-set the session model before the first request goes out. There's nothing cached yet, so it's practically free. Show a one-line notice with an "undo" button.
4. **Hard class:** stay on the default (Opus) and auto-set effort.
   - Offer a one-click Fable button only for Anthropic's three Fable rows: hours-long agent runs, multistep deep research, finished document/deck/spreadsheet.
   - **Do not auto-upgrade to Fable.** Anthropic's guidance is to escalate only after Opus at high effort falls short (sources in section A).
   - Optional: suggest `/advisor fable` instead of a switch when the task is mostly routine with a few hard decisions.
5. **Unsure (2/3 agree):** don't switch. Effort only.

**Mechanism note (not verified here):** hooks can't set the model, as far as the hooks reference shows. A `set_model`/`apply_flag_settings` request does fire `PreModelSwitch` with `source: "sdk"`. Check that the router's existing switch path runs before the first API request. Otherwise you pay a write of the system prompt and project context, about 10–20K tokens, which is small either way.

### D2. Mid-session "session check"
**Triggers** (any one; at most one check per trigger):
1. `PostCompact`. This is the best moment, because the switch is nearly free. Copilot uses only this and the first turn.
2. The todo list is fully done and a new one appears, or a plan is approved (ExitPlanMode).
3. A topic shift: an explicit phrase, or new files/areas outside the window.
4. Every 20 user turns, as a fallback.
5. Struggle signals: 3 or more failed test runs or reverts in the window, or the user correcting the model twice. These count toward **upgrade only**.

**Inputs:**
- The last 5–8 user prompts, truncated to about 300 tokens each.
- The current todo list (pending and done).
- The plan file if present.
- The last assistant summary or `compact_summary`.
- The current model and effort, `context_tokens`, cache warm or cold.
- Turns since the last proposal, and whether the user declined it.
- Struggle counters.

Target is 4–8K input tokens.

**Who runs it:**
- Haiku 5.5 at `medium` (or `low` for the topic-shift sub-question), 3 samples.
- Cost at 8K in and 300 out per sample: ~$0.001 per sample, ~$0.003 per check.
- Even at 50 checks a day that's ~$0.15.
- **Guess:** escalate the check itself to Sonnet only if Haiku's 3 samples split and the decision is a downgrade. A Sonnet check costs ~$0.02.

**Output:** remaining-work tier (model, effort), confidence (agreement k/3), action (`none` / `effort` / `compact+switch` / `new-session`), and a one-line reason.

**Decision rule (hysteresis):**
1. Effort changes are applied directly when 2/3 or more agree, moving at most one step per check. They're cache-free.
2. Model changes are *proposed* only when all of these hold:
   - **Agreement.** Upgrade: 2/3 or more. Downgrade: 3/3. Asymmetric because false-cheap is the costly error, which matches the eval gate "false cheap ≤ 3%".
   - **Gap of at least one tier,** and the new tier must be stable. The previous check, if any, must not have pointed the other way.
   - **Money test for downgrades:** estimated savings on remaining work ≥ 2× switch cost.
     - Switch cost = `estimated_cache_write_usd`, or context × write price.
     - Remaining work ≈ pending todos × typical requests per todo.
     - When cold or just compacted, the cost is ~0, so the test passes easily.
   - **Cool-down:** no new proposal for 10 turns after one is shown. After a decline, none until the next trigger of a *different* kind. A decline at compaction suppresses until a topic shift.
   - **No downgrade from Fable mid-task** while the cache is warm (Fable thinking is lost). Wait for compaction.
3. Action chosen:
   - Topic is unrelated to the window: offer **new session** (`/clear` is free), carrying a short handoff note.
   - Same task, different difficulty: offer **compact then switch**. If the cache is cold, offer a plain switch, since there's nothing to lose.
   - Remaining work is small (≤ 2 todos): do nothing.
4. Never switch automatically mid-session. Always a button. Exception: right after `PostCompact` with 3/3 agreement on an *effort-only* change.

### D3. Eval
A labeled **session case**, one JSON per case:

```json
{
  "id": "sess-042",
  "category": "topic-shift | difficulty-drop | difficulty-rise | stay | struggle | misleading | ru-mixed | explicit-ask",
  "trigger": "post_compact | todo_rollover | topic_shift | turn_20 | struggle",
  "window": {
    "recent_prompts": ["...", "..."],
    "todos": [{"text": "...", "status": "pending"}],
    "plan": "... or null",
    "last_summary": "...",
    "struggle": {"failed_tests": 0, "user_corrections": 0}
  },
  "state": {"model": "opus", "effort": "medium", "context_tokens": 140000, "cache_warm": true,
            "turns_since_proposal": 25, "last_declined": false},
  "gold": {"tier": {"model": "sonnet", "effort": "high"},
           "acceptable": [{"model": "opus", "effort": "low"}],
           "action": "compact+switch", "propose": true},
  "rationale": "remaining 4 todos are mechanical renames; plan already fixed"
}
```

Also include **sequence cases**: one session with 3–4 checkpoints, where the gold says what to do at each. These test oscillation. Score the flip rate.

**Metrics and gates:**

| Metric | Why | Proposed gate (**guess**, tune on the curve) |
|---|---|---|
| Proposal precision (proposed and correct / proposed) | Wrong buttons train the owner to ignore them | ≥ 85% |
| False downgrade (proposed cheaper than gold) | The quality goal | ≤ 3% (same as existing gate) |
| Missed upgrade (gold upgrade, none proposed) | The quality goal | ≤ 10% |
| Flip rate on sequence cases | Oscillation | 0 A→B→A flips within a sequence |
| Net $ on replay | Savings must include the switch cost | > 0 on every category |
| Remaining-work quality | Reuse layer 3: replay the rest of the session on the proposed model, Fable judges blind vs the default, Opus re-judges every "worse" | ≥ 90% good or acceptable |

**Method notes from Anthropic's own eval guidance:**
- Repeat the baseline first, since run-to-run noise is several points.
- Hold out a split you never tune on.
- Plot the cost–quality curve over the confidence threshold, RouteLLM-style CPT/APGR, instead of picking one threshold by hand.

https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence

**Size (guess):** about 8 categories × 8 cases, plus 10 sequence cases, ≈ 75 cases. Build them the same way as DESIGN.md §14–15: shape from real sessions, written fresh, anonymized.

---

## E. Subagent routing

### E1. What Claude Code does on its own
Source, unless noted: https://code.claude.com/docs/en/sub-agents

**Built-in agents**

| Agent | Default model |
|---|---|
| Explore | Subscription, Console or `ANTHROPIC_BASE_URL` gateway: "the Opus model that the `opus` alias resolves to". Bedrock, Vertex, Foundry, Claude Platform on AWS, apps gateway: "stays on Fable". Read-only, starts without CLAUDE.md or git status |
| Plan | Inherits the parent. Read-only |
| general-purpose | "the parent conversation's model by default, following the model order" |
| claude (catch-all) | No model of its own; follows the model order |
| statusline-setup | Sonnet |
| claude-code-guide | Haiku |

**Model order when a subagent starts** (first match wins):
1. The Agent tool's per-call `model` parameter. It takes an alias only, not a full ID or `inherit`. "A mod's `agent.spawn` hook can override this value."
2. The `model` field in the agent definition: `sonnet`/`opus`/`haiku`/`fable`, a full ID, or `inherit`.
3. `CLAUDE_CODE_SUBAGENT_MODEL`. Set alone, it "doesn't change the model the built-in Explore and Plan subagents run on". With `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1`, definition `model` fields and per-call models are ignored. Forks still use the parent model.
4. The main conversation's model. For a nested subagent, the spawning subagent's model. "By default, a subagent you define runs on the same model as the conversation that starts it."

**Effort**
- Order: per-call `effort` parameter (v2.1.292+), then the frontmatter `effort`, then the session level. `CLAUDE_CODE_EFFORT_LEVEL` beats all of them.
- A subagent on the main model with no `effort` set runs at the session level. "On another model, that level doesn't apply." In that case the subagent falls back to that model's own default, which I infer from model-config.md.

**opusplan:** plan-mode subagents run on Opus. https://code.claude.com/docs/en/sub-agents

**Forks:** inherit the parent's system prompt, tools and history exactly, "so its first request reads the parent's cache". https://code.claude.com/docs/en/prompt-caching

**Workflow agents:**
- They use the same model order. A model the script names counts as the per-call model. With nothing set, they run on the session model.
- Siblings with the same model, effort, agent type, tools, schema and working directory share a prefix cache. The runtime staggers starts by up to 5 s so the others can read it.

  https://code.claude.com/docs/en/workflows

**Cache:** a non-fork subagent "starts its own conversation … Its first request doesn't read the parent's cache", and the parent's cache is unaffected. Subagents get a 5-minute TTL by default. https://code.claude.com/docs/en/prompt-caching

### E2. How others pick models for sub-agents

| System | Rule | Signal |
|---|---|---|
| Anthropic research system | Opus 4 lead with Sonnet 4 workers, which beat single-agent Opus by 90.2%. The lead's prompt holds the scaling rules (1 agent / 3–10 calls for simple, >10 subagents for complex) | Agent role, plus the lead's own read of the task. https://www.anthropic.com/engineering/multi-agent-research-system |
| Anthropic measurements (2026) | Opus 5.5 with Sonnet 5.5 subagents: about a third cheaper, same score, on work larger than one context. Haiku subagents on coding: cost -32%, pass rate about -4 pts, "an alternative to lowering effort, not better". On one dependent chain, the orchestrator's model alone at lower effort came out ahead "in every case measured" | Shape of the work. https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence |
| Claude Code docs | Use Haiku for simple subagent tasks. Use Sonnet for agent-team teammates | Agent type. https://code.claude.com/docs/en/costs |
| Cursor subagents | `model`: `inherit` (default), `fast`, or a model ID, set per agent definition. Forum reports say the field is sometimes ignored | Agent type only. https://cursor.com/docs/subagents |
| Aider | Fixed split: architect model reasons, editor model formats edits | Role. https://aider.chat/2024/09/26/architect.html |
| OpenAI Agents SDK | A model per agent. Its guidance: "a smaller, faster model for triage … a larger, more capable model for complex tasks" | Agent role. https://openai.github.io/openai-agents-python/models/ |
| LangGraph supervisor | A model per worker and a separate supervisor model. Cheap-worker advice comes from third-party tutorials only; no official cost guidance found | Role |

**What the field does:** every system I found routes sub-agents **by agent type or role, set ahead of time**. None reads the task brief at spawn time. Anthropic's lead agent does decide subagent count and scope from the query, but in the prompt, not with a router.

### E3. Recommendation for our router
1. **Type first, brief second.** Keep a table of agent type → (model, effort) as the default. It's free and deterministic.
   - Read-only search (Explore): **Guess:** Sonnet medium instead of the Opus default.
   - claude-code-guide: Haiku.
   - Mechanical/format roles: Haiku or Sonnet low.
2. **Read the brief only for generic types** (general-purpose, `claude`, custom agents with no `model`).
   - Use the existing Haiku classifier on the brief, one sample, low effort. With a 2K-token brief plus a ~2K rubric and ~100 tokens out, that's ≈ $0.0005 per spawn.
   - The real cost is latency, about 1–2 s per spawn (**guess**, not measured).
   - Skip the classifier when the brief is under ~200 tokens and the type default already fits.
3. **Floors.** Never route below the parent's tier for a "review/verify/plan/architecture" brief. **Guess:** cap Haiku to briefs that won't read big trees, because Haiku costs 5× above 100K tokens.
4. **Never re-route forks.** They share the parent's cache, so a model change throws it away.
5. **Route fan-out siblings uniformly,** so they keep sharing one prefix cache.
6. **Escalate one tier** when a spawn fails. Signals:
   - It returns an error, an empty result, or "couldn't find".
   - The parent re-spawns the same brief, matched by hash, within a few turns.

   Don't escalate on length or slowness.
7. **Cache:** a non-fork subagent starts cold whatever model it runs on, so routing it costs nothing in cache. That makes subagents the safest place to save money.
8. **Hook point:** use the documented `agent.spawn` mod hook, which overrides the per-call model, plus the per-call `effort` parameter.

**Lean per-spawn log** (one JSONL row):
- `ts`, `session` (hashed), `agent_type`
- `route_source`: type-default / brief / explicit / inherited
- `model`, `effort`
- `in`, `cache_read`, `cache_write`, `out` tokens, and `usd`
- `duration_s`
- `outcome`: ok / error / empty
- `respawned` (bool, filled in later)
- `brief_hash`. No brief text, for privacy.

That's enough for per-type cost and failure-rate stats. `respawned` is the only cheap quality signal.

---

## What is proved, guessed, and still to test

- **Proved by docs:**
  - Per-model cache, and that effort changes are cache-free on the 5.5 models and Fable 5.1+.
  - What compaction costs and keeps.
  - The `PreModelSwitch` fields.
  - Anthropic's "Opus first, Fable when Opus at high effort falls short".
  - The measured effort/model numbers above.
  - Copilot's boundary-only routing.
- **Guesses:**
  - The Fable-suggestion classes.
  - Break-even of about 10 requests.
  - The trigger list and topic-shift signals.
  - All thresholds (2/3 vs 3/3, 2× money test, 10-turn cool-down).
  - The Haiku check cost (based on list prices, not measured).
- **Needs testing:**
  - Whether the router's switch path runs before the first API request.
  - The real requests per todo in the owner's sessions, which feeds the money test.
  - Whether Haiku can judge remaining-work difficulty from a 4–8K window at all. Compare against Sonnet on the session eval.
  - Haiku's agreement rate across 3 samples, which decides whether "3/3" is too strict.

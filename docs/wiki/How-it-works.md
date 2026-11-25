# How it works

```mermaid
flowchart TD
  P[Your prompt] --> W{Your words name a model or effort?}
  W -- yes --> U[Use them]
  W -- no --> K[Keyword rules, English]
  K --> H[Haiku classifier with a confidence score]
  H --> C[Task class]
  C --> E[Effort for this turn]
  C --> F{First prompt of the chat?}
  F -- yes --> S[3 Haiku samples must agree before the chat moves to a cheaper model]
  F -- no --> Q{Sure quick task?}
  Q -- yes --> HQ[One turn on Haiku, then back]
  Q -- no --> M[Stay on the chat's model]
  M --> T[Model tip or session check: offers a switch with buttons]
  P --> A[Subagent spawned?]
  A --> R[Routed by type or brief: Haiku for lookups, Sonnet high for defined tasks, Opus high for debugging, review, security]
  E --> L[(Ledger: router.db)]
  R --> L
```

## The rules that never bend

1. **Effort first.** Changing effort keeps the prompt cache, so it is the router's main tool.
2. **The model moves down only when it pays.** A new model has to write the whole chat into its own cache. The router moves down by itself only when that cost comes back: at the first prompt, right after a compaction, after an hour idle, or when chats like yours run long enough.
3. **Never up by itself.** Moving up is always a button that shows roughly what the switch costs.
4. **Floors.** Production-code investigation (debugging, code review, security review) stays on Opus high or above. Classes marked `floor` never go below the default.
5. **Fable is never picked automatically.**
6. **Your words win.** "use sonnet", "high effort", "think harder", and "from now on" to keep it for the chat.

## When you're unhappy

One Haiku sample reads your reply after each answer. The first unhappy reply changes nothing, so one misread costs nothing. The second raises effort one step. The fourth raises it again and offers the next model up. A new task starts calm.

## What it measures against

Every figure is against **no router**: the model and effort that would have run without the plugin, at the same tokens. Saved and extra spend are kept apart, so cheap subagents can't hide a dearer turn.

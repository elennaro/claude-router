// The chat's own model; null = the session default. by: 'auto' (the first prompt picked it) or 'you' (the person chose; auto stays off).
// effort: the person's pick for this chat (Settings); null or absent = each turn's effort follows its task.
// routed: the model came from pressing a router tip or offer; from: the chat's model before the first such switch
// (null = the session default). The no-router baseline stays on that model, so a router-suggested move is the router's cost.
export type ChatModel = { model: string | null; by: 'auto' | 'you' | null; effort?: string | null; routed?: boolean; from?: string | null }

// A session-check offer the band shows with buttons: up or down to model, compact first or start fresh.
export type Advice = { action: 'up' | 'down'; model: string; kind: 'compact' | 'fresh'; trigger: string; usd?: number } // usd: the rough rebuild cost of switching now

export type Hint = { cls: string; model: string; why: string; current: string; usd?: number } // usd: the rough rebuild cost of switching now

// Spend against running with no router: baselineUsd is what the same steps would have cost on the asked model and
// effort; extraUsd sums each step's cost above its baseline (stronger picks, the router's own calls), so
// saved = baselineUsd - actualUsd + extraUsd and both directions stay visible.
// Why money was saved or spent extra: the main chat on another model, its effort, subagents, the router's own calls
// (classifier, session check), big-paste reading, keeping an idle chat's cache warm.
export type Why = 'model' | 'effort' | 'agents' | 'router' | 'paste' | 'awake'
export type By = Partial<Record<Why, { saved: number; extra: number }>>
export type Tally = {
  actualUsd: number
  baselineUsd: number
  extraUsd: number
  by?: By // absent on tallies from before 0.8
}

// One session's spend on one local day, as the Board draws it from ~/.claude/router/router.db.
export type Bucket = {
  day: string // YYYY-MM-DD, local
  project: string
  session: string
  label: string // the session's first prompt, shortened
  first: number
  last: number // epoch ms
  turns: number // main-loop turns
  byModel: Record<string, { usd: number; base: number; extra: number; steps: number; cache?: Cache }> // base: with no router; 0 for the classifier
  agents?: Record<string, AgentTally> // per subagent type
  awake?: { nudges: number; usd: number; saved: number } // keep-awake: what the nudges cost and the re-reads they saved
}

// Prompt tokens by where they came from: read = served from the prompt cache. Cache hit = read / (input + read + write).
export type Cache = { input: number; read: number; write: number }

// This chat's spend per model and effort ("opus:high"), for the session's model band; with its prompt tokens.
export type Mix = Record<string, { usd: number; steps: number; cache: Cache }>

// A subagent type's runs on one day: routed = sent to another model than the parent's; respawned = the same brief again.
export type AgentTally = { runs: number; routed: number; respawned: number; usd: number; base: number; extra: number }

export type RouterView = {
  isOn: boolean
  autoEffort: boolean
  routeModels: boolean // subagent models and the model tip; off = effort only
  perMessage: 'unknown' | 'ok' | 'unsupported'
  lastClass: string | null
  lastEffort: string | null
  pickerEffort: string | null // the effort the session started on (the app picker's)
  rerouted: number // main-loop turns sent at another effort than the picker's
  routedAgents: number
}

// One row of the dashboard's recent-turns log: a main-loop turn or one subagent run, its steps summed.
export type TurnLog = {
  id: string
  who: string // 'main' or the subagent type
  cls: string
  model: string
  effort: string
  picker: string
  usd: number
  baseUsd: number // what it would have cost with no router (the asked model and effort)
  steps: number
  auto?: boolean // the router moved this main-chat turn to its class model
  asked?: boolean // the prompt named the model or effort
  cache?: Cache // absent on rows from before 0.7
}

// The installed CLIs against their latest release, checked weekly.
export type Tool = 'claude' | 'codex' | 'antigravity'
export type ToolState = { have?: string; latest?: string; isBehind: boolean }
export type Versions = { at: number; tools: Record<Tool, ToolState> }

// The saving features (docs/PLAN-v3.md slices 1-3), each switchable in Settings.
// autoSwitch: move the chat down by itself when the cache rebuild pays; sizing: size the reader and researcher;
// pastes: read big pastes first; awake: keep an idle chat's cache warm for some hours, then compact it.
// labels: log the router's switches for 👍/👎 training labels (off by default).
export type Features = { autoSwitch: boolean; sizing: boolean; pastes: boolean; awake: boolean; labels: boolean }

// One switch the router made (training data, Settings > Training): no prompt text, only what moved and why.
// kind: pick (the chat's model), quick (one turn on another model), effort (the main chat's effort), agent (a subagent spawn).
// from: the no-router model and effort ('' effort: as the engine sends it). undoUsd: the cache rebuild going back costs.
export type Switch = { id: string; at: number; who: string; kind: 'pick' | 'quick' | 'effort' | 'agent'; fromModel: string; fromEffort: string; toModel: string; toEffort: string; cls: string; why: string; undoUsd: number; label: 'good' | 'bad' | null }
// The offer after the cache lapsed anyway: what resuming re-reads, what compacting first adds, and what it saves per step.
export type Cold = { cache: number; resume: number; extra: number; perStep: number; payback: number }
// While you are away: the nudges sent since your last step, what they cost, what a rebuild would have cost, and whether
// the window ended in a compaction. Shown in the band until your next message.
// back: you returned (the report stays until your next message); saved: the rebuild it avoided, booked then
// stop: why keep-awake stopped early: the work looked finished, or a return was unlikely enough that nudges would not pay
export type Away = { pings: number; usd: number; rebuild: number; compacted: boolean; back?: boolean; saved?: number; stop?: 'done' | 'unlikely' }

// One plan usage window: how much is used (0-100) and when it resets (ISO 8601).
export type PlanWindow = { pct: number; resetsAt?: string }
// week: the 7-day window; five: the 5-hour one; rate: API-price dollars per weekly point, from this machine's spend this week.
export type Plan = { week?: PlanWindow; five?: PlanWindow; rate?: number }

declare module 'claude-code' {
  interface PluginState {
    router: {
      hint: Hint | null
      isHidden: boolean
      tally: Shaped<Tally>
      view: Shaped<RouterView>
      log: Shaped<Array<TurnLog>>
      mix: Mix // this chat's spend per model and effort
      panel: 'none' | 'stats' | 'settings' | 'switches' // what the band has expanded under its row
      isWidgetOpen: boolean
      modes: { global: string | null; project: string | null; isProject: boolean } // "mode" as written in each routing.json
      tools: Versions | null
      updating: Tool | null // the CLI an update button is running for
      chat: ChatModel // the chat's model: picked on its first prompt, or by the person
      advice: Advice | null // the session check's offer, until pressed or dismissed
      features: Features // the saving features' switches (Settings), kept across sessions
      cold: Cold | null // the compact-first offer after the cache lapsed, until a prompt or a press
      away: Away | null // keep-awake's report while you are away, until your next message
      awakeHours: number // how long keep-awake keeps an idle chat warm before compacting it (Settings, kept across sessions)
      compactAt: number | null // this chat's own auto-compact point in tokens (Settings), null: Claude Code's own window
      plan: Plan | null // the plan's usage windows as Claude Code reports them, and the dollars per weekly point learned here
      units: 'usd' | 'plan' // how savings and costs read (Settings, kept across sessions)
      switches: Array<Switch> // this chat's last switches, newest last, with their labels (Settings > Training on)
      chatAwake: boolean // keep-awake for this chat (Settings, This chat; the away report's button): off stops nudges here only
    }
  }
}

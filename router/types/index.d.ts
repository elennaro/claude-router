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
export type Tally = {
  actualUsd: number
  baselineUsd: number
  extraUsd: number
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

declare module 'claude-code' {
  interface PluginState {
    router: {
      hint: Hint | null
      isHidden: boolean
      tally: Shaped<Tally>
      view: Shaped<RouterView>
      log: Shaped<Array<TurnLog>>
      mix: Mix // this chat's spend per model and effort
      panel: 'none' | 'stats' | 'settings' // what the band has expanded under its row
      isWidgetOpen: boolean
      modes: { global: string | null; project: string | null; isProject: boolean } // "mode" as written in each routing.json
      tools: Versions | null
      updating: Tool | null // the CLI an update button is running for
      chat: ChatModel // the chat's model: picked on its first prompt, or by the person
      advice: Advice | null // the session check's offer, until pressed or dismissed
    }
  }
}

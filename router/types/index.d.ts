// The chat's own model; null = the session default. by: 'auto' (the first prompt picked it) or 'you' (the person chose; auto stays off).
// effort: the person's pick for this chat (Settings); null or absent = each turn's effort follows its task.
export type ChatModel = { model: string | null; by: 'auto' | 'you' | null; effort?: string | null }

// A session-check offer the band shows with buttons: up or down to model, compact first or start fresh.
export type Advice = { action: 'up' | 'down'; model: string; kind: 'compact' | 'fresh'; trigger: string }

export type Hint = { cls: string; model: string; why: string; current: string }

export type ModelTally = { input: number; output: number; cacheRead: number; cacheWrite: number; steps: number }

export type Tally = {
  byModel: Record<string, ModelTally>
  actualUsd: number
  baselineUsd: number
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
  byModel: Record<string, { usd: number; base: number; steps: number }> // base: the same tokens on the main model; 0 for the classifier
  agents?: Record<string, AgentTally> // per subagent type
}

// A subagent type's runs on one day: routed = sent to another model than the parent's; respawned = the same brief again.
export type AgentTally = { runs: number; routed: number; respawned: number; usd: number; base: number }

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
  baseUsd: number // the same tokens priced on the main model
  steps: number
  auto?: boolean // the router moved this main-chat turn to its class model
  asked?: boolean // the prompt named the model or effort
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

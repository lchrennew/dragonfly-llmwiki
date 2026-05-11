import type { LLMClient } from '../llm-client.js'
import type { UIHandle } from '../ui.tsx'

export interface CommandContext {
  llm: LLMClient
  ui: UIHandle | null
  chatHistory: any[]
  appendChat: (role: 'user' | 'system' | 'ai', text: string) => void
  updateStatus: (text: string) => void
  getDefaultStatus: () => string
  setChatLabel: (label: string) => void
}

export interface Command {
  name: string
  match: (input: string) => boolean
  execute: (input: string, ctx: CommandContext) => Promise<void> | void
}

import type { Command, CommandContext } from './types.js'

export const clearCommand: Command = {
  name: 'clear',
  match: (input: string) => input === '/clear',
  execute(_input: string, ctx: CommandContext) {
    ctx.ui?.clearChat()
    ctx.appendChat('system', '对话框已清空')
  },
}

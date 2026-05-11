import type { Command, CommandContext } from './types.js'

export const exitCommand: Command = {
  name: 'exit',
  match: (input: string) => input === '/exit' || input === '/quit' || input === '/bye',
  execute(_input: string, _ctx: CommandContext) {
    process.exit(0)
  },
}

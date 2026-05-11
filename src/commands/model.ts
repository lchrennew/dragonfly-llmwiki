import type { Command, CommandContext } from './types.js'

export const modelCommand: Command = {
  name: 'model',
  match: (input: string) => input.startsWith('/model'),
  execute(input: string, ctx: CommandContext) {
    const parts = input.split(/\s+/)
    if (parts[1]) {
      try {
        ctx.llm.switchProvider(parts[1])
        ctx.appendChat('system', `已切换到: ${ctx.llm.getProviderName()}`)
        ctx.setChatLabel(`AI [${ctx.llm.getProviderName()}]`)
        ctx.updateStatus(ctx.getDefaultStatus())
      } catch (e: any) {
        ctx.appendChat('system', e.message)
      }
    } else {
      const list = ctx.llm.getProviderList()
      const info = list.map((p: any) => `  ${p.active ? '→' : ' '} ${p.key} (${p.name})`).join('\n')
      ctx.appendChat('system', `可用模型:\n${info}\n用法: /model <名称>`)
    }
  },
}

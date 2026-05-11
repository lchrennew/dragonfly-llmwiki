import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { autoIngestFile } from '../ingest.js'

export const urlCommand: Command = {
  name: 'url',
  match: (input: string) => input.startsWith('/url'),
  async execute(input: string, ctx: CommandContext) {
    const url = input.replace('/url', '').trim()
    if (!url) {
      ctx.appendChat('system', '用法: /url <网页地址>\n示例: /url https://example.com/article')
      return
    }
    ctx.appendChat('system', `正在抓取: ${url}`)
    try {
      const result = await wiki.fetchUrl(url)
      ctx.appendChat('system', `✓ 已保存: ${result.fileName} → raw/`)
      ctx.appendChat('system', `⏳ 开始自动摄入: ${result.fileName}...`)
      await autoIngestFile(result.fileName, 0, [], {}, buildIngestContext(ctx))
    } catch (e: any) {
      ctx.appendChat('system', `抓取失败: ${e.message}`)
    }
  },
}

function buildIngestContext(ctx: CommandContext) {
  return {
    llm: ctx.llm,
    appendChat: (role: string, text: string) => ctx.appendChat(role as any, text),
    updateLastChat: (role: string, text: string) => ctx.ui?.updateLastChat(role as any, text),
    updateStatus: (text: string) => ctx.updateStatus(text),
    getDefaultStatus: () => ctx.getDefaultStatus(),
    screen: { render: () => {} },
    chatMessages: [],
    chatBox: { setContent: () => {}, setScrollPerc: () => {}, setLabel: (l: string) => ctx.setChatLabel(l) },
    chatHistory: ctx.chatHistory,
  }
}

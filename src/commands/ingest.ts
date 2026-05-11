import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { getIngestProgress } from '../config.js'
import { autoIngestFile } from '../ingest.js'

export const ingestCommand: Command = {
  name: 'ingest',
  match: (input: string) => input.startsWith('/ingest') && !input.startsWith('/ingest!'),
  async execute(input: string, ctx: CommandContext) {
    const args = input.replace('/ingest', '').trim()
    const brief = args.includes('--brief')
    const targetName = args.replace('--brief', '').trim()
    const { changed, unchanged } = wiki.listChangedRawFiles()

    if (targetName) {
      const target = changed.find((f: any) => f.name === targetName) || unchanged.find((f: any) => f.name === targetName)
      if (!target) {
        ctx.appendChat('system', `raw/ 目录中找不到文件: ${targetName}`)
        return
      }
      if (unchanged.find((f: any) => f.name === targetName)) {
        ctx.appendChat('system', `文件未变化，跳过: ${targetName}（使用 /ingest! ${targetName} 强制摄入）`)
        return
      }
      ctx.updateStatus(' ⏳ 摄入中...')
      ctx.appendChat('system', `⏳ 开始摄入${brief ? '(精简)' : ''}: ${targetName}...`)
      await autoIngestFile(targetName, 0, [], { brief }, buildIngestContext(ctx))
      wiki.markFilesAsProcessed([`raw/${targetName}`])
      return
    }

    if (changed.length === 0) {
      ctx.appendChat('system', `raw/ 目录中没有需要摄入的文件（共 ${unchanged.length} 个文件已是最新）`)
      return
    }

    ctx.appendChat('system', `发现 ${changed.length} 个待摄入文件，${unchanged.length} 个已是最新`)
    for (const f of changed) {
      ctx.updateStatus(` ⏳ 摄入: ${f.name}...`)
      ctx.appendChat('system', `⏳ 开始摄入: ${f.name}（${f.reason === 'new_file' ? '新文件' : '内容已变化'}）...`)
      await autoIngestFile(f.name, 0, [], {}, buildIngestContext(ctx))
      wiki.markFilesAsProcessed([f.path])
      const progress = getIngestProgress(f.name)
      if (progress && progress.paused) {
        ctx.appendChat('system', `${f.name} 摄入暂停，继续处理下一个文件...`)
      }
    }
    ctx.updateStatus(ctx.getDefaultStatus())
  },
}

export const forceIngestCommand: Command = {
  name: 'ingest!',
  match: (input: string) => input.startsWith('/ingest!'),
  async execute(input: string, ctx: CommandContext) {
    const args = input.replace('/ingest!', '').trim()
    const brief = args.includes('--brief')
    const targetName = args.replace('--brief', '').trim()
    if (!targetName) {
      ctx.appendChat('system', '用法: /ingest! <文件名> [--brief] - 强制重新摄入指定文件')
      return
    }
    const rawFiles = wiki.listRawFiles()
    const target = rawFiles.find((f: any) => f.name === targetName)
    if (!target) {
      ctx.appendChat('system', `raw/ 目录中找不到文件: ${targetName}`)
      return
    }
    ctx.updateStatus(' ⏳ 强制摄入中...')
    ctx.appendChat('system', `⏳ 强制摄入${brief ? '(精简)' : ''}: ${targetName}...`)
    await autoIngestFile(targetName, 0, [], { brief }, buildIngestContext(ctx))
    wiki.markFilesAsProcessed([target.path])
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

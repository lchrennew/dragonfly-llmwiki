import type { Command, CommandContext } from './types.js'
import { getIngestProgress, saveIngestProgress } from '../config.js'
import { autoIngestFile } from '../ingest.js'

export const continueCommand: Command = {
  name: 'continue',
  match: (input: string) => input.startsWith('/continue'),
  async execute(input: string, ctx: CommandContext) {
    const targetFile = input.replace('/continue', '').trim()
    const allProgress = getIngestProgress()
    if (!allProgress) {
      ctx.appendChat('system', '当前没有暂停的摄入任务')
      return
    }

    let fileName = targetFile
    if (!fileName) {
      const pausedFiles = Object.entries(allProgress).filter(([, p]: any) => p.paused)
      if (pausedFiles.length === 0) {
        ctx.appendChat('system', '当前没有暂停的摄入任务')
        return
      }
      if (pausedFiles.length === 1) {
        fileName = pausedFiles[0][0]
      } else {
        ctx.appendChat('system', `有 ${pausedFiles.length} 个文件暂停中：`)
        for (const [f, p] of pausedFiles as any) {
          ctx.appendChat('system', `  - ${f} (第${p.pausedAt + 1}段失败)`)
        }
        ctx.appendChat('system', '请指定文件: /continue <文件名>')
        return
      }
    }

    const progress = allProgress[fileName]
    if (!progress || !progress.paused) {
      ctx.appendChat('system', `${fileName} 没有暂停的摄入任务`)
      return
    }
    ctx.appendChat('system', `跳过 ${fileName} 第 ${progress.pausedAt + 1} 段，继续后续段落...`)
    ctx.updateStatus(' ⏳ 继续摄入中...')
    const nextSegment = progress.pausedAt + 1
    const failedSegments = progress.failedSegments || []
    saveIngestProgress(fileName, nextSegment, progress.totalSegments, { failedSegments })
    const ingestCtx = buildIngestContext(ctx)
    await autoIngestFile(fileName, nextSegment, failedSegments, {}, ingestCtx)
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

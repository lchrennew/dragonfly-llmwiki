import type { Command, CommandContext } from './types.js'
import { getIngestProgress, clearIngestProgress, saveIngestProgress } from '../config.js'
import { autoIngestFile } from '../ingest.js'

export const retryCommand: Command = {
  name: 'retry',
  match: (input: string) => input.startsWith('/retry'),
  async execute(input: string, ctx: CommandContext) {
    const targetFile = input.replace('/retry', '').trim()
    const allProgress = getIngestProgress()
    if (!allProgress || Object.keys(allProgress).length === 0) {
      ctx.appendChat('system', '没有需要恢复的摄入任务')
      return
    }

    if (!targetFile) {
      const files = Object.keys(allProgress)
      if (files.length === 1) {
        await retryFile(files[0], allProgress[files[0]], ctx)
      } else {
        ctx.appendChat('system', `有 ${files.length} 个文件有未完成的摄入任务：`)
        for (const f of files) {
          const p = allProgress[f]
          const status = p.paused ? '暂停' : `${p.completedSegments}/${p.totalSegments}`
          ctx.appendChat('system', `  - ${f} (${status})`)
        }
        ctx.appendChat('system', '请指定文件: /retry <文件名>')
      }
      return
    }

    const progress = allProgress[targetFile]
    if (!progress) {
      ctx.appendChat('system', `没有找到 ${targetFile} 的摄入进度`)
      return
    }
    await retryFile(targetFile, progress, ctx)
  },
}

async function retryFile(fileName: string, progress: any, ctx: CommandContext) {
  ctx.updateStatus(' ⏳ 重试摄入中...')
  const ingestCtx = buildIngestContext(ctx)

  if (progress.failedSegments?.length > 0 && progress.completedSegments >= progress.totalSegments) {
    ctx.appendChat('system', `重试 ${fileName} 的 ${progress.failedSegments.length} 个失败段落`)
    const failedList = [...progress.failedSegments]
    clearIngestProgress(fileName)
    for (const segIdx of failedList) {
      await autoIngestFile(fileName, segIdx, [], {}, ingestCtx)
      const p = getIngestProgress(fileName)
      if (p && p.paused) return
    }
    clearIngestProgress(fileName)
    ctx.appendChat('system', '✓ 所有失败段落重试完成')
  } else if (progress.paused && progress.pausedAt !== null) {
    ctx.appendChat('system', `重试 ${fileName} 第 ${progress.pausedAt + 1}/${progress.totalSegments} 段...`)
    const failedSegments = (progress.failedSegments || []).filter((s: number) => s !== progress.pausedAt)
    saveIngestProgress(fileName, progress.pausedAt, progress.totalSegments, { failedSegments })
    await autoIngestFile(fileName, progress.pausedAt, failedSegments, {}, ingestCtx)
  } else {
    ctx.appendChat('system', `恢复摄入: ${fileName}（从第 ${progress.completedSegments + 1}/${progress.totalSegments} 段继续）`)
    await autoIngestFile(fileName, progress.completedSegments, progress.failedSegments || [], {}, ingestCtx)
  }
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

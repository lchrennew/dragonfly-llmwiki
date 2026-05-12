#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { KeymapProvider } from "@opentui/keymap/react"
import { LLMClient } from './llm-client.js'
import { getIngestProgress } from './config.js'
import { handleQuery } from './query.js'
import { App, type UIHandle } from './ui.tsx'
import { commands, type CommandContext } from './commands/index.js'
import { setDebugUI, debug } from './debug.js'

const llm = new LLMClient()
const chatHistory: any[] = []
let ui: UIHandle | null = null

function getCommandContext(): CommandContext {
  return {
    llm,
    ui,
    chatHistory,
    appendChat: (role, text) => ui?.appendChat(role, text),
    updateStatus: (text) => ui?.updateStatus(text),
    getDefaultStatus: () => ui?.getDefaultStatus() || '',
    setChatLabel: (label) => ui?.setChatLabel(label),
    showFilePicker: (startDir, onSelect) => ui?.showFilePicker(startDir, onSelect),
  }
}

function getQueryContext() {
  return {
    llm,
    appendChat: (role: string, text: string) => ui?.appendChat(role as any, text),
    updateLastChat: (role: string, text: string) => ui?.updateLastChat(role as any, text),
    updateStatus: (text: string) => ui?.updateStatus(text),
    getDefaultStatus: () => ui?.getDefaultStatus() || '',
    screen: { render: () => { } },
    chatMessages: [],
    chatBox: { setContent: () => { }, setScrollPerc: () => { }, setLabel: (l: string) => ui?.setChatLabel(l) },
    chatHistory,
  }
}

async function handleUserInput(text: string) {
  if (!text.trim()) return
  ui?.appendChat('user', text)

  const ctx = getCommandContext()
  const matched = commands.find(cmd => cmd.match(text))
  if (matched) {
    await matched.execute(text, ctx)
    return
  }

  await handleQuery(text, getQueryContext())
}

function cleanupTerminal() {
  try {
    process.stdout.write('\x1b[?1000l')
    process.stdout.write('\x1b[?1002l')
    process.stdout.write('\x1b[?1003l')
    process.stdout.write('\x1b[?1006l')
    process.stdout.write('\x1b[?25h')
    process.stdout.write('\x1b[2J')
    process.stdout.write('\x1b[H')
    process.stdout.write('\x1b[0m')
  } catch { }
}

async function main() {
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  const keymap = createDefaultOpenTuiKeymap(renderer)
  const uiRef = { current: null as UIHandle | null }

  process.on('SIGINT', () => { cleanupTerminal(); renderer.destroy(); process.exit(0) })
  process.on('SIGTERM', () => { cleanupTerminal(); renderer.destroy(); process.exit(0) })
  process.on('exit', () => { cleanupTerminal() })

  const callbacks = { onSubmit: (text: string) => { handleUserInput(text) } }

  function Root() {
    return (
      <KeymapProvider keymap={keymap}>
        <App providerName={llm.getProviderName()} callbacks={callbacks} uiRef={uiRef} />
      </KeymapProvider>
    )
  }

  createRoot(renderer).render(<Root />)

  await new Promise(resolve => setTimeout(resolve, 500))
  ui = uiRef.current

  if (!ui) {
    console.error('UI not initialized!')
    process.exit(1)
  }

  setDebugUI(ui)
  debug.print('系统调试已就位')

  ui.appendChat('system', `欢迎使用 LLM Wiki! 当前模型: ${llm.getProviderName()}`)
  ui.appendChat('system', '命令: /import 导入文件 | /url 抓取网页 | /model 切换模型 | /help 帮助')

  const pendingProgress = getIngestProgress()
  if (pendingProgress && Object.keys(pendingProgress).length > 0) {
    const files = Object.entries(pendingProgress)
    ui.appendChat('system', `⚠ 有 ${files.length} 个未完成的摄入任务：`)
    for (const [f, p] of files as any) {
      if (p.paused) {
        ui.appendChat('system', `  - ${f}（第${p.pausedAt + 1}/${p.totalSegments}段暂停）`)
      } else if (p.failedSegments?.length > 0 && p.completedSegments >= p.totalSegments) {
        ui.appendChat('system', `  - ${f}（${p.failedSegments.length}段失败待重试）`)
      } else {
        ui.appendChat('system', `  - ${f}（${p.completedSegments}/${p.totalSegments}段已完成）`)
      }
    }
    ui.appendChat('system', '  /retry [文件名] 恢复 | /continue [文件名] 跳过')
  }
}

main()

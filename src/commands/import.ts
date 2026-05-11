import fs from 'fs'
import path from 'path'
import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { setLastImportDir } from '../config.js'
import { autoIngestFile } from '../ingest.js'

export const importCommand: Command = {
  name: 'import',
  match: (input: string) => input.startsWith('/import'),
  async execute(input: string, ctx: CommandContext) {
    const filePath = input.replace('/import', '').trim()
    if (!filePath) {
      ctx.appendChat('system', '用法: /import <文件路径>')
      return
    }
    const absPath = path.resolve(filePath)
    if (!fs.existsSync(absPath)) {
      ctx.appendChat('system', `文件不存在: ${absPath}`)
      return
    }
    setLastImportDir(path.dirname(absPath))
    await importFile(absPath, ctx)
  },
}

async function importFile(absPath: string, ctx: CommandContext) {
  const fileName = path.basename(absPath)
  const ext = path.extname(fileName).toLowerCase()
  const convertibleExts = ['.pdf', '.docx', '.pptx', '.xlsx', '.html', '.htm', '.csv', '.json', '.xml']
  const dest = path.join(wiki.RAW_DIR, fileName)
  let importedFileName = fileName

  try {
    if (fs.existsSync(dest)) fs.unlinkSync(dest)
    fs.copyFileSync(absPath, dest)
    if (convertibleExts.includes(ext)) {
      ctx.appendChat('system', `⏳ 正在转换: ${fileName} → Markdown...`)
      const relPath = path.relative(wiki.ROOT, dest)
      const mdContent = await wiki.readFileAsMarkdown(relPath)
      if (mdContent && !mdContent.startsWith('[转换')) {
        const mdName = fileName.replace(/\.[^.]+$/, '.md')
        const mdDest = path.join(wiki.RAW_DIR, mdName)
        fs.writeFileSync(mdDest, mdContent, 'utf-8')
        fs.unlinkSync(dest)
        importedFileName = mdName
        ctx.appendChat('system', `✓ 已导入并转换: ${fileName} → raw/${mdName}`)
      } else {
        ctx.appendChat('system', `✓ 已导入: ${fileName} → raw/（转换失败，保留原文件）`)
      }
    } else {
      ctx.appendChat('system', `✓ 已导入: ${fileName} → raw/`)
    }

    const importedRelPath = path.relative(wiki.ROOT, path.join(wiki.RAW_DIR, importedFileName))
    const { changed } = wiki.listChangedRawFiles()
    const isChanged = changed.some((f: any) => f.path === importedRelPath)

    if (!isChanged) {
      ctx.appendChat('system', `⏭ 文件内容未变化，跳过摄入: ${importedFileName}`)
      return
    }

    ctx.appendChat('system', `⏳ 开始自动摄入: ${importedFileName}...`)
    await autoIngestFile(importedFileName, 0, [], {}, buildIngestContext(ctx))
    wiki.markFilesAsProcessed([importedRelPath])
  } catch (e: any) {
    if (e.code === 'EACCES') {
      ctx.appendChat('system', `权限不足: ${fileName}\n请在终端执行: chmod +r "${absPath}"`)
    } else {
      ctx.appendChat('system', `导入失败: ${e.message}`)
    }
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

import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { parseFileOutputs } from '../ingest.js'

export const reindexCommand: Command = {
  name: 'reindex',
  match: (input: string) => input === '/reindex',
  async execute(_input: string, ctx: CommandContext) {
    const wikiFiles = wiki.listWikiFiles()
    const contentFiles = wikiFiles.filter((f: any) => !['index.md', 'log.md', 'overview.md'].includes(f.name) && f.category !== 'domains')
    if (contentFiles.length === 0) {
      ctx.appendChat('system', 'Wiki 中没有内容页面，无需重建索引')
      return
    }
    ctx.appendChat('system', `⏳ 正在重建索引（${contentFiles.length} 个页面）...`)
    ctx.updateStatus(' ⏳ 重建索引中...')

    const domainGroups: Record<string, any[]> = {}
    for (const f of contentFiles) {
      const content = wiki.readFile(f.path)
      if (!content) continue
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      const fm = fmMatch ? fmMatch[1] : ''
      const domainsMatch = fm.match(/domains:\s*\[([^\]]*)\]/)
      const domains = domainsMatch
        ? domainsMatch[1].split(',').map((d: string) => d.trim().replace(/['"]/g, '')).filter((d: string) => d)
        : ['uncategorized']
      for (const domain of domains) {
        if (!domainGroups[domain]) domainGroups[domain] = []
        domainGroups[domain].push({ path: f.path, fm: fm.replace(/\n/g, ' | ') })
      }
    }

    const domainNames = Object.keys(domainGroups)
    let totalFiles = 0

    for (let i = 0; i < domainNames.length; i++) {
      const domain = domainNames[i]
      const pages = domainGroups[domain]
      ctx.appendChat('system', `  📂 处理领域 ${i + 1}/${domainNames.length}: ${domain}（${pages.length} 个页面）...`)

      const pagesInfo = pages.map((p: any) => `- ${p.path}: ${p.fm}`).join('\n')
      const messages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `请为领域"${domain}"创建或更新索引页 wiki/domains/${domain}.md。\n\n该领域包含以下页面：\n${pagesInfo}\n\n请输出完整的领域索引页，包含：概述、核心概念列表、重要实体列表、关键来源列表。\n如果该领域应该是某个更大领域的子领域，请在 frontmatter 中设置 parent 字段。\n\n只输出这一个文件，用 <<<FILE:路径>>> 格式。` },
      ]

      try {
        let response = ''
        ctx.ui?.appendChat('ai', '')
        await ctx.llm.chatStream(messages, (chunk: string) => {
          response += chunk
          const displayText = response.replace(/<<<FILE:(.*?)>>>[\s\S]*?<<<END>>>/g, (match: string, filePath: string) => {
            return `更新文件: ${filePath.trim()}`;
          })
          ctx.ui?.updateLastChat('ai', displayText)
        })
        const files = parseFileOutputs(response)
        if (files.length > 0) {
          for (const f of files) wiki.writeFile(f.path, f.content)
          totalFiles += files.length
        }
      } catch (err: any) {
        ctx.appendChat('system', `  ⚠ 领域 ${domain} 处理失败: ${err.message}`)
      }
    }

    ctx.appendChat('system', `  📋 生成 index.md 和 overview.md...`)

    const domainFilesList = wiki.listWikiFiles().filter((f: any) => f.category === 'domains' && f.name !== '_meta.json')
    const domainList = domainFilesList.map((f: any) => {
      const content = wiki.readFile(f.path)
      const fmMatch = content ? content.match(/^---\n([\s\S]*?)\n---/) : null
      const fm = fmMatch ? fmMatch[1] : ''
      return `- ${f.path}: ${fm.replace(/\n/g, ' | ')}`
    }).join('\n')

    const finalMessages = [
      { role: 'system', content: wiki.getSystemPrompt() },
      { role: 'user', content: `请根据以下领域索引页信息，生成 wiki/index.md 和 wiki/overview.md。\n\n当前所有领域索引页：\n${domainList}\n\n统计：共 ${contentFiles.length} 个内容页面，${domainNames.length} 个领域。\n\n要求：\n1. wiki/index.md 只列顶层领域（没有 parent 的领域）目录和统计数字\n2. wiki/overview.md 概述整个知识库的内容全貌\n\n两个文件都必须输出，用 <<<FILE:路径>>> 格式。` },
    ]

    try {
      let response = ''
      ctx.ui?.appendChat('ai', '')
      await ctx.llm.chatStream(finalMessages, (chunk: string) => {
        response += chunk
        const displayText = response.replace(/<<<FILE:(.*?)>>>[\s\S]*?<<<END>>>/g, (match: string, filePath: string) => {
          return `更新文件: ${filePath.trim()}`;
        })
        ctx.ui?.updateLastChat('ai', displayText)
      })
      const files = parseFileOutputs(response)
      if (files.length > 0) {
        for (const f of files) wiki.writeFile(f.path, f.content)
        totalFiles += files.length
      }
    } catch (err: any) {
      ctx.appendChat('system', `  ⚠ index/overview 生成失败: ${err.message}`)
    }

    ctx.appendChat('system', `✓ 索引重建完成，共更新 ${totalFiles} 个文件`)
    ctx.updateStatus(ctx.getDefaultStatus())
  },
}

import fs from 'fs'
import path from 'path'
import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { clearIngestProgress } from '../config.js'

export const pruneCommand: Command = {
  name: 'prune',
  match: (input: string) => input === '/prune' || input === '/prune --all',
  execute(input: string, ctx: CommandContext) {
    if (input === '/prune --all') {
      pruneAll(ctx)
    } else {
      pruneUnreachable(ctx)
    }
  },
}

function pruneAll(ctx: CommandContext) {
  const wikiFiles = wiki.listWikiFiles()
  let deleted = 0
  for (const f of wikiFiles) {
    const fullPath = path.join(wiki.ROOT, f.path)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      deleted++
    }
  }
  const hashPath = path.join(wiki.ROOT, '.wiki-hashes.json')
  if (fs.existsSync(hashPath)) fs.writeFileSync(hashPath, '{}', 'utf-8')
  clearIngestProgress()
  ctx.appendChat('system', `✓ 已清空 Wiki（删除了 ${deleted} 个文件），哈希和进度已重置`)
}

function pruneUnreachable(ctx: CommandContext) {
  const indexContent = wiki.readFile('wiki/index.md')
  if (!indexContent) {
    ctx.appendChat('system', 'wiki/index.md 不存在，请先执行 /reindex')
    return
  }
  const domainLinkRegex = /\[\[domains\/([^\]]+)\]\]/g
  let match
  const topDomains = new Set<string>()
  while ((match = domainLinkRegex.exec(indexContent)) !== null) {
    topDomains.add(match[1].replace('.md', ''))
  }
  if (topDomains.size === 0) {
    ctx.appendChat('system', 'index.md 中没有找到领域链接')
    return
  }
  const reachable = new Set<string>()
  const queue = [...topDomains]
  while (queue.length > 0) {
    const domain = queue.shift()!
    if (reachable.has(domain)) continue
    reachable.add(domain)
    const domainContent = wiki.readFile(`wiki/domains/${domain}.md`)
    if (!domainContent) continue
    const fmMatch = domainContent.match(/^---\n([\s\S]*?)\n---/)
    if (!fmMatch) continue
    const childrenMatch = fmMatch[1].match(/children:\s*\[([^\]]*)\]/)
    if (childrenMatch) {
      const children = childrenMatch[1].split(',').map((c: string) => c.trim().replace(/['"]/g, '')).filter((c: string) => c)
      for (const child of children) {
        if (!reachable.has(child)) queue.push(child)
      }
    }
  }
  const wikiFiles = wiki.listWikiFiles()
  const domainFiles = wikiFiles.filter((f: any) => f.category === 'domains' && f.name.endsWith('.md'))
  const unreachable = domainFiles.filter((f: any) => {
    const name = f.name.replace('.md', '')
    return !reachable.has(name)
  })
  if (unreachable.length === 0) {
    ctx.appendChat('system', `✓ 所有领域索引页均可达（共 ${reachable.size} 个领域）`)
    return
  }
  ctx.appendChat('system', `发现 ${unreachable.length} 个不可达的领域索引页：`)
  for (const f of unreachable) {
    ctx.appendChat('system', `  - ${f.path}`)
  }
  for (const f of unreachable) {
    const fullPath = path.join(wiki.ROOT, f.path)
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath)
  }
  ctx.appendChat('system', `✓ 已删除 ${unreachable.length} 个不可达的领域索引页`)
}

import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'

export const lintCommand: Command = {
  name: 'lint',
  match: (input: string) => input === '/lint',
  execute(_input: string, ctx: CommandContext) {
    ctx.appendChat('system', '正在执行健康检查...')
    const wikiFiles = wiki.listWikiFiles()
    const rawFiles = wiki.listRawFiles()
    ctx.appendChat('system', `Wiki页面: ${wikiFiles.length} | 原始资料: ${rawFiles.length}`)
  },
}

import type { Command, CommandContext } from './types.js'
import * as wiki from '../wiki-ops.js'
import { parseFileOutputs } from '../ingest.js'

export const learnCommand: Command = {
  name: 'learn',
  match: (input: string) => input.startsWith('/learn'),
  async execute(input: string, ctx: CommandContext) {
    const content = input.replace('/learn', '').trim()
    if (!content) {
      ctx.appendChat('system', '用法: /learn <知识内容>')
      return
    }
    await doLearn(content, ctx)
  },
}

async function doLearn(content: string, ctx: CommandContext) {
  ctx.appendChat('system', '💡 正在录入新知识...')
  ctx.updateStatus(' ⏳ 录入知识中...')

  const messages = [
    { role: 'system', content: wiki.getSystemPrompt() },
    { role: 'user', content: `用户通过对话方式提供了以下知识，请将其保存到 Wiki 中：\n\n${content}\n\n请：\n1. 提取其中的概念，为每个概念创建 wiki/concepts/ 页面\n2. 提取其中的实体，为每个实体创建 wiki/entities/ 页面\n3. 识别或创建领域（在 frontmatter 的 domains 字段中标注）\n4. 在 sources 字段标注来源为 "用户录入"\n5. 如果内容涉及已有页面，输出更新后的完整页面\n\n每个文件用 <<<FILE:路径>>> 格式输出。不需要输出 index.md 和领域索引页。\n如果内容过于简短或不适合保存，请说明原因。` },
  ]

  try {
    let response = ''
    ctx.ui?.appendChat('ai', '')
    await ctx.llm.chatStream(messages, (chunk: string) => {
      response += chunk
      const displayText = response.replace(/<<<FILE:.*?>>>[\s\S]*?<<<END>>>/g, '[文件操作]')
      ctx.ui?.updateLastChat('ai', displayText)
    })

    const files = parseFileOutputs(response)
    if (files.length > 0) {
      for (const f of files) wiki.writeFile(f.path, f.content)
      ctx.appendChat('system', `✓ 已保存 ${files.length} 个页面到知识库`)

      const indexMessages = [
        { role: 'system', content: wiki.getSystemPrompt() },
        { role: 'user', content: `本轮录入了以下新页面：\n${files.map((f: any) => `- ${f.path}`).join('\n')}\n\n请更新相关的领域索引页（wiki/domains/）和 wiki/index.md（只列顶层领域目录和统计数字）。\n如果涉及的领域索引页不存在，请创建它。\n只输出需要更新的文件，用 <<<FILE:路径>>> 格式。` },
      ]
      let indexResponse = ''
      await ctx.llm.chatStream(indexMessages, (chunk: string) => { indexResponse += chunk })
      const indexFiles = parseFileOutputs(indexResponse)
      if (indexFiles.length > 0) {
        for (const f of indexFiles) wiki.writeFile(f.path, f.content)
      }
    }
  } catch (err: any) {
    ctx.appendChat('system', `录入失败: ${err.message}`)
  }

  ctx.updateStatus(ctx.getDefaultStatus())
}

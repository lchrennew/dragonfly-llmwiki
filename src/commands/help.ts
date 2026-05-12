import type { Command, CommandContext } from './types.js'

export const helpCommand: Command = {
  name: 'help',
  match: (input: string) => input === '/help',
  execute(_input: string, ctx: CommandContext) {
    ctx.appendChat('system', [
      '可用命令:',
      '  /import <路径>   - 导入文件',
      '  /ingest [文件名] [--brief] - 手工摄入（--brief 精简模式）',
      '  /ingest! <文件名> [--brief] - 强制重新摄入',
      '  /url <网址>     - 抓取网页内容并导入',
      '  /learn <内容>   - 对话式录入新知识',
      '  /model [名称]   - 查看/切换模型',
      '  /retry          - 重试失败的摄入段落',
      '  /continue       - 跳过失败段落继续摄入',
      '  /reindex        - 重建索引层级结构',
      '  /prune          - 清理不可达的领域索引页',
      '  /lint           - 健康检查',
      '  /clear          - 清空对话框内容',
      '  /exit /quit /bye - 退出程序',
      '  /help           - 显示帮助',
      '',
      '使用方式:',
      '  直接输入问题与 AI 对话',
      '  使用 /import 导入文档到 raw/ 目录（自动摄入）',
      '  使用 /ingest 手工触发摄入 raw/ 中的文件',
      '  使用 /learn 直接告诉系统新知识',
    ].join('\n'))
  },
}

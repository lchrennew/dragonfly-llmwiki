# LLM Wiki

由大模型驱动的个人知识库。你负责策划来源、提出问题，AI 负责所有的总结、交叉引用、归档和维护。

## 特性

- **多格式导入** — 支持 PDF、Word、PPT、Excel、HTML、Markdown 等 10+ 种格式
- **自动摄入** — AI 阅读原始资料，生成结构化的 Wiki 页面
- **智能检索** — 基于知识库内容回答问题
- **多模型支持** — DeepSeek / 通义千问 / OpenAI / Ollama 随时切换
- **三种使用方式** — 命令行 TUI、Obsidian 浏览、MCP 服务集成

## 快速开始

```bash
# 安装 Bun（如果尚未安装）
curl -fsSL https://bun.sh/install | bash

# 安装依赖
bun install

# 配置 AI 模型（复制 .env.example 为 .env，填入 API Key）
cp .env.example .env

# 启动 TUI
bun run start

# 或启动 MCP 服务
bun run mcp
```

## 使用方式

### 命令行 TUI

```bash
bun run start
```

提供内容预览、AI 对话的集成界面。支持 `/import`、`/url`、`/model` 等命令。

### Obsidian

用 [Obsidian](https://obsidian.md) 打开 `wiki/` 文件夹，享受知识图谱和双链跳转。

### MCP 服务

```bash
bun run mcp
```

集成到 Claude Desktop、Cursor、VS Code 等 AI 工具中，通过自然语言操作知识库。

## 技术栈

- **运行时** — [Bun](https://bun.sh)
- **UI 框架** — [@opentui/react](https://github.com/nicepkg/opentui)（终端 React UI）
- **文档转换** — [markitdown-ts](https://github.com/dead8309/markitdown-ts)
- **LLM 客户端** — OpenAI SDK（兼容多家模型 API）

## 项目结构

```
dragonfly-llmwiki/
├── raw/          # 原始资料（用户导入）
├── wiki/         # AI 生成的 Wiki 页面
├── src/          # 源代码
│   ├── app.tsx        # TUI 应用入口
│   ├── ui.tsx         # UI 组件
│   ├── components/    # 自定义组件
│   ├── commands/      # 命令处理
│   ├── mcp-server.js  # MCP 服务
│   ├── llm-client.js  # 多模型客户端
│   └── wiki-ops.js    # Wiki 操作库
├── AGENTS.md     # Wiki Schema 配置
└── GUIDE.md      # 详细安装使用指南
```

## 文档

详细的安装和使用说明请参考 [GUIDE.md](GUIDE.md)。

## 许可证

MIT

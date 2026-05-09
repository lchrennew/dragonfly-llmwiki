# LLM Wiki 安装使用指南

## 这是什么？

LLM Wiki 是你的**个人智能知识库**。你把文章、笔记、资料丢进去，AI 会自动帮你：
- 整理成结构化的知识页面
- 建立不同知识点之间的关联
- 随时回答你关于这些资料的问题

你不需要自己写任何东西，AI 帮你做所有整理工作。

---

## 安装步骤

### 1. 安装 Node.js

如果你的电脑还没有 Node.js：
1. 打开 https://nodejs.org
2. 下载 LTS（长期支持）版本
3. 双击安装包，一路点"下一步"即可

### 2. 配置 AI 模型

1. 在项目文件夹中找到 `.env.example` 文件
2. 复制一份，重命名为 `.env`
3. 打开 `.env`，填入你的 API Key

支持以下模型（选一个就行）：

| 模型 | 获取 API Key |
|------|-------------|
| DeepSeek | https://platform.deepseek.com |
| 通义千问 | https://dashscope.console.aliyun.com |
| OpenAI | https://platform.openai.com |
| Ollama（本地） | 安装 Ollama 后无需 Key |

在 `.env` 文件中设置 `LLM_PROVIDER=` 为你选择的模型名称（deepseek / qwen / openai / ollama）。

### 3. 安装依赖

打开终端（Mac 上叫"终端"，Windows 上叫"命令提示符"），输入：

```bash
cd /Users/lichun/IdeaProjects/dragonfly-llmwiki
npm install
```

---

## 使用方式

LLM Wiki 提供三种使用方式，可以根据你的习惯选择：

### 方式一：命令行 TUI（推荐）

在终端中输入：

```bash
npm start
```

会打开一个命令行图形界面：

```
┌─ 📂 文件 ────────┬─ 📄 内容 ──────────────────────┐
│ 📁 wiki/          │                                 │
│   📄 index.md     │  （选中文件后这里显示内容）      │
│   📄 overview.md  │                                 │
│ 📁 raw/           │                                 │
├───────────────────┴─────────────────────────────────┤
│ 🤖 AI [DeepSeek]                                    │
│ 系统: 欢迎使用 LLM Wiki!                            │
├─────────────────────────────────────────────────────┤
│ 输入框：在这里输入你的问题或指令                      │
└─────────────────────────────────────────────────────┘
```

#### 操作方式

| 按键 | 功能 |
|------|------|
| Tab | 在文件列表、内容区、输入框之间切换 |
| Enter | 发送消息给 AI |
| F2 | 弹出模型选择菜单，切换不同 AI |
| F3 | 打开文件选择器，导入文件 |
| ↑↓ | 在文件列表中上下选择 |
| q | 退出程序 |

#### 常用命令

在输入框中输入：

- **直接提问** — AI 会基于知识库回答
- **"请摄入 raw/ 中的新资料"** — AI 读取并整理新资料
- **/import [路径]** — 导入文件（支持 PDF、Word、PPT、Excel 等）
- **/url <网址>** — 抓取网页内容并导入
- **/model** — 查看可用模型列表
- **/model deepseek** — 切换到 DeepSeek
- **/lint** — 检查知识库健康状态
- **/exit** 或 **/quit** — 退出程序
- **/help** — 显示帮助

---

### 方式二：Obsidian 浏览 + TUI 管理

[Obsidian](https://obsidian.md) 是一款免费的本地笔记软件，特别适合浏览 Wiki 内容。

#### 安装 Obsidian

1. 打开 https://obsidian.md 下载安装
2. 打开 Obsidian，选择"打开文件夹作为仓库"
3. 选择本项目的 `wiki/` 文件夹

#### 使用方式

- **浏览知识库**：在 Obsidian 中查看所有 Wiki 页面，支持 `[[双括号链接]]` 跳转、图谱视图、全文搜索
- **管理知识库**：在终端运行 `npm start` 使用 TUI 进行资料导入和摄入操作
- **两者配合**：TUI 负责导入资料和 AI 交互，Obsidian 负责舒适地阅读和浏览

#### Obsidian 的优势

- 可视化的知识图谱，看到知识点之间的关联
- 支持双链跳转，点击 `[[链接]]` 直接跳转到相关页面
- 全文搜索，快速定位内容
- 支持自定义主题和插件

---

### 方式三：MCP 服务（集成到 AI 工具中）

MCP（Model Context Protocol）让你可以在 Claude Desktop、Cursor、VS Code 等 AI 工具中直接操作知识库。

#### 启动 MCP 服务

```bash
npm run mcp
```

#### 配置 AI 客户端

在你的 AI 工具配置文件中添加：

```json
{
  "mcpServers": {
    "llmwiki": {
      "command": "node",
      "args": ["/Users/lichun/IdeaProjects/dragonfly-llmwiki/src/mcp-server.js"]
    }
  }
}
```

不同工具的配置文件位置：
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Cursor**: 项目根目录 `.cursor/mcp.json`
- **VS Code (Copilot)**: `.vscode/mcp.json`

#### MCP 提供的工具

| 工具 | 功能 |
|------|------|
| `wiki_import` | 导入本地文件，支持自动格式转换 |
| `wiki_import_url` | 从 URL 抓取网页内容 |
| `wiki_ingest` | 读取原始资料，准备摄入上下文 |
| `wiki_search` | 按关键词检索 Wiki 内容 |
| `wiki_read` | 读取指定 Wiki 页面 |
| `wiki_list` | 列出所有页面和资料 |
| `wiki_write` | 写入/更新 Wiki 页面 |

#### 使用示例

在 AI 对话中直接说：
- "帮我导入 ~/Documents/paper.pdf 到知识库"
- "搜索知识库中关于 transformer 的内容"
- "列出知识库中所有页面"
- "读取 wiki/overview.md 的内容"

---

## 添加资料

支持以下格式的文件导入：

| 格式 | 说明 |
|------|------|
| .md / .txt | 直接导入 |
| .pdf | 自动转换为 Markdown |
| .docx | Word 文档，自动转换 |
| .pptx | PowerPoint，自动转换 |
| .xlsx | Excel 表格，自动转换 |
| .html | 网页文件，自动转换 |
| .csv / .json / .xml | 数据文件，自动转换 |

导入方式：
1. **TUI 中**：输入 `/import 文件路径` 或按 F3 选择文件
2. **TUI 中**：输入 `/url 网址` 抓取网页
3. **MCP 中**：让 AI 调用 `wiki_import` 工具
4. **手动**：直接把文件放到 `raw/` 文件夹

导入后输入"请摄入"让 AI 整理成知识页面。

---

## 文件夹说明

| 文件夹 | 用途 | 谁来操作 |
|--------|------|----------|
| `raw/` | 存放你的原始资料 | **你** |
| `wiki/` | AI 整理好的知识页面 | **AI** |
| `src/` | 程序代码（不用管） | 自动 |

---

## 常见问题

**Q: 我需要会编程吗？**
A: 不需要。安装好之后，只需要 `npm start` 启动，然后跟 AI 对话就行。

**Q: 支持什么格式的资料？**
A: PDF、Word、PPT、Excel、HTML、Markdown、纯文本等 10+ 种格式。

**Q: 知识库的内容存在哪里？**
A: 全部存在你自己的电脑上，就是这个文件夹里的文件。不会上传到任何地方。

**Q: 可以同时用多个 AI 模型吗？**
A: 可以随时切换。按 F2 或输入 `/model 模型名` 即可切换。

**Q: 三种使用方式可以混合使用吗？**
A: 可以。TUI 和 Obsidian 可以同时打开（一个管理，一个浏览）。MCP 服务可以独立运行，不影响其他方式。

**Q: 长文件会不会摄入不完整？**
A: 不会。系统会自动将长文件按语义边界分段处理，确保内容完整摄入。

---

## 快速开始示例

1. 把一篇文章保存为 `raw/my-article.md`
2. 运行 `npm start`
3. 在输入框输入："请摄入 raw/ 中的新资料"
4. AI 自动整理，左侧文件树会出现新页面
5. 用 Tab 切到文件列表，选择新页面查看内容
6. 继续提问："这篇文章的核心观点是什么？"

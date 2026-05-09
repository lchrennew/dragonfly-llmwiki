# LLM Wiki Schema

## 概述

这是一个由 LLM 增量构建和维护的个人知识库。LLM 负责所有的总结、交叉引用、归档和维护工作。
用户负责策划来源、引导分析方向、提出好的问题。

## 目录结构

```
dragonfly-llmwiki/
├── AGENTS.md          # 本文件 - Schema 配置
├── raw/               # 原始资料（不可变）
│   ├── assets/        # 图片等附件
│   └── *.md           # 源文档（文章、论文、笔记等）
├── wiki/              # LLM 生成的 Wiki 页面
│   ├── index.md       # 内容索引（按类别组织）
│   ├── log.md         # 操作日志（按时间顺序）
│   ├── overview.md    # Wiki 总览和综合摘要
│   ├── entities/      # 实体页面（人物、组织、产品等）
│   ├── concepts/      # 概念页面（理论、方法、模式等）
│   ├── sources/       # 来源摘要页面
│   └── analyses/      # 分析和比较页面
└── tools/             # CLI 辅助工具
    ├── ingest.sh      # 资料摄入脚本
    ├── query.sh       # 查询脚本
    └── lint.sh        # Wiki 健康检查脚本
```

## 页面格式约定

### Frontmatter

每个 Wiki 页面必须包含 YAML frontmatter：

```yaml
---
title: 页面标题
type: entity | concept | source | analysis
tags: [tag1, tag2]
sources: [source1.md, source2.md]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### 链接约定

- 使用 Obsidian 风格的双括号链接：`[[页面名称]]`
- 跨目录链接使用相对路径：`[[../concepts/某概念]]`
- 外部链接使用标准 Markdown 格式：`[文本](URL)`

### 页面命名

- 使用 kebab-case 命名文件：`machine-learning.md`
- 实体页面以实体名称命名：`openai.md`、`transformer.md`
- 概念页面以概念名称命名：`attention-mechanism.md`
- 来源摘要以来源标题简写命名：`attention-is-all-you-need.md`

## 工作流

### 1. Ingest（摄入）

当用户添加新的原始资料到 `raw/` 目录时：

1. 阅读完整的源文档
2. 与用户讨论关键要点
3. 在 `wiki/sources/` 创建来源摘要页面
4. 更新 `wiki/index.md` 添加新条目
5. 识别并更新相关的实体页面（`wiki/entities/`）
6. 识别并更新相关的概念页面（`wiki/concepts/`）
7. 检查新信息是否与现有内容矛盾，如有则标注
8. 更新 `wiki/overview.md` 如果整体理解有变化
9. 在 `wiki/log.md` 追加操作记录

### 2. Query（查询）

当用户提出问题时：

1. 先阅读 `wiki/index.md` 定位相关页面
2. 阅读相关 Wiki 页面
3. 综合信息回答问题，附带引用
4. 如果答案有价值，建议将其保存为新的分析页面到 `wiki/analyses/`
5. 在 `wiki/log.md` 追加查询记录

### 3. Lint（健康检查）

定期执行 Wiki 健康检查：

1. 检查页面间的矛盾
2. 发现被新来源取代的过时信息
3. 找出没有入链的孤立页面
4. 识别被提及但缺少独立页面的重要概念
5. 检查缺失的交叉引用
6. 建议可以通过搜索填补的信息空白
7. 在 `wiki/log.md` 追加检查记录

## 写作风格

- 客观、简洁、信息密度高
- 使用中文撰写所有 Wiki 内容
- 每个页面聚焦一个主题
- 积极使用交叉引用链接
- 标注信息来源
- 明确标记不确定或有争议的内容
- 当新旧信息矛盾时，保留两者并标注

## 索引维护规则

### index.md 格式

```markdown
## 实体
- [[entities/xxx]] - 一句话描述

## 概念
- [[concepts/xxx]] - 一句话描述

## 来源
- [[sources/xxx]] - 一句话描述 (YYYY-MM-DD)

## 分析
- [[analyses/xxx]] - 一句话描述
```

### log.md 格式

```markdown
## [YYYY-MM-DD] 操作类型 | 标题

简要描述本次操作的内容和影响。
涉及页面：[[page1]], [[page2]], ...
```

操作类型包括：`ingest`、`query`、`lint`、`update`

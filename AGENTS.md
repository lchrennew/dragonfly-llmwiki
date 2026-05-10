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
│   ├── index.md       # 内容索引（按领域和类别组织）
│   ├── log.md         # 操作日志（按时间顺序）
│   ├── overview.md    # Wiki 总览和综合摘要
│   ├── domains/       # 领域索引页面
│   │   ├── _meta.json # 领域元数据和演化历史
│   │   └── *.md       # 各领域索引页
│   ├── entities/      # 实体页面（人物、组织、产品等）
│   ├── concepts/      # 概念页面（理论、方法、模式等）
│   ├── sources/       # 来源摘要页面
│   └── analyses/      # 分析和比较页面
└── src/               # 应用源码
    └── app.js         # TUI 主入口
```

## 页面格式约定

### Frontmatter

每个 Wiki 页面必须包含 YAML frontmatter：

**概念和实体页面**：
```yaml
---
title: 页面标题
type: concept | entity
domains: [领域1, 领域2]  # 所属领域（可多个）
tags: [tag1, tag2]
sources: [source1.md, source2.md]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

**来源和分析页面**：
```yaml
---
title: 页面标题
type: source | analysis
domains: [领域1, 领域2]  # 涉及的领域
tags: [tag1, tag2]
sources: [source1.md, source2.md]  # 仅 analysis 需要
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

**领域索引页面**：
```yaml
---
title: 领域名称
type: domain
parent: 父领域名称  # 可选
children: [子领域1, 子领域2]  # 可选
aliases: [别名1, 别名2]  # 可选
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

### 链接约定

- 使用 Obsidian 风格的双括号链接：`[[页面名称]]`
- 跨目录链接使用相对路径：`[[../concepts/某概念]]`
- 外部链接使用标准 Markdown 格式：`[文本](URL)`

### 页面命名

- 中文内容使用中文文件名：`注意力机制.md`、`贾宝玉.md`、`太虚幻境.md`
- 英文/技术内容使用 kebab-case：`transformer.md`、`machine-learning.md`
- 领域名优先英文（作为分类标签）：`chinese-literature.md`、`deep-learning.md`
- 如果概念有通用英文术语，用英文：`attention-mechanism.md`
- 如果概念是中文特有的（人名、地名、文化概念），用中文：`贾宝玉.md`
- 不要使用汉语拼音命名文件

## 工作流

### 1. Ingest（摄入）

当用户添加新的原始资料到 `raw/` 目录时：

1. 阅读完整的源文档
2. 与用户讨论关键要点
3. 在 `wiki/sources/` 创建来源摘要页面
4. **识别或创建领域**：
   - 判断文档所属的领域（如：deep-learning, software-engineering）
   - 如果是新领域，创建领域索引页到 `wiki/domains/`
   - 如果领域已存在，准备更新领域索引页
5. **系统化提取概念**：
   - 识别文档中的**所有**重要概念（理论、方法、模式、技术、原则等）
   - 为**每个**概念创建或更新独立的页面到 `wiki/concepts/`
   - 在概念页面的 frontmatter 中添加 `domains` 字段
   - 概念页面应包含：定义、应用场景、相关概念链接、来源引用
   - 即使一个文档包含多个概念，也要为每个概念单独建页
6. **系统化提取实体**：
   - 识别文档中的**所有**重要实体（人物、组织、产品、项目等）
   - 为**每个**实体创建或更新独立的页面到 `wiki/entities/`
   - 在实体页面的 frontmatter 中添加 `domains` 字段
   - 实体页面应包含：基本信息、背景、相关概念、来源引用
7. **更新领域索引页**：
   - 将新增的概念和实体添加到对应的领域索引页
   - 更新领域之间的父子关系（如果需要）
8. 更新 `wiki/index.md`（只列领域目录和统计数字，不列具体条目）
9. 检查新信息是否与现有内容矛盾，如有则标注
10. 更新 `wiki/overview.md` 反映新增内容对整体知识库的影响
11. 在 `wiki/log.md` 追加操作记录

### 2. Query（查询）

当用户提出问题时，通过多步检索获取相关信息：

1. 阅读 `wiki/index.md` 中的领域列表，判断问题涉及哪些领域
2. 使用 `<<<READ:路径>>>` 指令请求读取相关领域索引页（如 `wiki/domains/deep-learning.md`）
3. 根据领域索引页中的条目，继续请求读取具体的概念/实体页面
4. 信息充足后，综合回答问题，附带引用
5. 如果答案有价值，建议将其保存为新的分析页面到 `wiki/analyses/`

注意：每次请求读取文件时，使用格式 `<<<READ:wiki/concepts/xxx.md>>>`，系统会自动返回文件内容。可以一次请求多个文件。

### 3. Lint（健康检查）

定期执行 Wiki 健康检查：

1. 检查页面间的矛盾
2. 发现被新来源取代的过时信息
3. 找出没有入链的孤立页面
4. 识别被提及但缺少独立页面的重要概念
5. 检查缺失的交叉引用
6. 建议可以通过搜索填补的信息空白
7. **领域演化建议**：
   - 检测某个领域下概念数量过多（>20个）→ 建议细分领域
   - 检测多个领域有大量重叠内容 → 建议合并领域
   - 检测领域命名不一致 → 建议规范化
   - 检测缺少领域索引页的领域 → 建议创建
8. 在 `wiki/log.md` 追加检查记录

## 写作风格

- 客观、简洁、信息密度高
- 使用中文撰写所有 Wiki 内容
- 每个页面聚焦一个主题
- 积极使用交叉引用链接
- 标注信息来源
- 明确标记不确定或有争议的内容
- 当新旧信息矛盾时，保留两者并标注

## 概念提取指南

### 什么是概念

概念是指抽象的、可复用的知识单元，包括但不限于：
- **理论**: 如"注意力机制"、"强化学习"、"微服务架构"
- **方法**: 如"测试驱动开发"、"持续集成"、"A/B测试"
- **模式**: 如"观察者模式"、"单例模式"、"CQRS模式"
- **技术**: 如"Docker容器化"、"GraphQL"、"WebAssembly"
- **原则**: 如"SOLID原则"、"DRY原则"、"最小权限原则"
- **范式**: 如"函数式编程"、"声明式编程"、"响应式编程"

### 概念提取原则

1. **完整性**: 提取文档中提到的**所有**重要概念，不遗漏
2. **独立性**: 每个概念都应该有独立的页面，即使它们相关
3. **粒度适中**: 概念应该是独立可理解的知识单元
4. **可链接性**: 概念之间应该建立交叉引用链接

### 概念页面结构

每个概念页面应包含：

```markdown
---
title: 概念名称
type: concept
tags: [标签1, 标签2]
sources: [来源文件1.md, 来源文件2.md]
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## 定义

简洁清晰的定义（1-2段）

## 核心要点

- 要点1
- 要点2
- 要点3

## 应用场景

何时使用、如何使用

## 相关概念

- [[相关概念1]] - 关系说明
- [[相关概念2]] - 关系说明

## 参考来源

- [[../sources/来源1]] - 具体章节或页码
- [[../sources/来源2]] - 具体章节或页码
```

### 概念提取示例

假设摄入一篇关于"Transformer架构"的论文，应该提取的概念包括：
- `attention-mechanism.md` - 注意力机制
- `self-attention.md` - 自注意力
- `multi-head-attention.md` - 多头注意力
- `positional-encoding.md` - 位置编码
- `encoder-decoder.md` - 编码器-解码器架构
- `transformer.md` - Transformer架构本身

**错误做法**: 只创建一个 `transformer.md` 把所有内容放进去
**正确做法**: 为每个概念创建独立页面，并建立相互链接

## 领域管理指南

### 什么是领域

领域（Domain）是知识的顶层分类，用于组织相关的概念、实体和来源。例如：
- **技术领域**: deep-learning, software-engineering, cloud-computing
- **业务领域**: product-management, marketing, finance
- **跨领域**: ai-ethics, data-science

### 领域组织原则

1. **适度粒度**: 领域不宜过细（避免碎片化）也不宜过粗（避免混乱）
2. **清晰边界**: 领域之间应有明确的区分，但允许概念跨领域
3. **层次结构**: 支持父子关系，如 `machine-learning` → `deep-learning`
4. **动态演化**: 领域可以随着内容增长而细分、合并、重组

### 领域索引页结构

每个领域索引页 `wiki/domains/{domain}.md` 应包含：

```markdown
---
title: 领域名称
type: domain
parent: 父领域  # 可选
children: [子领域1, 子领域2]  # 可选
aliases: [别名1, 别名2]  # 可选
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

## 概述

领域的简要介绍（1-2段）

## 核心概念

- [[../concepts/概念1]] - 简要说明
- [[../concepts/概念2]] - 简要说明

## 重要实体

- [[../entities/实体1]] - 简要说明
- [[../entities/实体2]] - 简要说明

## 关键来源

- [[../sources/来源1]] - 简要说明
- [[../sources/来源2]] - 简要说明

## 子领域

- [[子领域1]] - 简要说明
- [[子领域2]] - 简要说明

## 父领域

- [[父领域]] - 关系说明

## 相关领域

- [[相关领域1]] - 关系说明
```

### 领域演化场景

#### 场景1: 领域细分

当某个领域下的概念数量超过20个时，考虑细分：

```
初期: machine-learning (30个概念)
↓
演化: 
  - deep-learning (15个概念)
  - reinforcement-learning (8个概念)
  - traditional-ml (7个概念)
```

操作步骤：
1. 创建新的子领域索引页
2. 更新相关概念的 `domains` 字段
3. 更新父领域索引页，添加 `children` 字段
4. 在 `wiki/domains/_meta.json` 记录演化历史

#### 场景2: 领域合并

当多个领域有大量重叠内容时，考虑合并：

```
初期: 
  - web-frontend (10个概念)
  - mobile-frontend (8个概念)
↓
演化: frontend-development (18个概念)
```

#### 场景3: 领域重命名

当领域名称不够准确或需要规范化时：

```
ai → artificial-intelligence
ml → machine-learning
```

### 领域元数据管理

`wiki/domains/_meta.json` 记录所有领域的元数据和演化历史：

```json
{
  "domains": {
    "deep-learning": {
      "created": "2026-01-15",
      "parent": "machine-learning",
      "aliases": ["dl", "深度学习"],
      "description": "深度神经网络相关技术",
      "concept_count": 15,
      "entity_count": 8,
      "evolution": [
        {
          "date": "2026-01-15",
          "action": "split_from",
          "source": "machine-learning",
          "reason": "概念数量过多，细分为子领域"
        }
      ]
    }
  }
}
```

## 索引维护规则

### index.md 格式

```markdown
# Wiki 索引

## 领域目录

- [[domains/deep-learning]] - 深度学习：神经网络、注意力机制、模型训练等
- [[domains/software-engineering]] - 软件工程：架构设计、开发方法、工程实践等
- [[domains/product-management]] - 产品管理：需求分析、用户研究、产品策略等

## 统计

- 领域数: 3
- 概念数: 15
- 实体数: 8
- 来源数: 5
```

注意：index.md 只列出**顶层领域**（没有 parent 的领域）及其简要描述，不列出子领域和具体的概念/实体/来源。子领域通过父领域索引页的 children 字段访问。

### log.md 格式

```markdown
## [YYYY-MM-DD] 操作类型 | 标题

简要描述本次操作的内容和影响。
涉及页面：[[page1]], [[page2]], ...
```

操作类型包括：`ingest`、`query`、`lint`、`update`

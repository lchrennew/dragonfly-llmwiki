Inline Ghost Text 本质上就是：

> “用户真实输入” + “预测出来但尚未接受的文本”
> 在同一行视觉上拼接显示。

像：

```text
> git chec[kout origin/main]
```

其中：

* `git chec`
  是用户真实输入
* `kout origin/main`
  是“建议”
* 一般用灰色/低亮度显示
* 按 `Tab`
  接受建议
* 继续输入则重新预测

---

在 TUI 里，难点其实不在“建议逻辑”。

而在：

# 终端渲染与光标同步

因为终端不是 DOM。

你没有：

* absolute positioning
* z-index
* contenteditable
* selection API

所以需要自己维护：

* 光标位置
* 文本宽度
* ANSI color
* Unicode 宽字符
* 重绘时机

---

# Claude Code / Copilot CLI 类实现

一般架构：

```text
┌────────────────────────────┐
│ 用户真实输入 buffer        │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ suggestion engine          │
│ - command tree             │
│ - fuzzy search             │
│ - LLM                      │
└────────────┬───────────────┘
             │
             ▼
┌────────────────────────────┐
│ renderer                   │
│ visible = input + ghost    │
└────────────────────────────┘
```

---

# 最关键的核心思想

真正输入框里：

```text
git chec
```

实际上：

```text
checkout
```

并不存在。

只是：

* renderer 多画了一段灰字

而已。

---

# 终端里如何实现

## 方法1：单行拼接（最常见）

直接渲染：

```text
git chec[90mkout origin/main[0m
```

ANSI 90 = 灰色。

用户实际 buffer：

```ts
"git chec"
```

显示 buffer：

```ts
"git chec" + ghost
```

---

# 光标问题

真正 tricky 的地方来了。

终端光标必须停在：

```text
git chec|
```

而不是：

```text
git checkout origin/main|
```

所以：

## 渲染流程通常是：

### 1. 输出完整显示

```text
git checkout origin/main
```

其中 ghost 为灰色。

---

### 2. 再把光标移动回真实输入末尾

例如：

```ansi
\x1b[20D
```

向左移动20列。

---

最终视觉效果：

```text
git chec|kout origin/main
```

用户看到：

* 光标在真实输入尾部
* 后面灰字是 suggestion

这就是 ghost text。

---

# 为什么这东西难

因为你必须正确处理：

---

## 1、Unicode 宽字符

例如：

```text
你好world
```

汉字宽度 = 2。

emoji 更恶心：

```text
👨‍👩‍👧‍👦
```

可能：

* 8 code points
* 1 个视觉字符
* 宽度 2

所以：

```ts
str.length
```

完全不能用。

必须：

* wcwidth
* grapheme splitter

---

## 2、ANSI 颜色长度不算宽度

```ansi
\x1b[90mhello\x1b[0m
```

实际宽度 = 5。

不能算 escape sequence。

---

## 3、终端自动换行

如果：

```text
terminal width = 20
```

内容超过：

```text
git checkout very-long-branch-name
```

会自动折行。

这时：

* cursor position
* line wrapping
* redraw

都变复杂。

---

## 4、用户编辑中间内容

例如：

```text
git checkout main
      ^
```

用户移动 cursor 到中间。

Ghost Text 要：

* 局部失效
* 重新生成
* 正确 overlay

---

# OpenTUI 怎么做

OpenTUI 相比 Ink 的优势：

它更偏：

```text
真正的 retained-mode UI
```

而不是：

```text
每次 render 一大坨字符串
```

所以你可以：

```ts
<Box direction="row">
  <Text>{input}</Text>
  <Text color="gray">{ghost}</Text>
</Box>
```

然后：

```ts
renderer.setCursor(x, y)
```

把 cursor 放回 input 末尾。

这比 blessed/Ink 更自然。

---

# 更高级实现

真正好的 AI Ghost Text：

不是：

```text
prefix match
```

而是：

# Partial acceptance

例如：

```text
git checkout origin/main
```

用户：

```text
git ch
```

按：

* → 接受一个 token
* Tab 接受全部

变成：

```text
git checkout
```

继续 ghost：

```text
 origin/main
```

Claude Code 很可能有类似逻辑。

---

# AI streaming completion

更高级的是：

LLM 流式输出：

```text
git che
git check
git checkout
git checkout origin
```

Ghost Text 动态更新。

这里最难的是：

# 防止闪烁

通常需要：

* debounce
* stable prefix
* optimistic rendering
* diff patch

而不是每 token 全量重绘。

---

# 真正工业级实现会有：

## Suggestion Layer

```text
用户输入
↓
context parser
↓
completion provider
↓
ranking
↓
ghost renderer
```

---

## Completion Provider

可能同时来自：

* shell history
* command tree
* filesystem
* LSP
* AI
* snippets

然后 merge。

---

# Claude Code 为什么体验好

因为它大概率：

* 有自己的 line editor
* 自己管理 cursor
* 不依赖 readline
* 不依赖 blessed input
* 有 diff-based renderer

所以它的：

* ghost text
* streaming
* partial accept

都很丝滑。

---

# 你如果自己做

我会建议：

## 不要依赖 readline

readline 太难扩展。

---

## 自己维护：

```ts
inputBuffer
cursorPosition
suggestion
```

---

## renderer 只负责：

```text
visible text
cursor
```

---

## suggestion 独立模块

否则后面 AI 接入会崩。

---
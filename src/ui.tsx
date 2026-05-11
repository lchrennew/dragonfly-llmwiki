import { useCallback, useEffect, useRef, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { ScrollBoxRenderable } from "@opentui/core"
import { PromptInput } from "./components/PromptInput.tsx";

const COMMANDS = [
  { cmd: '/import', desc: '导入文件' },
  { cmd: '/ingest', desc: '手工摄入' },
  { cmd: '/ingest!', desc: '强制摄入' },
  { cmd: '/url', desc: '抓取网页' },
  { cmd: '/learn', desc: '录入新知识' },
  { cmd: '/model', desc: '切换模型' },
  { cmd: '/retry', desc: '重试失败段落' },
  { cmd: '/continue', desc: '跳过继续' },
  { cmd: '/reindex', desc: '重建索引' },
  { cmd: '/prune', desc: '清理不可达领域' },
  { cmd: '/lint', desc: '健康检查' },
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/bye', desc: '退出程序' },
]

export interface AppCallbacks {
  onSubmit: (text: string) => void
}

interface ChatMessage {
  role: 'user' | 'system' | 'ai'
  text: string
}

export interface UIHandle {
  appendChat: (role: 'user' | 'system' | 'ai', text: string) => void
  updateLastChat: (role: 'user' | 'system' | 'ai', text: string) => void
  updateStatus: (text: string) => void
  getDefaultStatus: () => string
  setChatLabel: (label: string) => void
}

interface AppProps {
  providerName: string
  callbacks: AppCallbacks
  uiRef: React.MutableRefObject<UIHandle | null>
}

export function App({ providerName, callbacks, uiRef }: AppProps) {
  const { width, height } = useTerminalDimensions()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState("")
  const [statusText, setStatusText] = useState(`模型: ${providerName} | 输入 /help 查看命令`)
  const [chatLabel, setChatLabel] = useState(`AI [${providerName}]`)
  const [hintText, setHintText] = useState("")
  const [hintDesc, setHintDesc] = useState("")
  const [inputFocused, setInputFocused] = useState(true)
  const [inputHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const scrollboxRef = useRef<ScrollBoxRenderable>(null)

  const chatHeight = Math.max(height - 4, 5)

  const getDefaultStatus = useCallback(() => {
    return `模型: ${providerName} | 输入 /help 查看命令`
  }, [providerName])

  useEffect(() => {
    uiRef.current = {
      appendChat: (role, text) => {
        setMessages(prev => {
          const next = [...prev, { role, text }]
          if (next.length > 200) next.shift()
          return next
        })
        setTimeout(() => {
          const scrollbox = scrollboxRef.current
          if (scrollbox && typeof scrollbox.scrollTo === 'function') {
            scrollbox.scrollTo(0, 999999)
          }
        }, 10)
      },
      updateLastChat: (role, text) => {
        setMessages(prev => {
          if (prev.length === 0) return [{ role, text }]
          const next = [...prev]
          next[next.length - 1] = { role, text }
          return next
        })
        setTimeout(() => {
          const scrollbox = scrollboxRef.current
          if (scrollbox && typeof scrollbox.scrollTo === 'function') {
            scrollbox.scrollTo(0, 999999)
          }
        }, 10)
      },
      updateStatus: (text) => setStatusText(text),
      getDefaultStatus,
      setChatLabel: (label) => setChatLabel(label),
    }
  }, [getDefaultStatus, uiRef])

  const updateHint = useCallback((input: string) => {
    if (!input?.startsWith('/')) {
      setHintText("")
      setHintDesc("")
      return
    }
    const matches = COMMANDS.find(c => c.cmd.startsWith(input) && c.cmd !== input)
    if (matches) {
      setHintText(matches.cmd.slice(input.length))
      setHintDesc(matches.desc)
    } else {
      setHintText("")
      setHintDesc("")
    }
  }, [])

  const handleSubmit = useCallback((value: string) => {
    if (!value.trim()) return
    inputHistory.unshift(value)
    if (inputHistory.length > 50) inputHistory.pop()
    setHistoryIndex(-1)
    setInputValue("")
    setHintText("")
    setHintDesc("")
    callbacks.onSubmit(value)
  }, [callbacks, inputHistory])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      process.exit(0)
    }
    if (!inputFocused) {
      if (key.char && !key.ctrl && !key.meta && key.name !== "escape") {
        setInputFocused(true)
        setInputValue(prev => {
          const next = prev + key.char
          updateHint(next)
          return next
        })
      }
      return
    }
    if (key.name === "escape") {
      setInputFocused(false)
      return
    }
    if (key.name === "up") {
      if (inputHistory.length === 0) return
      const newIdx = Math.min(historyIndex + 1, inputHistory.length - 1)
      setHistoryIndex(newIdx)
      setInputValue(inputHistory[newIdx])
      updateHint(inputHistory[newIdx])
      return
    }
    if (key.name === "down") {
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1
        setHistoryIndex(newIdx)
        setInputValue(inputHistory[newIdx])
        updateHint(inputHistory[newIdx])
      } else {
        setHistoryIndex(-1)
        setInputValue("")
        updateHint("")
      }
      return
    }
    if (key.name === "tab") {
      if (hintText) {
        const completed = inputValue + hintText
        setInputValue(completed)
        setHintText("")
        setHintDesc("")
      }
      return
    }
  })

  const formatMessage = (msg: ChatMessage) => {
    const prefix = msg.role === 'user' ? '你: '
      : msg.role === 'system' ? '系统: '
        : 'AI: '
    return prefix + msg.text
  }

  const roleColor = (role: string) => {
    if (role === 'user') return '#ff79c6'
    if (role === 'system') return '#8be9fd'
    return '#f1fa8c'
  }

  return (
    <box flexDirection="column" width={width} height={height}>
      <box title={chatLabel} border borderColor="#e5c07b" height={chatHeight} flexGrow={1}>
        <scrollbox ref={scrollboxRef} focused={!inputFocused} style={{ flexGrow: 1 }}>
          {messages.map((msg, i) => (
            <text key={i} fg={roleColor(msg.role)}>{formatMessage(msg)}</text>
          ))}
        </scrollbox>
      </box>

      <box title="输入 (Enter发送)" border borderColor="#c678dd" height={3}>

        <PromptInput hints={COMMANDS} onSubmit={handleSubmit} />

      </box>

      <text fg="#ffffff" bg="#3b4261">{` ${statusText}`}</text>
    </box>
  )
}

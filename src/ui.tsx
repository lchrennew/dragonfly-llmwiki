import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import { ScrollBoxRenderable } from "@opentui/core"
import { PromptInput } from "./components/PromptInput.tsx"
import { FilePicker } from "./components/FilePicker.tsx"

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
  { cmd: '/clear', desc: '清空对话框' },
  { cmd: '/help', desc: '显示帮助' },
  { cmd: '/bye', desc: '退出程序' },
]

export interface AppCallbacks {
  onSubmit: (text: string) => void
}

interface ChatMessage {
  role: 'user' | 'system' | 'ai' | 'debug'
  text: string
}

export interface UIHandle {
  appendChat: (role: 'user' | 'system' | 'ai' | 'debug', text: string) => void
  updateLastChat: (role: 'user' | 'system' | 'ai' | 'debug', text: string) => void
  updateStatus: (text: string) => void
  getDefaultStatus: () => string
  setChatLabel: (label: string) => void
  showFilePicker: (startDir: string, onSelect: (filePath: string, dir: string) => void) => void
  clearChat: () => void
}

interface AppProps {
  providerName: string
  callbacks: AppCallbacks
  uiRef: MutableRefObject<UIHandle | null>
}

export function App({ providerName, callbacks, uiRef }: AppProps) {
  const { width, height } = useTerminalDimensions()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [statusText, setStatusText] = useState(`模型: ${providerName} | 输入 /help 查看命令`)
  const [chatLabel, setChatLabel] = useState('对话')
  const scrollboxRef = useRef<ScrollBoxRenderable>(null)
  const [pickerState, setPickerState] = useState<{ startDir: string; onSelect: (filePath: string, dir: string) => void } | null>(null)

  const inputBoxHeight = Math.min(Math.floor(height * 0.3), 10)
  const statusBarHeight = 1
  const chatHeight = height - inputBoxHeight - statusBarHeight

  const getDefaultStatus = useCallback(() => {
    return `模型: ${providerName} | 输入 /help 查看命令`
  }, [providerName])

  useEffect(() => {
    uiRef.current = {
      appendChat: (role: 'user' | 'system' | 'ai' | 'debug', text: string) => {
        setMessages(prev => {
          const next = [...prev, { role, text }]
          if (next.length > 200) next.shift()
          return next
        })
      },
      updateLastChat: (role: 'user' | 'system' | 'ai' | 'debug', text: string) => {
        setMessages(prev => {
          if (prev.length === 0) return [{ role, text }]
          const next = [...prev]
          next[next.length - 1] = { role, text }
          return next
        })
      },
      updateStatus: (text: string) => setStatusText(text),
      getDefaultStatus,
      setChatLabel: (label: string) => setChatLabel(label),
      showFilePicker: (startDir: string, onSelect: (filePath: string, dir: string) => void) => {
        setPickerState({ startDir, onSelect })
      },
      clearChat: () => setMessages([]),
    }
  }, [getDefaultStatus, uiRef])

  const handleSubmit = useCallback((value: string) => {
    if (!value.trim()) return
    callbacks.onSubmit(value)
  }, [callbacks])

  const handlePickerSelect = useCallback((filePath: string, dir: string) => {
    setPickerState(null)
    pickerState?.onSelect(filePath, dir)
  }, [pickerState])

  const handlePickerCancel = useCallback(() => {
    setPickerState(null)
  }, [])

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") process.exit(0)
    if (pickerState) return
  })

  const formatMessage = (msg: ChatMessage) => {
    const prefix = msg.role === 'user' ? '你: '
      : msg.role === 'system' ? '系统: '
        : msg.role === 'debug' ? '调试: '
          : 'AI: '
    return prefix + msg.text
  }

  const roleColor = (role: string) => {
    if (role === 'user') return '#ff79c6'
    if (role === 'system') return '#8be9fd'
    if (role === 'debug') return '#bd93f9'
    return '#f1fa8c'
  }

  return (
    <box flexDirection="column" width={width} height={height}>
      <box title={chatLabel} border borderColor="#e5c07b" height={chatHeight}>
        <scrollbox ref={scrollboxRef} focused={false} stickyScroll stickyStart="bottom" style={{ flexGrow: 1 }}>
          {messages.map((msg, i) => (
            <text key={i} fg={roleColor(msg.role)}>{formatMessage(msg)}</text>
          ))}
        </scrollbox>
      </box>
      <box title="输入 (Enter换行, Cmd/Ctrl+Enter发送)" border borderColor="#c678dd" height={inputBoxHeight}>
        <PromptInput hints={COMMANDS} onSubmit={handleSubmit} placeholder="输入命令或问题..." disabled={!!pickerState} />
      </box>
      <text fg="#ffffff" bg="#3b4261">{` ${statusText}`}</text>
      {pickerState && (
        <FilePicker
          startDir={pickerState.startDir}
          onSelect={handlePickerSelect}
          onCancel={handlePickerCancel}
        />
      )}
    </box>
  )
}

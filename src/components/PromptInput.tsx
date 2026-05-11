import { useCallback, useMemo, useRef, useState } from 'react'
import { useKeyboard, usePaste } from '@opentui/react'

interface HintItem {
  cmd: string
  desc: string
}

interface PromptInputProps {
  value?: string
  onInput?: (val: string) => void
  onSubmit?: (val: string) => void
  placeholder?: string
  hints?: HintItem[]
}

export function PromptInput({ value, onInput, onSubmit, placeholder, hints = [] }: PromptInputProps) {
  const valueRef = useRef('')
  const cursorRef = useRef(0)
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const stashRef = useRef('')
  const [, setTick] = useState(0)

  const rerender = useCallback(() => setTick(t => t + 1), [])

  const commit = useCallback((newValue: string, newCursor: number) => {
    valueRef.current = newValue
    cursorRef.current = newCursor
    rerender()
    onInput?.(newValue)
  }, [onInput, rerender])

  const moveCursor = useCallback((newCursor: number) => {
    cursorRef.current = newCursor
    rerender()
  }, [rerender])

  const insertText = useCallback((text: string) => {
    const sanitized = text.replace(/[\n\r]/g, '')
    if (!sanitized) return
    const pos = cursorRef.current
    const prev = valueRef.current
    const next = prev.slice(0, pos) + sanitized + prev.slice(pos)
    commit(next, pos + sanitized.length)
  }, [commit])

  const internalValue = valueRef.current
  const cursorPosition = cursorRef.current

  const hintMatch = useMemo(() => {
    if (!internalValue || hints.length === 0) return null
    const match = hints.find(h => h.cmd.startsWith(internalValue) && h.cmd !== internalValue)
    return match || null
  }, [internalValue, hints])

  usePaste((event) => {
    const text = Buffer.from(event.bytes).toString('utf-8')
    insertText(text)
  })

  useKeyboard((key) => {
    const pos = cursorRef.current
    const val = valueRef.current

    if (key.name === 'return') {
      if (val) {
        historyRef.current.unshift(val)
        if (historyRef.current.length > 50) historyRef.current.pop()
      }
      historyIndexRef.current = -1
      onSubmit?.(val)
      commit('', 0)
      return
    }

    if (key.name === 'up') {
      const history = historyRef.current
      if (history.length === 0) return
      if (historyIndexRef.current === -1) {
        stashRef.current = val
      }
      const newIdx = Math.min(historyIndexRef.current + 1, history.length - 1)
      historyIndexRef.current = newIdx
      const entry = history[newIdx]
      commit(entry, entry.length)
      return
    }

    if (key.name === 'down') {
      if (historyIndexRef.current > 0) {
        const newIdx = historyIndexRef.current - 1
        historyIndexRef.current = newIdx
        const entry = historyRef.current[newIdx]
        commit(entry, entry.length)
      } else if (historyIndexRef.current === 0) {
        historyIndexRef.current = -1
        const restored = stashRef.current
        commit(restored, restored.length)
      }
      return
    }

    if (key.name === 'tab') {
      if (hintMatch) {
        const completed = hintMatch.cmd
        commit(completed, completed.length)
      }
      return
    }

    if (key.name === 'backspace') {
      if (pos > 0) {
        const next = val.slice(0, pos - 1) + val.slice(pos)
        commit(next, pos - 1)
      }
      return
    }

    if (key.name === 'delete') {
      if (pos < val.length) {
        const next = val.slice(0, pos) + val.slice(pos + 1)
        commit(next, pos)
      }
      return
    }

    if (key.name === 'left') {
      moveCursor(Math.max(0, pos - 1))
      return
    }

    if (key.name === 'right') {
      moveCursor(Math.min(val.length, pos + 1))
      return
    }

    if (key.ctrl && key.name === 'a') {
      moveCursor(0)
      return
    }

    if (key.ctrl && key.name === 'e') {
      moveCursor(val.length)
      return
    }

    if (key.ctrl && key.name === 'k') {
      commit(val.slice(0, pos), pos)
      return
    }

    if (key.ctrl && key.name === 'u') {
      commit(val.slice(pos), 0)
      return
    }

    if (!key.ctrl && !key.meta && key.sequence) {
      if (key.name === 'space') {
        insertText(' ')
        return
      }
      const charCode = key.sequence.charCodeAt(0)
      if (charCode >= 32 && charCode !== 127) {
        insertText(key.sequence)
      }
    }
  })

  const before = internalValue.slice(0, cursorPosition)
  const after = internalValue.slice(cursorPosition + 1)
    || (hintMatch && <span fg="#5c6370">{hintMatch.cmd.slice(internalValue.length + 1)} {hintMatch.desc}</span>)
  const cursorChar = internalValue[cursorPosition]
    || (hintMatch && (internalValue.length === cursorPosition) && <span fg="#5c6370">{hintMatch.cmd[internalValue.length]}</span>)
    || ' '
  return <text fg="#ffffff">
    {before}
    <span bg="#ffffff" fg="#000000">{cursorChar}</span>
    {after}
  </text>
}

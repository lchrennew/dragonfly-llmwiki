import { useCallback, useMemo, useRef, useState } from 'react'
import { useKeyboard, usePaste } from '@opentui/react'
import { useBindings } from '@opentui/keymap/react'

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
  disabled?: boolean
}

export function PromptInput({ value, onInput, onSubmit, placeholder, hints = [], disabled }: PromptInputProps) {
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
    if (!text) return
    const pos = cursorRef.current
    const prev = valueRef.current
    const next = prev.slice(0, pos) + text + prev.slice(pos)
    commit(next, pos + text.length)
  }, [commit])

  const handleSubmit = useCallback(() => {
    const val = valueRef.current
    if (val) {
      historyRef.current.unshift(val)
      if (historyRef.current.length > 50) historyRef.current.pop()
    }
    historyIndexRef.current = -1
    onSubmit?.(val)
    commit('', 0)
  }, [onSubmit, commit])

  useBindings(() => ({
    commands: [
      {
        name: 'submit-input',
        run: () => handleSubmit()
      }
    ],
    bindings: [
      { key: 'ctrl+return', cmd: 'submit-input' },
      { key: { name: 'return', ctrl: true }, cmd: 'submit-input' },
      { key: { name: 'return', meta: true }, cmd: 'submit-input' }
    ]
  }), [handleSubmit])

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
    if (disabled) return
    const pos = cursorRef.current
    const val = valueRef.current

    if (key.name === 'return') {
      insertText('\n')
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
  const cursorChar = internalValue[cursorPosition] || ' '

  if (!internalValue && placeholder) {
    return <text fg="#5c6370">
      <span bg="#ffffff" fg="#000000"> </span>
      {placeholder}
    </text>
  }

  const lines = internalValue.split('\n')
  const beforeLines = before.split('\n')
  const cursorLine = beforeLines.length - 1
  const cursorCol = beforeLines[cursorLine].length

  const renderLines = lines.map((line, lineIdx) => {
    if (lineIdx === cursorLine) {
      const beforeCursor = line.slice(0, cursorCol)
      const atCursor = line[cursorCol] || ' '
      const afterCursor = line.slice(cursorCol + 1)
      return (
        <text key={lineIdx} fg="#ffffff">
          {beforeCursor}
          <span bg="#ffffff" fg="#000000">{atCursor}</span>
          {afterCursor}
        </text>
      )
    }
    return <text key={lineIdx} fg="#ffffff">{line || ' '}</text>
  })

  if (hintMatch && cursorPosition === internalValue.length) {
    const hintText = hintMatch.cmd.slice(internalValue.length)
    const lastLineIdx = renderLines.length - 1
    renderLines[lastLineIdx] = (
      <text key={lastLineIdx} fg="#ffffff">
        {lines[lastLineIdx]}
        <span fg="#5c6370">{hintText} {hintMatch.desc}</span>
      </text>
    )
  }

  return <scrollbox style={{ flexGrow: 1 }}>
    {renderLines}
  </scrollbox>
}

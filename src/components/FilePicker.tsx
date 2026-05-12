import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { MouseEvent } from '@opentui/core'
import fs from 'fs'
import path from 'path'

interface FilePickerProps {
  startDir: string
  onSelect: (filePath: string, dir: string) => void
  onCancel: () => void
}

interface DirEntry {
  name: string
  type: 'dir' | 'file'
}

const FILE_EXTS = /\.(md|txt|pdf|docx|pptx|xlsx|html|htm|csv|json|xml)$/i

export function FilePicker({ startDir, onSelect, onCancel }: FilePickerProps) {
  const { width, height } = useTerminalDimensions()
  const [currentDir, setCurrentDir] = useState(startDir)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const lastClickRef = useRef<{ index: number; time: number }>({ index: -1, time: 0 })
  const DOUBLE_CLICK_MS = 400

  const entries = useMemo(() => {
    try {
      const raw = fs.readdirSync(currentDir, { withFileTypes: true })
        .filter(e => !e.name.startsWith('.'))
        .sort((a, b) => {
          if (a.isDirectory() && !b.isDirectory()) return -1
          if (!a.isDirectory() && b.isDirectory()) return 1
          return a.name.localeCompare(b.name)
        })
      const result: DirEntry[] = [{ name: '..', type: 'dir' }]
      for (const e of raw) {
        if (e.isDirectory()) {
          result.push({ name: e.name, type: 'dir' })
        } else if (FILE_EXTS.test(e.name)) {
          result.push({ name: e.name, type: 'file' })
        }
      }
      return result
    } catch {
      return [{ name: '..', type: 'dir' }] as DirEntry[]
    }
  }, [currentDir])

  useEffect(() => {
    setSelectedIndex(0)
    setScrollOffset(0)
  }, [currentDir])

  const pickerHeight = Math.min(Math.floor(height * 0.6), entries.length + 2)
  const pickerWidth = Math.min(Math.floor(width * 0.7), 80)
  const visibleCount = pickerHeight - 2

  // 同步键盘选择与滚动
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex)
    } else if (selectedIndex >= scrollOffset + visibleCount) {
      setScrollOffset(selectedIndex - visibleCount + 1)
    }
  }, [selectedIndex, visibleCount])

  const handleSelect = useCallback((entry: DirEntry) => {
    if (entry.type === 'dir') {
      if (entry.name === '..') {
        setCurrentDir(path.dirname(currentDir))
      } else {
        setCurrentDir(path.join(currentDir, entry.name))
      }
    } else {
      onSelect(path.join(currentDir, entry.name), currentDir)
    }
  }, [currentDir, onSelect])

  const handleItemClick = useCallback((realIdx: number) => {
    const now = Date.now()
    const last = lastClickRef.current
    if (last.index === realIdx && now - last.time < DOUBLE_CLICK_MS) {
      const entry = entries[realIdx]
      if (entry) handleSelect(entry)
      lastClickRef.current = { index: -1, time: 0 }
    } else {
      setSelectedIndex(realIdx)
      lastClickRef.current = { index: realIdx, time: now }
    }
  }, [entries, handleSelect, DOUBLE_CLICK_MS])

  const handleMouseScroll = useCallback((e: MouseEvent) => {
    if (e.type === 'scroll' && e.scroll) {
      const delta = e.scroll.delta * (e.scroll.direction === 'up' ? -1 : 1)
      setScrollOffset(offset => Math.max(0, Math.min(entries.length - visibleCount, offset + delta)))
    }
  }, [entries.length, visibleCount])

  useKeyboard((key) => {
    if (key.name === 'escape') {
      onCancel()
      return
    }
    if (key.name === 'backspace') {
      setCurrentDir(path.dirname(currentDir))
      return
    }
    if (key.name === 'return') {
      const entry = entries[selectedIndex]
      if (entry) handleSelect(entry)
      return
    }
    if (key.name === 'up' || (key.ctrl && key.name === 'k')) {
      setSelectedIndex(i => Math.max(0, i - 1))
      return
    }
    if (key.name === 'down' || (key.ctrl && key.name === 'j')) {
      setSelectedIndex(i => Math.min(entries.length - 1, i + 1))
      return
    }
  })

  const visibleEntries = entries.slice(scrollOffset, scrollOffset + visibleCount)
  const top = Math.floor((height - pickerHeight) / 2)
  const left = Math.floor((width - pickerWidth) / 2)

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={pickerWidth}
      height={pickerHeight}
      border
      borderColor="#8be9fd"
      title={` 📂 ${currentDir} `}
      backgroundColor="#282a36"
      onMouseScroll={handleMouseScroll}
    >
      <scrollbox style={{ flexGrow: 1 }}>
        {visibleEntries.map((entry, i) => {
          const realIdx = scrollOffset + i
          const isSelected = realIdx === selectedIndex
          const prefix = entry.type === 'dir' ? '📁 ' : '📄 '
          const label = entry.name === '..' ? '[上级目录] ..' : `${prefix}${entry.name}`
          return (
            <text
              key={`${currentDir}-${realIdx}`}
              bg={isSelected ? '#44475a' : undefined}
              fg={isSelected ? '#f8f8f2' : (entry.type === 'dir' ? '#8be9fd' : '#f8f8f2')}
              onMouseDown={() => handleItemClick(realIdx)}
              selectable={false}
            >
              {isSelected ? ' ▸ ' : '   '}{label}
            </text>
          )
        })}
      </scrollbox>
    </box>
  )
}

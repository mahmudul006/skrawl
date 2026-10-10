import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  FONT_SIZE,
  LINE_HEIGHT,
  elementAt,
  exportToCanvas,
  hitTest,
  measureText,
  newId,
  normalize,
  randomSeed,
  renderScene,
} from './scene'
import type { SkrawlElement, Tool, View } from './types'
import './App.css'

const STORAGE_KEY = 'skrawl:scene'
const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']
const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99']
const STROKE_WIDTHS = [1, 2, 4]
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8

const TOOLS: { tool: Tool; label: string; key: string; icon: string }[] = [
  { tool: 'select', label: 'Select', key: 'v', icon: '↖' },
  { tool: 'hand', label: 'Hand (or hold Space)', key: 'h', icon: '✋' },
  { tool: 'rectangle', label: 'Rectangle', key: 'r', icon: '▭' },
  { tool: 'ellipse', label: 'Ellipse', key: 'o', icon: '◯' },
  { tool: 'arrow', label: 'Arrow', key: 'a', icon: '→' },
  { tool: 'line', label: 'Line', key: 'l', icon: '╱' },
  { tool: 'freedraw', label: 'Pen', key: 'p', icon: '✎' },
  { tool: 'text', label: 'Text', key: 't', icon: 'T' },
  { tool: 'eraser', label: 'Eraser', key: 'e', icon: '⌫' },
]

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: 'create'; id: string }
  | { kind: 'move'; id: string; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'erase' }

interface TextEditor {
  id: string | null
  x: number
  y: number
  value: string
}

function loadScene(): SkrawlElement[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SkrawlElement[]) : []
  } catch {
    return []
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [elements, setElements] = useState<SkrawlElement[]>(loadScene)
  const elementsRef = useRef(elements)
  const [view, setView] = useState<View>({ scrollX: 0, scrollY: 0, zoom: 1 })
  const viewRef = useRef(view)
  const [tool, setTool] = useState<Tool>('freedraw')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [strokeColor, setStrokeColor] = useState(STROKE_COLORS[0])
  const [backgroundColor, setBackgroundColor] = useState(FILL_COLORS[0])
  const [strokeWidth, setStrokeWidth] = useState(STROKE_WIDTHS[1])
  const [showGrid, setShowGrid] = useState(true)
  const [editor, setEditor] = useState<TextEditor | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [, setFontsReady] = useState(0)

  const interaction = useRef<Interaction>({ kind: 'none' })
  const snapshot = useRef<SkrawlElement[]>(elements)
  const past = useRef<SkrawlElement[][]>([])
  const future = useRef<SkrawlElement[][]>([])

  const setScene = useCallback((next: SkrawlElement[]) => {
    elementsRef.current = next
    setElements(next)
  }, [])

  const updateView = useCallback((next: View) => {
    viewRef.current = next
    setView(next)
  }, [])

  /** Records the scene as it was before the current change so it can be undone. */
  const pushHistory = useCallback((before: SkrawlElement[]) => {
    if (before === elementsRef.current) return
    past.current.push(before)
    if (past.current.length > 200) past.current.shift()
    future.current = []
  }, [])

  const commit = useCallback(
    (next: SkrawlElement[]) => {
      const before = elementsRef.current
      setScene(next)
      pushHistory(before)
    },
    [pushHistory, setScene],
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(elementsRef.current)
    setScene(prev)
    setSelectedId(null)
  }, [setScene])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(elementsRef.current)
    setScene(next)
    setSelectedId(null)
  }, [setScene])

  const toWorld = (clientX: number, clientY: number) => {
    const v = viewRef.current
    return { x: clientX / v.zoom - v.scrollX, y: clientY / v.zoom - v.scrollY }
  }

  const tolerance = () => 8 / viewRef.current.zoom

  // --- rendering -----------------------------------------------------------

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    if (canvas.width !== size.width * dpr || canvas.height !== size.height * dpr) {
      canvas.width = size.width * dpr
      canvas.height = size.height * dpr
    }
    renderScene(canvas, elements, {
      ...size,
      dpr,
      view,
      selectedId,
      hiddenId: editor?.id ?? undefined,
      showGrid,
    })
  })

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    // Text is measured and drawn with the web font, so redraw once it arrives.
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1))
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(elements))
    } catch {
      // Storage can be full or blocked; the drawing still works in memory.
    }
  }, [elements])

  // --- wheel: scroll to pan, ctrl/cmd + scroll (or pinch) to zoom -----------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const zoom = clamp(v.zoom * Math.exp(-e.deltaY * 0.01), MIN_ZOOM, MAX_ZOOM)
        const wx = e.clientX / v.zoom - v.scrollX
        const wy = e.clientY / v.zoom - v.scrollY
        updateView({ zoom, scrollX: e.clientX / zoom - wx, scrollY: e.clientY / zoom - wy })
      } else {
        updateView({ ...v, scrollX: v.scrollX - e.deltaX / v.zoom, scrollY: v.scrollY - e.deltaY / v.zoom })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [updateView])

  const zoomBy = (factor: number) => {
    const v = viewRef.current
    const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const cx = size.width / 2
    const cy = size.height / 2
    updateView({ zoom, scrollX: cx / zoom - (cx / v.zoom - v.scrollX), scrollY: cy / zoom - (cy / v.zoom - v.scrollY) })
  }

  // --- keyboard ------------------------------------------------------------

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    commit(elementsRef.current.filter((el) => el.id !== selectedId))
    setSelectedId(null)
  }, [commit, selectedId])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key === ' ') {
        e.preventDefault()
        setSpaceHeld(true)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
        setTool('select')
      } else if (!mod && !e.altKey) {
        const match = TOOLS.find((t) => t.key === key)
        if (match) setTool(match.tool)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [deleteSelected, redo, undo])

  // --- text editing --------------------------------------------------------

  const commitText = () => {
    if (!editor) return
    const text = editor.value.replace(/\s+$/, '')
    const rest = elementsRef.current.filter((el) => el.id !== editor.id)
    const existing = elementsRef.current.find((el) => el.id === editor.id)
    setEditor(null)
    if (!text) {
      if (existing) commit(rest)
      return
    }
    const { width, height } = measureText(text)
    const el: SkrawlElement = existing
      ? { ...existing, text, width, height }
      : {
          id: newId(),
          type: 'text',
          x: editor.x,
          y: editor.y,
          width,
          height,
          text,
          strokeColor,
          backgroundColor: 'transparent',
          strokeWidth,
          seed: randomSeed(),
        }
    if (existing?.text === text) return
    commit(existing ? elementsRef.current.map((e) => (e.id === el.id ? el : e)) : [...rest, el])
  }

  const openEditor = (x: number, y: number, existing?: SkrawlElement) => {
    setSelectedId(null)
    setEditor(existing ? { id: existing.id, x: existing.x, y: existing.y, value: existing.text ?? '' } : { id: null, x, y, value: '' })
  }

  // --- pointer -------------------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (editor) return // the textarea's blur commits it
    e.currentTarget.setPointerCapture(e.pointerId)
    const { x, y } = toWorld(e.clientX, e.clientY)
    snapshot.current = elementsRef.current

    if (tool === 'hand' || spaceHeld || e.button === 1) {
      const v = viewRef.current
      interaction.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, scrollX: v.scrollX, scrollY: v.scrollY }
      return
    }

    switch (tool) {
      case 'select': {
        const hit = elementAt(elementsRef.current, x, y, tolerance())
        setSelectedId(hit?.id ?? null)
        interaction.current = hit
          ? { kind: 'move', id: hit.id, startX: x, startY: y, origX: hit.x, origY: hit.y }
          : { kind: 'none' }
        return
      }
      case 'eraser':
        interaction.current = { kind: 'erase' }
        setScene(elementsRef.current.filter((el) => !hitTest(el, x, y, tolerance())))
        return
      case 'text':
        e.preventDefault()
        openEditor(x, y - (FONT_SIZE * LINE_HEIGHT) / 2)
        return
      default: {
        const el: SkrawlElement = {
          id: newId(),
          type: tool,
          x,
          y,
          width: 0,
          height: 0,
          points: tool === 'freedraw' ? [[0, 0]] : undefined,
          strokeColor,
          backgroundColor,
          strokeWidth,
          seed: randomSeed(),
        }
        setSelectedId(null)
        setScene([...elementsRef.current, el])
        interaction.current = { kind: 'create', id: el.id }
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const action = interaction.current
    if (action.kind === 'none') return
    const v = viewRef.current
    const { x, y } = toWorld(e.clientX, e.clientY)

    if (action.kind === 'pan') {
      updateView({
        ...v,
        scrollX: action.scrollX + (e.clientX - action.startX) / v.zoom,
        scrollY: action.scrollY + (e.clientY - action.startY) / v.zoom,
      })
    } else if (action.kind === 'erase') {
      const next = elementsRef.current.filter((el) => !hitTest(el, x, y, tolerance()))
      if (next.length !== elementsRef.current.length) setScene(next)
    } else {
      setScene(
        elementsRef.current.map((el) => {
          if (el.id !== action.id) return el
          if (action.kind === 'move') {
            return { ...el, x: action.origX + x - action.startX, y: action.origY + y - action.startY }
          }
          if (el.type === 'freedraw') {
            return { ...el, points: [...(el.points ?? []), [x - el.x, y - el.y]] }
          }
          let width = x - el.x
          let height = y - el.y
          if (e.shiftKey && (el.type === 'rectangle' || el.type === 'ellipse')) {
            // Shift draws squares and circles.
            const side = Math.max(Math.abs(width), Math.abs(height))
            width = Math.sign(width || 1) * side
            height = Math.sign(height || 1) * side
          }
          return { ...el, width, height }
        }),
      )
    }
  }

  const onPointerUp = () => {
    const action = interaction.current
    interaction.current = { kind: 'none' }
    if (action.kind === 'create') {
      // Drop accidental clicks that produced an invisible shape.
      setScene(
        elementsRef.current
          .filter((el) => el.id !== action.id || el.type === 'freedraw' || Math.hypot(el.width, el.height) > 2)
          .map((el) => (el.id === action.id ? normalize(el) : el)),
      )
    }
    pushHistory(snapshot.current)
  }

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select') return
    const { x, y } = toWorld(e.clientX, e.clientY)
    const hit = elementAt(elementsRef.current, x, y, tolerance())
    if (!hit || hit.type === 'text') {
      e.preventDefault()
      openEditor(x, y - (FONT_SIZE * LINE_HEIGHT) / 2, hit)
    }
  }

  // --- style panel ---------------------------------------------------------

  const selected = elements.find((el) => el.id === selectedId)

  const applyStyle = (patch: Partial<Pick<SkrawlElement, 'strokeColor' | 'backgroundColor' | 'strokeWidth'>>) => {
    if (patch.strokeColor) setStrokeColor(patch.strokeColor)
    if (patch.backgroundColor) setBackgroundColor(patch.backgroundColor)
    if (patch.strokeWidth) setStrokeWidth(patch.strokeWidth)
    if (selected) commit(elementsRef.current.map((el) => (el.id === selected.id ? { ...el, ...patch } : el)))
  }

  const current = {
    strokeColor: selected?.strokeColor ?? strokeColor,
    backgroundColor: selected?.backgroundColor ?? backgroundColor,
    strokeWidth: selected?.strokeWidth ?? strokeWidth,
  }

  const exportPng = () => {
    exportToCanvas(elementsRef.current).toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'skrawl.png'
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  const clearCanvas = () => {
    if (elementsRef.current.length === 0) return
    if (!window.confirm('Clear the whole canvas? You can undo this.')) return
    commit([])
    setSelectedId(null)
  }

  const cursor =
    tool === 'hand' || spaceHeld ? 'grab' : tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div className="app">
      <canvas
        ref={canvasRef}
        className="board"
        style={{ width: size.width, height: size.height, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      />

      <header className="toolbar panel" role="toolbar" aria-label="Tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool ${tool === t.tool ? 'active' : ''}`}
            title={`${t.label} — ${t.key.toUpperCase()}`}
            aria-label={t.label}
            aria-pressed={tool === t.tool}
            onClick={() => setTool(t.tool)}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-key">{t.key.toUpperCase()}</span>
          </button>
        ))}
      </header>

      <aside className="style-panel panel" aria-label="Style">
        <div className="field">
          <span className="field-label">Stroke</span>
          <div className="swatches">
            {STROKE_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${current.strokeColor === c ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={`Stroke ${c}`}
                onClick={() => applyStyle({ strokeColor: c })}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Fill</span>
          <div className="swatches">
            {FILL_COLORS.map((c) => (
              <button
                key={c}
                className={`swatch ${c === 'transparent' ? 'transparent' : ''} ${current.backgroundColor === c ? 'active' : ''}`}
                style={{ background: c === 'transparent' ? undefined : c }}
                aria-label={`Fill ${c}`}
                onClick={() => applyStyle({ backgroundColor: c })}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Width</span>
          <div className="swatches">
            {STROKE_WIDTHS.map((w) => (
              <button
                key={w}
                className={`width-btn ${current.strokeWidth === w ? 'active' : ''}`}
                aria-label={`Stroke width ${w}`}
                onClick={() => applyStyle({ strokeWidth: w })}
              >
                <span style={{ height: w + 1 }} />
              </button>
            ))}
          </div>
        </div>
        {selected && (
          <button className="text-btn danger" onClick={deleteSelected}>
            Delete
          </button>
        )}
      </aside>

      <div className="menu panel">
        <button className="text-btn" onClick={exportPng} disabled={elements.length === 0}>
          Export PNG
        </button>
        <button className="text-btn" onClick={() => setShowGrid((g) => !g)}>
          {showGrid ? 'Hide grid' : 'Show grid'}
        </button>
        <button className="text-btn" onClick={clearCanvas}>
          Clear
        </button>
      </div>

      <footer className="footer">
        <div className="panel group">
          <button className="icon-btn" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out">
            −
          </button>
          <button className="icon-btn zoom-label" onClick={() => updateView({ ...view, zoom: 1 })} title="Reset zoom">
            {Math.round(view.zoom * 100)}%
          </button>
          <button className="icon-btn" onClick={() => zoomBy(1.2)} aria-label="Zoom in">
            +
          </button>
        </div>
        <div className="panel group">
          <button className="icon-btn" onClick={undo} aria-label="Undo" title="Undo — Ctrl+Z">
            ↶
          </button>
          <button className="icon-btn" onClick={redo} aria-label="Redo" title="Redo — Ctrl+Shift+Z">
            ↷
          </button>
        </div>
      </footer>

      {elements.length === 0 && !editor && (
        <div className="welcome">
          <h1>Skrawl</h1>
          <p>Pick a tool and start sketching. Scroll to pan, Ctrl + scroll to zoom.</p>
        </div>
      )}

      {editor && (
        <textarea
          className="text-editor"
          autoFocus
          value={editor.value}
          rows={Math.max(1, editor.value.split('\n').length)}
          style={{
            left: (editor.x + view.scrollX) * view.zoom,
            top: (editor.y + view.scrollY) * view.zoom,
            fontSize: FONT_SIZE * view.zoom,
            lineHeight: LINE_HEIGHT,
            color: elements.find((el) => el.id === editor.id)?.strokeColor ?? strokeColor,
          }}
          onChange={(e) => setEditor({ ...editor, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) e.currentTarget.blur()
          }}
        />
      )}
    </div>
  )
}

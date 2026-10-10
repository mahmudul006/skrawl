import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Dialog, PresentBar, StylePanel, Toast, TopMenu, Toolbar } from './components'
import { FILL_COLORS, STROKE_COLORS, STROKE_WIDTHS, TOOLS } from './constants'
import type { StyleValues, ToastData } from './constants'
import { center, elementAt, getBounds, hasCenteredLabel, isLinear, normalizeBox, normalizeFreedraw } from './geometry'
import { LaserTrail } from './laser'
import { MERMAID_EXAMPLE, mermaidToElements } from './mermaid'
import {
  canBindTo,
  cloneElements,
  reorder,
  resizeElement,
  restoreElements,
  rotateElement,
  updateBindings,
  withFrameContents,
} from './ops'
import type { LayerMove } from './ops'
import { recognizeStroke, toShape } from './recognize'
import { contentBounds, exportToCanvas, getHandles, labelWidth, newId, randomSeed, renderScene, textLayout } from './scene'
import type { HandleId } from './scene'
import { clearSharedScene, createShareLink, hasSharedScene, readSharedScene } from './share'
import { exportToSvg } from './svg'
import { HAND_FONT, LINE_HEIGHT, STICKY_PADDING, STICKY_SIZE, TEXT_SIZE, UI_FONT, measureText } from './text'
import type { Bounds, ElementType, Point, SkrawlElement, Tool, View } from './types'
import './App.css'

const STORAGE_KEY = 'skrawl:scene'
const PREFS_KEY = 'skrawl:prefs'
const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const STICKY_DEFAULT = '#ffec99'
const DOUBLE_TAP_MS = 320
// Set when the host page blocks file downloads, e.g. an embedded preview.
const CAN_DOWNLOAD = !import.meta.env.VITE_NO_DOWNLOAD

const DRAWING_TOOLS: Tool[] = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'sticky']
/** After drawing one of these, switch back to Select with the new shape selected. */
const SELECT_AFTER: Tool[] = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'frame']

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; startX: number; startY: number; scrollX: number; scrollY: number }
  | { kind: 'create'; id: string }
  | { kind: 'move'; start: Point; origins: Map<string, SkrawlElement> }
  | { kind: 'resize'; orig: SkrawlElement; handle: HandleId }
  | { kind: 'rotate'; orig: SkrawlElement; start: Point }
  | { kind: 'endpoint'; id: string; which: 'start' | 'end' }
  | { kind: 'marquee'; start: Point; base: string[] }
  | { kind: 'erase' }
  | { kind: 'laser' }

interface Pinch {
  dist: number
  midX: number
  midY: number
  view: View
}

interface Editor {
  /** null while typing a brand-new text element. */
  id: string | null
  kind: 'text' | 'label' | 'frame'
  /** World position of a new text element. */
  x: number
  y: number
  value: string
}

interface Prefs {
  showGrid: boolean
  dark: boolean
  autoShapes: boolean
}

function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked; the drawing still works in memory.
  }
}

function loadPrefs(): Prefs {
  const stored = loadJson<Partial<Prefs>>(PREFS_KEY) ?? {}
  return {
    showGrid: stored.showGrid ?? true,
    dark: stored.dark ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
    autoShapes: stored.autoShapes ?? true,
  }
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const laserCanvasRef = useRef<HTMLCanvasElement>(null)
  const laser = useRef<LaserTrail | null>(null)

  const [elements, setElements] = useState<SkrawlElement[]>(() => restoreElements(loadJson(STORAGE_KEY)))
  const elementsRef = useRef(elements)
  const [view, setView] = useState<View>({ scrollX: 0, scrollY: 0, zoom: 1 })
  const viewRef = useRef(view)
  const [tool, setTool] = useState<Tool>('freedraw')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [style, setStyle] = useState<StyleValues>({
    strokeColor: STROKE_COLORS[0],
    backgroundColor: FILL_COLORS[0],
    strokeWidth: STROKE_WIDTHS[1],
  })
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [toast, setToast] = useState<ToastData | null>(null)
  const [dialog, setDialog] = useState<'mermaid' | 'share' | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [mermaidSource, setMermaidSource] = useState(MERMAID_EXAMPLE)
  const [mermaidError, setMermaidError] = useState('')
  const [presenting, setPresenting] = useState<number | null>(null)
  const [marquee, setMarquee] = useState<Bounds | undefined>()
  const [bindTargetId, setBindTargetId] = useState<string | undefined>()
  const [, setFontsReady] = useState(0)

  const interaction = useRef<Interaction>({ kind: 'none' })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<Pinch | null>(null)
  const snapshot = useRef<SkrawlElement[]>(elements)
  const past = useRef<SkrawlElement[][]>([])
  const future = useRef<SkrawlElement[][]>([])
  const lastPointer = useRef<Point>({ x: 0, y: 0 })
  const lastTap = useRef({ time: 0, x: 0, y: 0 })
  const clipboard = useRef<SkrawlElement[]>([])
  const animation = useRef(0)

  // --- scene & history -------------------------------------------------------

  const setScene = useCallback((next: SkrawlElement[]) => {
    const bound = updateBindings(next)
    elementsRef.current = bound
    setElements(bound)
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
    setSelectedIds([])
  }, [setScene])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(elementsRef.current)
    setScene(next)
    setSelectedIds([])
  }, [setScene])

  const toWorld = (clientX: number, clientY: number): Point => {
    const v = viewRef.current
    return { x: clientX / v.zoom - v.scrollX, y: clientY / v.zoom - v.scrollY }
  }

  const tolerance = () => 8 / viewRef.current.zoom

  const notify = useCallback((message: string, action?: ToastData['action']) => setToast({ message, action }), [])
  const dismissToast = useCallback(() => setToast(null), [])

  // --- view helpers ------------------------------------------------------------

  /** Smoothly zooms and scrolls so `b` fills the given screen area. */
  const fitTo = useCallback(
    (b: Bounds, opts: { padding?: number; bottomInset?: number; maxZoom?: number; animate?: boolean } = {}) => {
      const pad = opts.padding ?? 48
      const inset = opts.bottomInset ?? 0
      const w = window.innerWidth
      const h = window.innerHeight - inset
      const bw = Math.max(1, b.maxX - b.minX)
      const bh = Math.max(1, b.maxY - b.minY)
      const zoom = clamp(Math.min((w - pad * 2) / bw, (h - pad * 2) / bh), MIN_ZOOM, opts.maxZoom ?? MAX_ZOOM)
      const target = { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, zoom }
      const toView = (cx: number, cy: number, z: number): View => ({ zoom: z, scrollX: w / 2 / z - cx, scrollY: h / 2 / z - cy })
      cancelAnimationFrame(animation.current)
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      if (opts.animate === false || reduce) {
        updateView(toView(target.cx, target.cy, target.zoom))
        return
      }
      const from = viewRef.current
      const start = { cx: w / 2 / from.zoom - from.scrollX, cy: h / 2 / from.zoom - from.scrollY, zoom: from.zoom }
      const t0 = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / 380)
        const e = 1 - Math.pow(1 - t, 3)
        // Interpolate zoom in log space so zooming in and out feel equally fast.
        const z = Math.exp(Math.log(start.zoom) + (Math.log(target.zoom) - Math.log(start.zoom)) * e)
        updateView(toView(start.cx + (target.cx - start.cx) * e, start.cy + (target.cy - start.cy) * e, z))
        if (t < 1) animation.current = requestAnimationFrame(step)
      }
      animation.current = requestAnimationFrame(step)
    },
    [updateView],
  )

  const zoomBy = (factor: number) => {
    const v = viewRef.current
    const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    const cx = size.width / 2
    const cy = size.height / 2
    updateView({ zoom, scrollX: cx / zoom - (cx / v.zoom - v.scrollX), scrollY: cy / zoom - (cy / v.zoom - v.scrollY) })
  }

  const viewportCenter = (): Point => toWorld(window.innerWidth / 2, window.innerHeight / 2)

  // --- rendering ---------------------------------------------------------------

  const frames = elements.filter((el) => el.type === 'frame')
  const presentFrame = presenting !== null ? frames[presenting] : undefined

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
      selectedIds,
      editingId: editor?.id ?? undefined,
      bindTargetId,
      marquee,
      presentFrame: presentFrame && getBounds(presentFrame),
      showGrid: prefs.showGrid,
    })
  })

  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    // Text is measured and drawn with the web font, so redraw once it arrives.
    document.fonts?.ready.then(() => setFontsReady((n) => n + 1))
    if (laserCanvasRef.current) laser.current = new LaserTrail(laserCanvasRef.current)
    return () => {
      window.removeEventListener('resize', onResize)
      laser.current?.dispose()
    }
  }, [])

  useEffect(() => {
    // Saving on every pointer move would stall long drags, so wait for a pause.
    const timer = setTimeout(() => saveJson(STORAGE_KEY, elements), 300)
    return () => clearTimeout(timer)
  }, [elements])

  useEffect(() => {
    saveJson(PREFS_KEY, prefs)
    document.documentElement.dataset.theme = prefs.dark ? 'dark' : 'light'
  }, [prefs])

  // Open a drawing shared by link, on load or when a link is pasted into an open tab
  // (which only changes the hash). Undo brings back whatever was on the board before.
  const loadingShare = useRef(false)
  useEffect(() => {
    const open = () => {
      if (loadingShare.current || !hasSharedScene()) return
      loadingShare.current = true
      readSharedScene().then((shared) => {
        loadingShare.current = false
        clearSharedScene()
        if (!shared) {
          notify("That share link couldn't be opened. It may have been cut off when it was copied.")
          return
        }
        commit(shared)
        setSelectedIds([])
        setPresenting(null)
        const b = contentBounds(shared)
        if (b) fitTo(b, { maxZoom: 1, animate: false })
        notify('Opened a shared drawing. Undo to get your previous board back.')
      })
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [commit, fitTo, notify])

  // --- wheel: scroll to pan, ctrl/cmd + scroll (or trackpad pinch) to zoom ---------

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cancelAnimationFrame(animation.current)
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

  // --- selection actions ---------------------------------------------------------

  const selected = elements.filter((el) => selectedIds.includes(el.id))

  const select = (ids: string[]) => setSelectedIds(ids)

  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return
    commit(elementsRef.current.filter((el) => !selectedIds.includes(el.id)))
    setSelectedIds([])
  }, [commit, selectedIds])

  const copySelection = useCallback(() => {
    const ids = withFrameContents(elementsRef.current, selectedIds)
    const picked = elementsRef.current.filter((el) => ids.includes(el.id))
    if (picked.length === 0) return false
    clipboard.current = picked
    navigator.clipboard?.writeText(JSON.stringify({ type: 'skrawl', elements: picked })).catch(() => {
      // The in-app clipboard still works when the system clipboard is unavailable.
    })
    return true
  }, [selectedIds])

  const duplicate = useCallback(() => {
    const ids = withFrameContents(elementsRef.current, selectedIds)
    const picked = elementsRef.current.filter((el) => ids.includes(el.id))
    if (picked.length === 0) return
    const copies = cloneElements(picked, 20, 20)
    commit([...elementsRef.current, ...copies])
    setSelectedIds(copies.map((el) => el.id))
  }, [commit, selectedIds])

  const layer = useCallback(
    (move: LayerMove) => {
      if (selectedIds.length) commit(reorder(elementsRef.current, selectedIds, move))
    },
    [commit, selectedIds],
  )

  const nudge = useCallback(
    (dx: number, dy: number) => {
      const ids = new Set(withFrameContents(elementsRef.current, selectedIds))
      commit(elementsRef.current.map((el) => (ids.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el)))
    },
    [commit, selectedIds],
  )

  /** Adds elements centered on a point and selects them. */
  const insertAt = useCallback(
    (items: SkrawlElement[], at: Point) => {
      const settled = updateBindings(items)
      const b = contentBounds(settled)
      if (!b) return
      const placed = cloneElements(settled, at.x - (b.minX + b.maxX) / 2, at.y - (b.minY + b.maxY) / 2)
      commit([...elementsRef.current, ...placed])
      setSelectedIds(placed.map((el) => el.id))
      setTool('select')
      const pb = contentBounds(placed)!
      const v = viewRef.current
      // Zoom out only if the new content doesn't fit on screen.
      if ((pb.maxX - pb.minX) * v.zoom > window.innerWidth - 64 || (pb.maxY - pb.minY) * v.zoom > window.innerHeight - 160) {
        fitTo(pb, { bottomInset: 80 })
      }
    },
    [commit, fitTo],
  )

  const importMermaid = useCallback(
    (source: string) => {
      const result = mermaidToElements(source, style.strokeColor)
      if (result.error) return result.error
      insertAt(result.elements, viewportCenter())
      return ''
    },
    // viewportCenter reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [insertAt, style.strokeColor],
  )

  // --- text editing --------------------------------------------------------------

  const openEditor = useCallback((el: SkrawlElement | undefined, at: Point) => {
    setSelectedIds([])
    if (!el) {
      setEditor({ id: null, kind: 'text', x: at.x, y: at.y - (TEXT_SIZE * LINE_HEIGHT) / 2, value: '' })
    } else if (el.type === 'text') {
      setEditor({ id: el.id, kind: 'text', x: el.x, y: el.y, value: el.text ?? '' })
    } else if (el.type === 'frame') {
      setEditor({ id: el.id, kind: 'frame', x: el.x, y: el.y, value: el.name ?? '' })
    } else if (el.type !== 'freedraw') {
      setEditor({ id: el.id, kind: 'label', x: el.x, y: el.y, value: el.text ?? '' })
    }
  }, [])

  const commitText = () => {
    if (!editor) return
    const value = editor.value.replace(/\s+$/, '')
    const els = elementsRef.current
    const existing = els.find((el) => el.id === editor.id)
    setEditor(null)
    const replace = (el: SkrawlElement) => commit(els.map((e) => (e.id === el.id ? el : e)))

    if (editor.kind === 'frame' && existing) {
      if ((existing.name ?? '') !== value) replace({ ...existing, name: value || existing.name })
      return
    }
    if (editor.kind === 'label' && existing) {
      if ((existing.text ?? '') === value) return
      let next: SkrawlElement = { ...existing, text: value || undefined }
      if (existing.type === 'sticky') {
        // Notes grow to fit what's written on them.
        const block = textLayout(next)
        const needed = (block?.lines.length ?? 1) * STICKY_SIZE * LINE_HEIGHT + STICKY_PADDING * 2
        next = { ...next, height: Math.max(existing.height, needed) }
      }
      replace(next)
      return
    }
    if (!value) {
      if (existing) commit(els.filter((el) => el.id !== existing.id))
      return
    }
    const fontSize = existing?.fontSize ?? TEXT_SIZE
    const { width, height } = measureText(value, fontSize)
    if (existing) {
      if (existing.text !== value) replace({ ...existing, text: value, width, height })
      return
    }
    commit([
      ...els,
      {
        id: newId(),
        type: 'text',
        x: editor.x,
        y: editor.y,
        width,
        height,
        angle: 0,
        text: value,
        fontSize,
        strokeColor: style.strokeColor,
        backgroundColor: 'transparent',
        strokeWidth: style.strokeWidth,
        seed: randomSeed(),
      },
    ])
  }

  // --- presenting ------------------------------------------------------------------

  const startPresenting = () => {
    if (frames.length === 0) {
      notify('Draw a frame (F) around each slide first, then press Present.')
      setTool('frame')
      return
    }
    setSelectedIds([])
    setEditor(null)
    setPresenting(0)
  }

  const goToSlide = useCallback((i: number) => setPresenting((cur) => (cur === null ? cur : clamp(i, 0, frames.length - 1))), [frames.length])

  useEffect(() => {
    if (presenting === null) return
    if (!presentFrame) {
      setPresenting(frames.length ? frames.length - 1 : null)
      return
    }
    fitTo(getBounds(presentFrame), { padding: 24, bottomInset: 72 })
    // Refit when the slide or the window changes, not on every edit of the frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting, presentFrame?.id, size.width, size.height])

  // --- keyboard --------------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || dialog) return
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (presenting !== null) {
        if (['arrowright', 'arrowdown', ' ', 'pagedown', 'enter'].includes(key)) goToSlide(presenting + 1)
        else if (['arrowleft', 'arrowup', 'pageup', 'backspace'].includes(key)) goToSlide(presenting - 1)
        else if (key === 'escape') setPresenting(null)
        else return
        e.preventDefault()
        return
      }

      if (mod && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && key === 'y') {
        e.preventDefault()
        redo()
      } else if (mod && key === 'a') {
        e.preventDefault()
        setTool('select')
        setSelectedIds(elementsRef.current.map((el) => el.id))
      } else if (mod && (key === 'c' || key === 'x')) {
        if (copySelection() && key === 'x') deleteSelected()
      } else if (mod && key === 'd') {
        e.preventDefault()
        duplicate()
      } else if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault()
        const up = e.code === 'BracketRight'
        layer(e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward')
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      } else if (e.key.startsWith('Arrow') && selectedIds.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key]
        if (d) nudge(d[0], d[1])
      } else if (e.key === 'Enter' && selectedIds.length === 1) {
        e.preventDefault()
        const el = elementsRef.current.find((x) => x.id === selectedIds[0])
        if (el) openEditor(el, center(el))
      } else if (e.key === ' ') {
        e.preventDefault()
        setSpaceHeld(true)
      } else if (e.key === 'Escape') {
        setSelectedIds([])
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
  }, [copySelection, deleteSelected, dialog, duplicate, goToSlide, layer, nudge, openEditor, presenting, redo, selectedIds, undo])

  // Paste Skrawl shapes, a Mermaid flowchart, or plain text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || dialog || presenting !== null) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      let items: SkrawlElement[] | null = null
      try {
        const data = JSON.parse(text)
        if (data?.type === 'skrawl') items = restoreElements(data.elements)
      } catch {
        // Not Skrawl data; handled as text below.
      }
      if (!items && !text && clipboard.current.length) items = clipboard.current
      e.preventDefault()
      if (items?.length) {
        insertAt(items, lastPointer.current)
      } else if (/^\s*(flowchart|graph)\b/i.test(text)) {
        const error = importMermaid(text)
        if (error) notify(error)
      } else if (text.trim()) {
        const value = text.trim()
        const { width, height } = measureText(value, TEXT_SIZE)
        const at = lastPointer.current
        insertAt(
          [
            {
              id: newId(),
              type: 'text',
              x: at.x,
              y: at.y,
              width,
              height,
              angle: 0,
              text: value,
              fontSize: TEXT_SIZE,
              strokeColor: style.strokeColor,
              backgroundColor: 'transparent',
              strokeWidth: style.strokeWidth,
              seed: randomSeed(),
            },
          ],
          at,
        )
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [dialog, importMermaid, insertAt, notify, presenting, style.strokeColor, style.strokeWidth])

  // --- pointer -------------------------------------------------------------------

  const newElement = (type: ElementType, at: Point, extra: Partial<SkrawlElement> = {}): SkrawlElement => ({
    id: newId(),
    type,
    x: at.x,
    y: at.y,
    width: 0,
    height: 0,
    angle: 0,
    strokeColor: style.strokeColor,
    backgroundColor: style.backgroundColor,
    strokeWidth: style.strokeWidth,
    seed: randomSeed(),
    ...extra,
  })

  const bindTargetAt = (world: Point, arrowId: string) =>
    elementAt(elementsRef.current, world, tolerance(), (el) => canBindTo(el, arrowId))

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (editor) return // the textarea's blur commits it
    cancelAnimationFrame(animation.current)
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size >= 2) {
      // A second finger turns the gesture into pinch-zoom: undo whatever the first finger started.
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()]
        setScene(snapshot.current)
        interaction.current = { kind: 'none' }
        setMarquee(undefined)
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          midX: (a.x + b.x) / 2,
          midY: (a.y + b.y) / 2,
          view: viewRef.current,
        }
      }
      return
    }

    const world = toWorld(e.clientX, e.clientY)
    lastPointer.current = world
    snapshot.current = elementsRef.current
    const els = elementsRef.current

    if (presenting !== null || tool === 'laser') {
      laser.current?.begin(e.clientX, e.clientY)
      interaction.current = { kind: 'laser' }
      return
    }
    if (tool === 'hand' || spaceHeld || e.button === 1) {
      const v = viewRef.current
      interaction.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, scrollX: v.scrollX, scrollY: v.scrollY }
      return
    }

    // Double-click / double-tap edits text. Detected here so it works the same for touch and mouse.
    const now = performance.now()
    const tap = lastTap.current
    const isDouble = now - tap.time < DOUBLE_TAP_MS && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12
    lastTap.current = { time: isDouble ? 0 : now, x: e.clientX, y: e.clientY }
    if (isDouble && tool === 'select') {
      const hit = elementAt(els, world, tolerance())
      if (!hit || hit.type !== 'freedraw') {
        e.preventDefault()
        openEditor(hit, world)
        interaction.current = { kind: 'none' }
        return
      }
    }

    switch (tool) {
      case 'select': {
        const zoom = viewRef.current.zoom
        if (selected.length === 1) {
          const reach = (e.pointerType === 'touch' ? 16 : 9) / zoom
          const handle = getHandles(selected[0], zoom).find((hd) => Math.hypot(hd.x - world.x, hd.y - world.y) <= reach)
          if (handle) {
            const orig = selected[0]
            if (handle.id === 'rotate') interaction.current = { kind: 'rotate', orig, start: world }
            else if (handle.id === 'start' || handle.id === 'end') interaction.current = { kind: 'endpoint', id: orig.id, which: handle.id }
            else interaction.current = { kind: 'resize', orig, handle: handle.id }
            return
          }
        }
        const hit = elementAt(els, world, tolerance())
        if (!hit) {
          const base = e.shiftKey ? selectedIds : []
          select(base)
          interaction.current = { kind: 'marquee', start: world, base }
          return
        }
        let ids = selectedIds
        if (e.shiftKey) {
          ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id]
        } else if (!ids.includes(hit.id)) {
          ids = [hit.id]
        }
        select(ids)
        if (!ids.includes(hit.id)) {
          interaction.current = { kind: 'none' }
          return
        }
        const moving = withFrameContents(els, ids)
        interaction.current = { kind: 'move', start: world, origins: new Map(els.filter((el) => moving.includes(el.id)).map((el) => [el.id, el])) }
        return
      }
      case 'eraser': {
        interaction.current = { kind: 'erase' }
        const hit = elementAt(els, world, tolerance())
        if (hit) setScene(els.filter((el) => el.id !== hit.id))
        return
      }
      case 'text':
        e.preventDefault()
        openEditor(undefined, world)
        setTool('select')
        return
      case 'sticky': {
        e.preventDefault()
        const note = newElement('sticky', { x: world.x - 100, y: world.y - 100 }, {
          width: 200,
          height: 200,
          backgroundColor: style.backgroundColor === 'transparent' ? STICKY_DEFAULT : style.backgroundColor,
        })
        commit([...els, note])
        setTool('select')
        openEditor(note, world)
        return
      }
      default: {
        const type = tool as ElementType
        const extra: Partial<SkrawlElement> = {}
        if (type === 'freedraw') extra.points = [[0, 0]]
        if (type === 'frame') {
          extra.name = `Slide ${frames.length + 1}`
          extra.backgroundColor = 'transparent'
        }
        if (type === 'arrow' || type === 'line') {
          const target = bindTargetAt(world, '')
          if (target) extra.startBinding = { elementId: target.id }
        }
        const el = newElement(type, world, extra)
        select([])
        setScene([...els, el])
        interaction.current = { kind: 'create', id: el.id }
      }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinch.current
    if (p && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const zoom = clamp(p.view.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist), MIN_ZOOM, MAX_ZOOM)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      // Keep the world point that was under the fingers' midpoint under it as they move.
      const wx = p.midX / p.view.zoom - p.view.scrollX
      const wy = p.midY / p.view.zoom - p.view.scrollY
      updateView({ zoom, scrollX: midX / zoom - wx, scrollY: midY / zoom - wy })
      return
    }
    const world = toWorld(e.clientX, e.clientY)
    lastPointer.current = world
    const action = interaction.current
    const els = elementsRef.current
    const replace = (el: SkrawlElement) => setScene(els.map((x) => (x.id === el.id ? el : x)))

    switch (action.kind) {
      case 'none':
        return
      case 'laser':
        laser.current?.add(e.clientX, e.clientY)
        return
      case 'pan': {
        const v = viewRef.current
        updateView({
          ...v,
          scrollX: action.scrollX + (e.clientX - action.startX) / v.zoom,
          scrollY: action.scrollY + (e.clientY - action.startY) / v.zoom,
        })
        return
      }
      case 'erase': {
        const hit = elementAt(els, world, tolerance())
        if (hit) setScene(els.filter((el) => el.id !== hit.id))
        return
      }
      case 'marquee': {
        const m = {
          minX: Math.min(action.start.x, world.x),
          minY: Math.min(action.start.y, world.y),
          maxX: Math.max(action.start.x, world.x),
          maxY: Math.max(action.start.y, world.y),
        }
        setMarquee(m)
        const inside = els
          .filter((el) => {
            const b = getBounds(el)
            return b.minX >= m.minX && b.maxX <= m.maxX && b.minY >= m.minY && b.maxY <= m.maxY
          })
          .map((el) => el.id)
        select([...new Set([...action.base, ...inside])])
        return
      }
      case 'move': {
        const dx = world.x - action.start.x
        const dy = world.y - action.start.y
        setScene(
          els.map((el) => {
            const orig = action.origins.get(el.id)
            if (!orig) return el
            const moved = { ...orig, x: orig.x + dx, y: orig.y + dy }
            // An arrow dragged away from a shape that isn't moving with it comes unstuck.
            if (isLinear(orig)) {
              if (orig.startBinding && !action.origins.has(orig.startBinding.elementId)) moved.startBinding = null
              if (orig.endBinding && !action.origins.has(orig.endBinding.elementId)) moved.endBinding = null
            }
            return moved
          }),
        )
        return
      }
      case 'resize':
        replace(resizeElement(action.orig, action.handle, world, e.shiftKey))
        return
      case 'rotate':
        replace(rotateElement(action.orig, action.start, world, e.shiftKey))
        return
      case 'endpoint': {
        const el = els.find((x) => x.id === action.id)
        if (!el) return
        const target = bindTargetAt(world, el.id)
        setBindTargetId(target?.id)
        const binding = target ? { elementId: target.id } : null
        if (action.which === 'end') {
          replace({ ...el, width: world.x - el.x, height: world.y - el.y, endBinding: binding })
        } else {
          const end = { x: el.x + el.width, y: el.y + el.height }
          replace({ ...el, x: world.x, y: world.y, width: end.x - world.x, height: end.y - world.y, startBinding: binding })
        }
        return
      }
      case 'create': {
        const el = els.find((x) => x.id === action.id)
        if (!el) return
        if (el.type === 'freedraw') {
          replace({ ...el, points: [...(el.points ?? []), [world.x - el.x, world.y - el.y]] })
          return
        }
        let width = world.x - el.x
        let height = world.y - el.y
        if (isLinear(el)) {
          if (e.shiftKey) {
            // Shift snaps lines and arrows to 15° steps.
            const len = Math.hypot(width, height)
            const angle = Math.round(Math.atan2(height, width) / (Math.PI / 12)) * (Math.PI / 12)
            width = len * Math.cos(angle)
            height = len * Math.sin(angle)
          }
          const target = bindTargetAt(world, el.id)
          setBindTargetId(target?.id)
          replace({ ...el, width, height, endBinding: target ? { elementId: target.id } : null })
          return
        }
        if (e.shiftKey) {
          // Shift draws squares and circles.
          const side = Math.max(Math.abs(width), Math.abs(height))
          width = Math.sign(width || 1) * side
          height = Math.sign(height || 1) * side
        }
        replace({ ...el, width, height })
      }
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId)
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null
      return
    }
    const action = interaction.current
    interaction.current = { kind: 'none' }
    setBindTargetId(undefined)
    setMarquee(undefined)

    if (action.kind === 'create') {
      const els = elementsRef.current
      const el = els.find((x) => x.id === action.id)
      if (!el) return
      let done: SkrawlElement | null = el
      if (el.type === 'freedraw') {
        done = normalizeFreedraw(el)
      } else if (isLinear(el)) {
        if (Math.hypot(el.width, el.height) < 4) done = null
      } else {
        done = normalizeBox(el)
        // A click without a drag shouldn't leave an invisible shape behind.
        if (done.width < 4 && done.height < 4) done = null
      }
      const rest = els.filter((x) => x.id !== el.id)
      if (!done) {
        setScene(rest)
        return
      }
      const kind = done.type === 'freedraw' && prefs.autoShapes ? recognizeStroke(done) : null
      if (kind && done.type === 'freedraw') {
        const sketch = done
        const shape = toShape(sketch, kind, style.backgroundColor)
        setScene(els.map((x) => (x.id === el.id ? shape : x)))
        notify(`Turned into ${kind === 'ellipse' ? 'an ellipse' : `a ${kind}`}`, {
          label: 'Keep sketch',
          onClick: () => setScene(elementsRef.current.map((x) => (x.id === shape.id ? sketch : x))),
        })
      } else {
        setScene(els.map((x) => (x.id === el.id ? done! : x)))
      }
      if (SELECT_AFTER.includes(tool)) {
        setTool('select')
        select([done.id])
      }
    }
    pushHistory(snapshot.current)
  }

  // --- style panel ---------------------------------------------------------------

  const styled = selected.filter((el) => el.type !== 'frame')
  const current: StyleValues = styled[0]
    ? { strokeColor: styled[0].strokeColor, backgroundColor: styled[0].backgroundColor, strokeWidth: styled[0].strokeWidth }
    : style
  const solidFill = tool === 'sticky' || (styled.length > 0 && styled.every((el) => el.type === 'sticky'))

  const applyStyle = (patch: Partial<StyleValues>) => {
    setStyle((s) => ({ ...s, ...patch }))
    if (styled.length === 0) return
    const ids = new Set(styled.map((el) => el.id))
    commit(
      elementsRef.current.map((el) => {
        if (!ids.has(el.id)) return el
        // Sticky notes always keep their paper color.
        if (el.type === 'sticky' && patch.backgroundColor === 'transparent') return { ...el, ...patch, backgroundColor: el.backgroundColor }
        return { ...el, ...patch }
      }),
    )
  }

  const showStylePanel = presenting === null && !editor && (DRAWING_TOOLS.includes(tool) || selected.length > 0)

  // --- menu actions ----------------------------------------------------------------

  const exportPng = () => {
    exportToCanvas(elementsRef.current).toBlob((blob) => blob && download('skrawl.png', blob))
  }

  const exportSvg = () => {
    const svg = exportToSvg(elementsRef.current)
    if (svg) download('skrawl.svg', new Blob([svg], { type: 'image/svg+xml' }))
  }

  const share = async () => {
    try {
      setShareUrl(await createShareLink(elementsRef.current))
      setDialog('share')
    } catch {
      notify("This browser can't make share links. Try a recent Chrome, Edge, Firefox or Safari.")
    }
  }

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      notify('Link copied')
      setDialog(null)
    } catch {
      ;(document.getElementById('share-url') as HTMLInputElement | null)?.select()
      notify('Select the link and copy it')
    }
  }

  // Two-step clear: the first tap arms it, a second tap within 3 seconds clears.
  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 3000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const clearCanvas = () => {
    if (elementsRef.current.length === 0) return
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setConfirmClear(false)
    commit([])
    setSelectedIds([])
    notify('Canvas cleared', { label: 'Undo', onClick: undo })
  }

  const empty = elements.length === 0

  // --- text editor placement -------------------------------------------------------

  const editorStyle = (): CSSProperties | null => {
    if (!editor) return null
    const el = elements.find((x) => x.id === editor.id)
    const { zoom, scrollX, scrollY } = view
    const sx = (x: number) => (x + scrollX) * zoom
    const sy = (y: number) => (y + scrollY) * zoom
    const rotation = el?.angle ? `rotate(${el.angle}rad)` : ''
    if (editor.kind === 'frame' && el) {
      return { left: sx(el.x), top: sy(el.y) - 26, width: 220, height: 22, fontSize: 13, fontFamily: UI_FONT, lineHeight: '22px' }
    }
    if (editor.kind === 'text') {
      const fs = el?.fontSize ?? TEXT_SIZE
      const m = measureText(editor.value || ' ', fs)
      const x = el?.x ?? editor.x
      const y = el?.y ?? editor.y
      return {
        left: sx(x),
        top: sy(y),
        width: (m.width + fs) * zoom,
        height: m.height * zoom,
        fontSize: fs * zoom,
        transform: rotation,
        transformOrigin: el ? `${(el.width * zoom) / 2}px ${(el.height * zoom) / 2}px` : undefined,
        color: el?.strokeColor ?? style.strokeColor,
      }
    }
    if (!el) return null
    if (el.type === 'sticky') {
      const pad = STICKY_PADDING
      return {
        left: sx(el.x + pad),
        top: sy(el.y + pad),
        width: (el.width - pad * 2) * zoom,
        height: Math.max(el.height - pad * 2, (textLayout(el, editor.value)?.lines.length ?? 1) * STICKY_SIZE * LINE_HEIGHT) * zoom,
        fontSize: STICKY_SIZE * zoom,
        whiteSpace: 'pre-wrap',
        transform: rotation,
        transformOrigin: `${(el.width / 2 - pad) * zoom}px ${(el.height / 2 - pad) * zoom}px`,
        color: el.strokeColor,
      }
    }
    // Centered label on a shape or line.
    const block = textLayout(el, editor.value || ' ')!
    const lines = block.lines.length
    const width = hasCenteredLabel(el) ? labelWidth(el) : Math.max(60, measureText(editor.value || ' ', block.size).width + block.size)
    const height = lines * block.size * LINE_HEIGHT
    const c = isLinear(el) ? { x: el.x + el.width / 2, y: el.y + el.height / 2 } : center(el)
    return {
      left: sx(c.x) - (width * zoom) / 2,
      top: sy(c.y) - (height * zoom) / 2,
      width: width * zoom,
      height: height * zoom,
      fontSize: block.size * zoom,
      textAlign: 'center',
      whiteSpace: 'pre-wrap',
      transform: rotation,
      color: el.strokeColor,
    }
  }
  const editorCss = editorStyle()

  const cursor =
    presenting !== null || tool === 'laser'
      ? 'crosshair'
      : tool === 'hand' || spaceHeld
        ? 'grab'
        : tool === 'select'
          ? 'default'
          : tool === 'text'
            ? 'text'
            : 'crosshair'

  return (
    <div className={`app ${presenting !== null ? 'presenting' : ''}`}>
      <canvas
        ref={canvasRef}
        className="board"
        style={{ width: size.width, height: size.height, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas ref={laserCanvasRef} className="laser" aria-hidden="true" />

      {presenting === null ? (
        <>
          <Toolbar tool={tool} onSelect={setTool} />
          <TopMenu
            primary={[
              { label: 'Present', onClick: startPresenting, hint: 'Show your frames as slides' },
              { label: 'Share', onClick: share, disabled: empty, hint: 'Copy a link to this drawing' },
            ]}
            items={[
              { label: 'Import Mermaid…', onClick: () => setDialog('mermaid') },
              ...(CAN_DOWNLOAD
                ? [
                    { label: 'Export PNG', onClick: exportPng, disabled: empty },
                    { label: 'Export SVG', onClick: exportSvg, disabled: empty },
                  ]
                : []),
              { label: 'Zoom to fit', onClick: () => !empty && fitTo(contentBounds(elements)!, { maxZoom: 2 }), disabled: empty },
              { label: prefs.dark ? 'Light mode' : 'Dark mode', onClick: () => setPrefs((p) => ({ ...p, dark: !p.dark })) },
              { label: prefs.showGrid ? 'Hide grid' : 'Show grid', onClick: () => setPrefs((p) => ({ ...p, showGrid: !p.showGrid })) },
              { label: confirmClear ? 'Tap again to clear' : 'Clear canvas', onClick: clearCanvas, danger: true, disabled: empty },
            ]}
          />
          {showStylePanel && (
            <StylePanel
              style={current}
              onStyle={applyStyle}
              solidFill={solidFill}
              selectionCount={selected.length}
              onDuplicate={duplicate}
              onDelete={deleteSelected}
              onLayer={layer}
              autoShapes={tool === 'freedraw' ? { on: prefs.autoShapes, toggle: () => setPrefs((p) => ({ ...p, autoShapes: !p.autoShapes })) } : undefined}
            />
          )}
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
        </>
      ) : (
        presentFrame && (
          <PresentBar
            index={presenting}
            count={frames.length}
            title={presentFrame.name || `Slide ${presenting + 1}`}
            onPrev={() => goToSlide(presenting - 1)}
            onNext={() => goToSlide(presenting + 1)}
            onExit={() => setPresenting(null)}
          />
        )
      )}

      {empty && !editor && (
        <div className="welcome">
          <h1>Skrawl</h1>
          <p>Pick a tool and start sketching. Draw a rough circle or box with the pen and it snaps into shape.</p>
          <p className="welcome-hint">Scroll or use the hand to pan · Ctrl + scroll or pinch to zoom · Double-click to write</p>
        </div>
      )}

      {editor && editorCss && (
        <textarea
          className={`text-editor ${editor.kind === 'frame' ? 'frame-name' : ''}`}
          autoFocus
          id="text-editor"
          aria-label={editor.kind === 'frame' ? 'Frame name' : 'Text'}
          value={editor.value}
          spellCheck={editor.kind !== 'frame'}
          style={{ ...editorCss, fontFamily: editorCss.fontFamily ?? HAND_FONT, lineHeight: editorCss.lineHeight ?? LINE_HEIGHT }}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setEditor({ ...editor, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            const enterCommits = editor.kind === 'frame' ? e.key === 'Enter' : e.key === 'Enter' && (e.ctrlKey || e.metaKey)
            if (e.key === 'Escape' || enterCommits) {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
      )}

      {dialog === 'mermaid' && (
        <Dialog title="Import a Mermaid flowchart" onClose={() => setDialog(null)}>
          <p className="dialog-text">
            Paste a <code>flowchart</code> or <code>graph</code> diagram. Boxes, diamonds, circles and labeled arrows come
            in as sketched shapes you can keep editing. You can also paste one straight onto the canvas.
          </p>
          <textarea
            id="mermaid-source"
            className="code-input"
            value={mermaidSource}
            onChange={(e) => {
              setMermaidSource(e.target.value)
              setMermaidError('')
            }}
            rows={9}
            spellCheck={false}
          />
          {mermaidError && <p className="dialog-error">{mermaidError}</p>}
          <div className="dialog-actions">
            <button className="text-btn" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="solid-btn"
              onClick={() => {
                const error = importMermaid(mermaidSource)
                if (error) setMermaidError(error)
                else setDialog(null)
              }}
            >
              Insert
            </button>
          </div>
        </Dialog>
      )}

      {dialog === 'share' && (
        <Dialog title="Share this drawing" onClose={() => setDialog(null)}>
          <p className="dialog-text">
            Anyone with this link sees a copy of the drawing as it is now. The drawing lives inside the link itself, so
            nothing is uploaded anywhere.
          </p>
          <input id="share-url" className="code-input" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          <p className="dialog-meta">{shareUrl.length.toLocaleString()} characters</p>
          <div className="dialog-actions">
            <button className="solid-btn" onClick={copyShareUrl}>
              Copy link
            </button>
          </div>
        </Dialog>
      )}

      <Toast toast={toast} onDone={dismissToast} />
    </div>
  )
}


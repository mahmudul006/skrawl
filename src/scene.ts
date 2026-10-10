import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import type { Drawable, Options } from 'roughjs/bin/core'
import type { Bounds, SkrawlElement, View } from './types'

export const FONT_SIZE = 28
export const LINE_HEIGHT = 1.2
export const FONT = `500 ${FONT_SIZE}px "Caveat", "Comic Sans MS", cursive`
export const SELECTION_COLOR = '#6965db'
const GRID_SIZE = 20

const generator = rough.generator()
// Elements are immutable, so a WeakMap keyed by element is a safe render cache.
const drawableCache = new WeakMap<SkrawlElement, Drawable[]>()

export const randomSeed = () => Math.floor(Math.random() * 2 ** 31)
export const newId = () => Math.random().toString(36).slice(2, 10)

function roughOptions(el: SkrawlElement): Options {
  return {
    seed: el.seed,
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    roughness: 1.2,
    fill: el.backgroundColor === 'transparent' ? undefined : el.backgroundColor,
    fillStyle: 'hachure',
    fillWeight: el.strokeWidth / 2,
  }
}

function drawablesFor(el: SkrawlElement): Drawable[] {
  const cached = drawableCache.get(el)
  if (cached) return cached
  const o = roughOptions(el)
  let drawables: Drawable[] = []
  switch (el.type) {
    case 'rectangle':
      drawables = [generator.rectangle(el.x, el.y, el.width, el.height, o)]
      break
    case 'ellipse':
      drawables = [generator.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width, el.height, o)]
      break
    case 'line':
      drawables = [generator.line(el.x, el.y, el.x + el.width, el.y + el.height, o)]
      break
    case 'arrow': {
      const x2 = el.x + el.width
      const y2 = el.y + el.height
      const angle = Math.atan2(el.height, el.width)
      const len = Math.min(24, Math.hypot(el.width, el.height) / 3)
      const head = (spread: number) =>
        generator.line(x2, y2, x2 - len * Math.cos(angle - spread), y2 - len * Math.sin(angle - spread), o)
      drawables = [generator.line(el.x, el.y, x2, y2, o), head(0.45), head(-0.45)]
      break
    }
  }
  drawableCache.set(el, drawables)
  return drawables
}

function drawFreedraw(ctx: CanvasRenderingContext2D, el: SkrawlElement) {
  const pts = el.points ?? []
  if (pts.length === 0) return
  ctx.save()
  ctx.strokeStyle = el.strokeColor
  ctx.fillStyle = el.strokeColor
  ctx.lineWidth = el.strokeWidth + 1
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (pts.length === 1) {
    ctx.beginPath()
    ctx.arc(el.x + pts[0][0], el.y + pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    // Quadratic curves through segment midpoints smooth out pointer jitter.
    ctx.beginPath()
    ctx.moveTo(el.x + pts[0][0], el.y + pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(el.x + pts[i][0], el.y + pts[i][1], el.x + mx, el.y + my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(el.x + last[0], el.y + last[1])
    ctx.stroke()
  }
  ctx.restore()
}

function drawText(ctx: CanvasRenderingContext2D, el: SkrawlElement) {
  ctx.save()
  ctx.font = FONT
  ctx.fillStyle = el.strokeColor
  ctx.textBaseline = 'top'
  ;(el.text ?? '').split('\n').forEach((line, i) => {
    ctx.fillText(line, el.x, el.y + i * FONT_SIZE * LINE_HEIGHT)
  })
  ctx.restore()
}

export function drawElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: SkrawlElement) {
  if (el.type === 'freedraw') drawFreedraw(ctx, el)
  else if (el.type === 'text') drawText(ctx, el)
  else drawablesFor(el).forEach((d) => rc.draw(d))
}

export function getBounds(el: SkrawlElement): Bounds {
  if (el.type === 'freedraw') {
    const pts = el.points ?? [[0, 0]]
    const xs = pts.map((p) => el.x + p[0])
    const ys = pts.map((p) => el.y + p[1])
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }
  return {
    minX: Math.min(el.x, el.x + el.width),
    minY: Math.min(el.y, el.y + el.height),
    maxX: Math.max(el.x, el.x + el.width),
    maxY: Math.max(el.y, el.y + el.height),
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function hitTest(el: SkrawlElement, x: number, y: number, tolerance: number): boolean {
  const b = getBounds(el)
  switch (el.type) {
    case 'rectangle':
    case 'text':
      return x >= b.minX - tolerance && x <= b.maxX + tolerance && y >= b.minY - tolerance && y <= b.maxY + tolerance
    case 'ellipse': {
      const rx = (b.maxX - b.minX) / 2 + tolerance
      const ry = (b.maxY - b.minY) / 2 + tolerance
      const nx = (x - (b.minX + b.maxX) / 2) / rx
      const ny = (y - (b.minY + b.maxY) / 2) / ry
      return nx * nx + ny * ny <= 1
    }
    case 'line':
    case 'arrow':
      return distToSegment(x, y, el.x, el.y, el.x + el.width, el.y + el.height) <= tolerance
    case 'freedraw': {
      const pts = el.points ?? []
      if (pts.length === 1) return Math.hypot(x - el.x - pts[0][0], y - el.y - pts[0][1]) <= tolerance
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        if (distToSegment(x, y, el.x + ax, el.y + ay, el.x + bx, el.y + by) <= tolerance) return true
      }
      return false
    }
  }
}

/** Topmost element under the point, if any. */
export function elementAt(elements: SkrawlElement[], x: number, y: number, tolerance: number) {
  for (let i = elements.length - 1; i >= 0; i--) {
    if (hitTest(elements[i], x, y, tolerance)) return elements[i]
  }
  return undefined
}

/** Flip negative sizes so boxes always grow down-right from (x, y). */
export function normalize(el: SkrawlElement): SkrawlElement {
  if (el.type !== 'rectangle' && el.type !== 'ellipse') return el
  if (el.width >= 0 && el.height >= 0) return el
  const b = getBounds(el)
  return { ...el, x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY }
}

let measureCtx: CanvasRenderingContext2D | null = null
export function measureText(text: string) {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  measureCtx.font = FONT
  const lines = text.split('\n')
  const width = Math.max(...lines.map((l) => measureCtx!.measureText(l).width))
  return { width, height: lines.length * FONT_SIZE * LINE_HEIGHT }
}

interface RenderOptions {
  width: number
  height: number
  dpr: number
  view: View
  selectedId: string | null
  hiddenId?: string
  showGrid: boolean
}

export function renderScene(canvas: HTMLCanvasElement, elements: SkrawlElement[], opts: RenderOptions) {
  const ctx = canvas.getContext('2d')!
  const rc = rough.canvas(canvas)
  const { view, dpr } = opts
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const scale = dpr * view.zoom
  ctx.setTransform(scale, 0, 0, scale, scale * view.scrollX, scale * view.scrollY)

  if (opts.showGrid && view.zoom >= 0.4) {
    const x0 = -view.scrollX
    const y0 = -view.scrollY
    const x1 = x0 + opts.width / view.zoom
    const y1 = y0 + opts.height / view.zoom
    const dot = 1.5 / view.zoom
    ctx.fillStyle = '#d0d0d8'
    for (let x = Math.floor(x0 / GRID_SIZE) * GRID_SIZE; x < x1; x += GRID_SIZE) {
      for (let y = Math.floor(y0 / GRID_SIZE) * GRID_SIZE; y < y1; y += GRID_SIZE) {
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot)
      }
    }
  }

  for (const el of elements) {
    if (el.id !== opts.hiddenId) drawElement(ctx, rc, el)
  }

  const selected = elements.find((el) => el.id === opts.selectedId)
  if (selected) {
    const b = getBounds(selected)
    const pad = 6 / view.zoom
    ctx.save()
    ctx.strokeStyle = SELECTION_COLOR
    ctx.lineWidth = 1 / view.zoom
    ctx.setLineDash([6 / view.zoom, 4 / view.zoom])
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2)
    ctx.restore()
  }
}

/** Renders every element onto a white canvas cropped to the drawing. */
export function exportToCanvas(elements: SkrawlElement[], padding = 24, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  if (elements.length === 0) return canvas
  const bounds = elements.map(getBounds)
  const minX = Math.min(...bounds.map((b) => b.minX)) - padding
  const minY = Math.min(...bounds.map((b) => b.minY)) - padding
  const maxX = Math.max(...bounds.map((b) => b.maxX)) + padding
  const maxY = Math.max(...bounds.map((b) => b.maxY)) + padding
  canvas.width = Math.ceil((maxX - minX) * scale)
  canvas.height = Math.ceil((maxY - minY) * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale)
  const rc = rough.canvas(canvas)
  elements.forEach((el) => drawElement(ctx, rc, el))
  return canvas
}

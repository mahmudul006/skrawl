import rough from 'roughjs'
import type { RoughCanvas } from 'roughjs/bin/canvas'
import type { Drawable, Options } from 'roughjs/bin/core'
import { canRotate, center, corners, endPoint, getBounds, isLinear, rotate, startPoint, unionBounds } from './geometry'
import {
  LABEL_SIZE,
  LINE_HEIGHT,
  STICKY_PADDING,
  STICKY_SIZE,
  TEXT_SIZE,
  UI_FONT,
  handFont,
  wrapText,
} from './text'
import type { Bounds, SkrawlElement, View } from './types'

export const SELECTION_COLOR = '#6965db'
/** The canvas is always painted light; dark mode inverts it with a CSS filter. */
export const CANVAS_BG = '#ffffff'
const FRAME_COLOR = '#9a9aa6'
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
  const { x, y, width: w, height: h } = el
  let drawables: Drawable[] = []
  switch (el.type) {
    case 'rectangle':
      drawables = [generator.rectangle(x, y, w, h, o)]
      break
    case 'ellipse':
      drawables = [generator.ellipse(x + w / 2, y + h / 2, w, h, o)]
      break
    case 'diamond':
      drawables = [
        generator.polygon(
          [
            [x + w / 2, y],
            [x + w, y + h / 2],
            [x + w / 2, y + h],
            [x, y + h / 2],
          ],
          o,
        ),
      ]
      break
    case 'line':
      drawables = [generator.line(x, y, x + w, y + h, o)]
      break
    case 'arrow': {
      const x2 = x + w
      const y2 = y + h
      const angle = Math.atan2(h, w)
      const len = Math.min(24, Math.hypot(w, h) / 3)
      const head = (spread: number) =>
        generator.line(x2, y2, x2 - len * Math.cos(angle - spread), y2 - len * Math.sin(angle - spread), o)
      drawables = [generator.line(x, y, x2, y2, o), head(0.45), head(-0.45)]
      break
    }
  }
  drawableCache.set(el, drawables)
  return drawables
}

/** Smooth SVG/canvas path through freedraw points, using midpoints as curve ends. */
export function freedrawPath(el: SkrawlElement): string {
  const pts = (el.points ?? []).map(([px, py]) => [el.x + px, el.y + py])
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0][0]} ${pts[0][1]} L${pts[0][0] + 0.1} ${pts[0][1]}`
  let d = `M${pts[0][0]} ${pts[0][1]}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`
  }
  const last = pts[pts.length - 1]
  return d + ` L${last[0]} ${last[1]}`
}

/** Width available to a shape's centered label. */
export function labelWidth(el: SkrawlElement) {
  if (el.type === 'rectangle') return Math.max(20, el.width - 20)
  return Math.max(20, el.width * 0.68)
}

export interface TextBlock {
  lines: string[]
  size: number
  /** Top-left of the first line and the alignment to draw with. */
  x: number
  y: number
  align: 'left' | 'center'
}

/** Where an element's text goes, shared by canvas, SVG and the in-place editor. */
export function textLayout(el: SkrawlElement, text = el.text ?? ''): TextBlock | null {
  switch (el.type) {
    case 'text': {
      const size = el.fontSize ?? TEXT_SIZE
      return { lines: text.split('\n'), size, x: el.x, y: el.y, align: 'left' }
    }
    case 'sticky': {
      const lines = wrapText(text, STICKY_SIZE, el.width - STICKY_PADDING * 2)
      return { lines, size: STICKY_SIZE, x: el.x + STICKY_PADDING, y: el.y + STICKY_PADDING, align: 'left' }
    }
    case 'rectangle':
    case 'ellipse':
    case 'diamond': {
      const lines = wrapText(text, LABEL_SIZE, labelWidth(el))
      const h = lines.length * LABEL_SIZE * LINE_HEIGHT
      return { lines, size: LABEL_SIZE, x: el.x + el.width / 2, y: el.y + el.height / 2 - h / 2, align: 'center' }
    }
    case 'line':
    case 'arrow': {
      const lines = text.split('\n')
      const h = lines.length * LABEL_SIZE * LINE_HEIGHT
      return { lines, size: LABEL_SIZE, x: el.x + el.width / 2, y: el.y + el.height / 2 - h / 2, align: 'center' }
    }
    default:
      return null
  }
}

function drawTextBlock(ctx: CanvasRenderingContext2D, block: TextBlock, color: string, background?: string) {
  ctx.save()
  ctx.font = handFont(block.size)
  ctx.textBaseline = 'top'
  ctx.textAlign = block.align
  const lh = block.size * LINE_HEIGHT
  if (background) {
    const w = Math.max(...block.lines.map((l) => ctx.measureText(l).width))
    ctx.fillStyle = background
    ctx.fillRect(block.x - w / 2 - 6, block.y - 2, w + 12, block.lines.length * lh + 4)
  }
  ctx.fillStyle = color
  block.lines.forEach((line, i) => ctx.fillText(line, block.x, block.y + i * lh))
  ctx.restore()
}

interface DrawOptions {
  zoom: number
  /** Device pixels per world unit, for effects that ignore the transform (shadows). */
  scale: number
  hideText?: boolean
  exporting?: boolean
}

export function drawElement(ctx: CanvasRenderingContext2D, rc: RoughCanvas, el: SkrawlElement, opts: DrawOptions) {
  ctx.save()
  if (el.angle) {
    const c = center(el)
    ctx.translate(c.x, c.y)
    ctx.rotate(el.angle)
    ctx.translate(-c.x, -c.y)
  }
  switch (el.type) {
    case 'freedraw': {
      ctx.strokeStyle = el.strokeColor
      ctx.lineWidth = el.strokeWidth + 1
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke(new Path2D(freedrawPath(el)))
      break
    }
    case 'frame': {
      ctx.strokeStyle = FRAME_COLOR
      ctx.lineWidth = 1 / opts.zoom
      ctx.strokeRect(el.x, el.y, el.width, el.height)
      if (!opts.exporting && !opts.hideText) {
        ctx.font = `${12 / opts.zoom}px ${UI_FONT}`
        ctx.fillStyle = FRAME_COLOR
        ctx.textBaseline = 'bottom'
        ctx.fillText(el.name || 'Frame', el.x, el.y - 6 / opts.zoom)
      }
      break
    }
    case 'sticky': {
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.18)'
      ctx.shadowBlur = 12 * opts.scale
      ctx.shadowOffsetY = 3 * opts.scale
      ctx.fillStyle = el.backgroundColor
      ctx.fillRect(el.x, el.y, el.width, el.height)
      ctx.restore()
      break
    }
    case 'text':
      break
    default:
      drawablesFor(el).forEach((d) => rc.draw(d))
  }
  if (!opts.hideText && el.text) {
    const block = textLayout(el)
    if (block) drawTextBlock(ctx, block, el.strokeColor, isLinear(el) ? CANVAS_BG : undefined)
  }
  ctx.restore()
}

// --- handles -----------------------------------------------------------------

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'start' | 'end'

export interface Handle {
  id: HandleId
  x: number
  y: number
}

/** Handle positions in world space for a single selected element. */
export function getHandles(el: SkrawlElement, zoom: number): Handle[] {
  if (isLinear(el)) {
    const s = startPoint(el)
    const e = endPoint(el)
    return [
      { id: 'start', ...s },
      { id: 'end', ...e },
    ]
  }
  const pad = 6 / zoom
  const c = center(el)
  const { x, y, width: w, height: h } = el
  const l = x - pad
  const r = x + w + pad
  const t = y - pad
  const b = y + h + pad
  const local: Handle[] = [
    { id: 'nw', x: l, y: t },
    { id: 'ne', x: r, y: t },
    { id: 'se', x: r, y: b },
    { id: 'sw', x: l, y: b },
  ]
  // Edge handles only fit when the element is big enough on screen, and text scales from corners.
  if (el.type !== 'text' && w * zoom > 40 && h * zoom > 40) {
    local.push({ id: 'n', x: x + w / 2, y: t }, { id: 'e', x: r, y: y + h / 2 })
    local.push({ id: 's', x: x + w / 2, y: b }, { id: 'w', x: l, y: y + h / 2 })
  }
  if (canRotate(el)) local.push({ id: 'rotate', x: x + w / 2, y: t - 22 / zoom })
  return local.map((hd) => ({ ...hd, ...rotate(hd, c, el.angle) }))
}

function outlineElement(ctx: CanvasRenderingContext2D, el: SkrawlElement, pad: number) {
  ctx.beginPath()
  if (isLinear(el)) {
    ctx.moveTo(el.x, el.y)
    ctx.lineTo(el.x + el.width, el.y + el.height)
  } else {
    const padded = { ...el, x: el.x - pad, y: el.y - pad, width: el.width + pad * 2, height: el.height + pad * 2 }
    corners(padded).forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
  }
  ctx.stroke()
}

// --- scene -------------------------------------------------------------------

export interface RenderOptions {
  width: number
  height: number
  dpr: number
  view: View
  selectedIds: string[]
  /** Element whose text is being edited in place, so the canvas doesn't draw it twice. */
  editingId?: string
  /** Shape an arrow end will stick to if released here. */
  bindTargetId?: string
  marquee?: Bounds
  /** While presenting, everything outside this frame is masked and frame borders are hidden. */
  presentFrame?: Bounds
  showGrid: boolean
}

export function renderScene(canvas: HTMLCanvasElement, elements: SkrawlElement[], opts: RenderOptions) {
  const ctx = canvas.getContext('2d')!
  const rc = rough.canvas(canvas)
  const { view, dpr } = opts
  const zoom = view.zoom
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = CANVAS_BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const scale = dpr * zoom
  ctx.setTransform(scale, 0, 0, scale, scale * view.scrollX, scale * view.scrollY)
  const visible: Bounds = {
    minX: -view.scrollX,
    minY: -view.scrollY,
    maxX: -view.scrollX + opts.width / zoom,
    maxY: -view.scrollY + opts.height / zoom,
  }

  if (opts.showGrid && !opts.presentFrame && zoom >= 0.4) {
    const dot = 1.5 / zoom
    ctx.fillStyle = '#d0d0d8'
    for (let x = Math.floor(visible.minX / GRID_SIZE) * GRID_SIZE; x < visible.maxX; x += GRID_SIZE) {
      for (let y = Math.floor(visible.minY / GRID_SIZE) * GRID_SIZE; y < visible.maxY; y += GRID_SIZE) {
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot)
      }
    }
  }

  const drawOpts = { zoom, scale }
  const onScreen = (el: SkrawlElement) => {
    const b = getBounds(el)
    const m = 40 // room for labels, shadows and frame titles
    return b.maxX + m >= visible.minX && b.minX - m <= visible.maxX && b.maxY + m >= visible.minY && b.minY - m <= visible.maxY
  }
  // Frames always sit underneath the content they hold.
  if (!opts.presentFrame) {
    for (const el of elements) {
      if (el.type === 'frame' && onScreen(el)) drawElement(ctx, rc, el, { ...drawOpts, hideText: el.id === opts.editingId })
    }
  }
  for (const el of elements) {
    if (el.type !== 'frame' && onScreen(el)) drawElement(ctx, rc, el, { ...drawOpts, hideText: el.id === opts.editingId })
  }

  if (opts.presentFrame) {
    const f = opts.presentFrame
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(visible.minX, visible.minY, f.minX - visible.minX, visible.maxY - visible.minY)
    ctx.fillRect(f.maxX, visible.minY, visible.maxX - f.maxX, visible.maxY - visible.minY)
    ctx.fillRect(f.minX, visible.minY, f.maxX - f.minX, f.minY - visible.minY)
    ctx.fillRect(f.minX, f.maxY, f.maxX - f.minX, visible.maxY - f.maxY)
    return
  }

  ctx.save()
  ctx.strokeStyle = SELECTION_COLOR
  ctx.lineWidth = 1 / zoom

  const bindTarget = elements.find((el) => el.id === opts.bindTargetId)
  if (bindTarget) {
    ctx.lineWidth = 3 / zoom
    ctx.globalAlpha = 0.5
    outlineElement(ctx, bindTarget, 4 / zoom)
    ctx.globalAlpha = 1
    ctx.lineWidth = 1 / zoom
  }

  const selected = elements.filter((el) => opts.selectedIds.includes(el.id))
  if (selected.length === 1) {
    const el = selected[0]
    ctx.setLineDash([6 / zoom, 4 / zoom])
    if (!isLinear(el)) outlineElement(ctx, el, 6 / zoom)
    ctx.setLineDash([])
    const handles = getHandles(el, zoom)
    const size = 9 / zoom
    for (const hd of handles) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      if (hd.id === 'rotate' || hd.id === 'start' || hd.id === 'end') ctx.arc(hd.x, hd.y, size / 2 + 1 / zoom, 0, Math.PI * 2)
      else ctx.rect(hd.x - size / 2, hd.y - size / 2, size, size)
      ctx.fill()
      ctx.stroke()
    }
  } else if (selected.length > 1) {
    selected.forEach((el) => outlineElement(ctx, el, 3 / zoom))
    const b = unionBounds(selected.map(getBounds))
    const pad = 8 / zoom
    ctx.setLineDash([6 / zoom, 4 / zoom])
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2)
  }

  if (opts.marquee) {
    const m = opts.marquee
    ctx.setLineDash([])
    ctx.fillStyle = 'rgba(105, 101, 219, 0.08)'
    ctx.fillRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
    ctx.strokeRect(m.minX, m.minY, m.maxX - m.minX, m.maxY - m.minY)
  }
  ctx.restore()
}

/** Bounds of elements including room for labels, for exports and zoom-to-fit. */
export function contentBounds(elements: SkrawlElement[]): Bounds | null {
  if (elements.length === 0) return null
  return unionBounds(elements.map(getBounds))
}

/** Renders the elements onto a white canvas cropped to the drawing. */
export function exportToCanvas(elements: SkrawlElement[], padding = 24, scale = 2): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  const b = contentBounds(elements)
  if (!b) return canvas
  const minX = b.minX - padding
  const minY = b.minY - padding
  canvas.width = Math.ceil((b.maxX - b.minX + padding * 2) * scale)
  canvas.height = Math.ceil((b.maxY - b.minY + padding * 2) * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = CANVAS_BG
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale)
  const rc = rough.canvas(canvas)
  const ordered = [...elements.filter((el) => el.type === 'frame'), ...elements.filter((el) => el.type !== 'frame')]
  ordered.forEach((el) => drawElement(ctx, rc, el, { zoom: 1, scale, exporting: true }))
  return canvas
}

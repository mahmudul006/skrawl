import {
  boundsContain,
  center,
  endPoint,
  getBounds,
  isBindable,
  isLinear,
  normalizeFreedraw,
  outlinePoint,
  rotate,
  startPoint,
} from './geometry'
import type { HandleId } from './scene'
import { newId, randomSeed } from './scene'
import { TEXT_SIZE, measureText } from './text'
import type { Point, SkrawlElement } from './types'

const BIND_GAP = 6

/**
 * Moves the ends of bound lines and arrows onto the edge of the shapes they're stuck to,
 * and drops bindings whose shape no longer exists. Returns the same array when nothing changed.
 */
export function updateBindings(elements: SkrawlElement[]): SkrawlElement[] {
  const byId = new Map(elements.map((el) => [el.id, el]))
  let changed = false
  const next = elements.map((el) => {
    if (!isLinear(el) || (!el.startBinding && !el.endBinding)) return el
    const startShape = el.startBinding ? byId.get(el.startBinding.elementId) : undefined
    const endShape = el.endBinding ? byId.get(el.endBinding.elementId) : undefined
    let s = startPoint(el)
    let e = endPoint(el)
    // Aim each end at the other shape's center when both ends are bound, so arrows run center to center.
    if (startShape) s = outlinePoint(startShape, endShape ? center(endShape) : e, BIND_GAP)
    if (endShape) e = outlinePoint(endShape, startShape ? center(startShape) : s, BIND_GAP)
    const updated: SkrawlElement = {
      ...el,
      x: s.x,
      y: s.y,
      width: e.x - s.x,
      height: e.y - s.y,
      startBinding: startShape ? el.startBinding : null,
      endBinding: endShape ? el.endBinding : null,
    }
    const same =
      Math.abs(updated.x - el.x) < 0.01 &&
      Math.abs(updated.y - el.y) < 0.01 &&
      Math.abs(updated.width - el.width) < 0.01 &&
      Math.abs(updated.height - el.height) < 0.01 &&
      updated.startBinding === el.startBinding &&
      updated.endBinding === el.endBinding
    if (same) return el
    changed = true
    return updated
  })
  return changed ? next : elements
}

export const canBindTo = (el: SkrawlElement, arrowId: string) => isBindable(el) && el.id !== arrowId

// --- resize & rotate -----------------------------------------------------------

const ANCHOR: Record<string, [number, number]> = {
  nw: [1, 1],
  n: [0.5, 1],
  ne: [0, 1],
  e: [0, 0.5],
  se: [0, 0],
  s: [0.5, 0],
  sw: [1, 0],
  w: [1, 0.5],
}

/**
 * Resizes a box element by dragging `handle` to `pointer`, keeping the opposite side fixed in
 * world space even when the element is rotated.
 */
export function resizeElement(orig: SkrawlElement, handle: HandleId, pointer: Point, keepAspect: boolean): SkrawlElement {
  const c = center(orig)
  const { x, y, width: w, height: h } = orig
  const [ax, ay] = ANCHOR[handle]
  const anchor = { x: x + ax * w, y: y + ay * h }
  const p = rotate(pointer, c, -orig.angle)
  const movesX = handle !== 'n' && handle !== 's'
  const movesY = handle !== 'e' && handle !== 'w'

  // Signed scale along each axis; negative means the handle crossed the anchor and the shape flips.
  let sx = movesX && w > 0 ? (p.x - anchor.x) / ((1 - ax) * w - ax * w) : 1
  let sy = movesY && h > 0 ? (p.y - anchor.y) / ((1 - ay) * h - ay * h) : 1
  if (!movesX && w === 0) sx = 1
  if (!movesY && h === 0) sy = 1
  if (keepAspect || orig.type === 'text') {
    const s = movesX && movesY ? Math.max(Math.abs(sx), Math.abs(sy)) : movesX ? Math.abs(sx) : Math.abs(sy)
    sx = Math.sign(sx || 1) * s
    sy = Math.sign(sy || 1) * s
  }
  const minScale = 2 / Math.max(w, h, 1)
  if (Math.abs(sx) < minScale) sx = Math.sign(sx || 1) * minScale
  if (Math.abs(sy) < minScale) sy = Math.sign(sy || 1) * minScale

  const nw = Math.abs(sx) * w
  const nh = Math.abs(sy) * h
  // New box in the element's local (unrotated) frame.
  const lx = sx >= 0 ? anchor.x - ax * nw : anchor.x - (1 - ax) * nw
  const ly = sy >= 0 ? anchor.y - ay * nh : anchor.y - (1 - ay) * nh
  const nc = rotate({ x: lx + nw / 2, y: ly + nh / 2 }, c, orig.angle)

  const next: SkrawlElement = { ...orig, x: nc.x - nw / 2, y: nc.y - nh / 2, width: nw, height: nh }
  if (orig.type === 'freedraw' && orig.points) {
    next.points = orig.points.map(([px, py]) => [
      (sx < 0 ? w - px : px) * Math.abs(sx),
      (sy < 0 ? h - py : py) * Math.abs(sy),
    ])
  }
  if (orig.type === 'text') {
    const fontSize = Math.max(6, (orig.fontSize ?? TEXT_SIZE) * Math.abs(sy))
    const size = measureText(orig.text ?? '', fontSize)
    return { ...next, fontSize, width: size.width, height: size.height, x: nc.x - size.width / 2, y: nc.y - size.height / 2 }
  }
  return next
}

export function rotateElement(orig: SkrawlElement, start: Point, pointer: Point, snap: boolean): SkrawlElement {
  const c = center(orig)
  let angle = orig.angle + Math.atan2(pointer.y - c.y, pointer.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x)
  if (snap) angle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12)
  angle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
  return { ...orig, angle }
}

// --- copy, paste, duplicate ------------------------------------------------------

/** Deep-copies elements with fresh ids, keeping bindings between copied elements. */
export function cloneElements(source: SkrawlElement[], dx: number, dy: number): SkrawlElement[] {
  const ids = new Map(source.map((el) => [el.id, newId()]))
  const remap = (b?: { elementId: string } | null) => (b && ids.has(b.elementId) ? { elementId: ids.get(b.elementId)! } : null)
  return source.map((el) => ({
    ...el,
    id: ids.get(el.id)!,
    seed: randomSeed(),
    x: el.x + dx,
    y: el.y + dy,
    points: el.points?.map(([px, py]) => [px, py] as [number, number]),
    startBinding: remap(el.startBinding),
    endBinding: remap(el.endBinding),
  }))
}

/** The selected elements plus everything sitting inside any selected frame. */
export function withFrameContents(elements: SkrawlElement[], ids: string[]): string[] {
  const set = new Set(ids)
  for (const frame of elements.filter((el) => el.type === 'frame' && ids.includes(el.id))) {
    const fb = getBounds(frame)
    for (const el of elements) {
      if (el.type !== 'frame' && boundsContain(fb, getBounds(el))) set.add(el.id)
    }
  }
  return [...set]
}

// --- layer order ---------------------------------------------------------------

export type LayerMove = 'front' | 'forward' | 'backward' | 'back'

export function reorder(elements: SkrawlElement[], ids: string[], move: LayerMove): SkrawlElement[] {
  const set = new Set(ids)
  const picked = elements.filter((el) => set.has(el.id))
  const rest = elements.filter((el) => !set.has(el.id))
  if (move === 'front') return [...rest, ...picked]
  if (move === 'back') return [...picked, ...rest]
  const next = [...elements]
  if (move === 'forward') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (set.has(next[i].id) && !set.has(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (set.has(next[i].id) && !set.has(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]
    }
  }
  return next
}

// --- loading -------------------------------------------------------------------

const TYPES = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'sticky', 'frame'])

/** Validates elements from storage, a shared link or the clipboard, filling in fields older versions lacked. */
export function restoreElements(input: unknown): SkrawlElement[] {
  if (!Array.isArray(input)) return []
  const out: SkrawlElement[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || !TYPES.has((raw as SkrawlElement).type)) continue
    const r = raw as Partial<SkrawlElement>
    if (![r.x, r.y, r.width, r.height].every((n) => typeof n === 'number' && Number.isFinite(n))) continue
    let el: SkrawlElement = {
      id: typeof r.id === 'string' ? r.id : newId(),
      type: r.type!,
      x: r.x!,
      y: r.y!,
      width: r.width!,
      height: r.height!,
      angle: typeof r.angle === 'number' ? r.angle : 0,
      strokeColor: typeof r.strokeColor === 'string' ? r.strokeColor : '#1e1e1e',
      backgroundColor: typeof r.backgroundColor === 'string' ? r.backgroundColor : 'transparent',
      strokeWidth: typeof r.strokeWidth === 'number' ? r.strokeWidth : 2,
      seed: typeof r.seed === 'number' ? r.seed : randomSeed(),
    }
    if (typeof r.text === 'string') el.text = r.text
    if (typeof r.fontSize === 'number') el.fontSize = r.fontSize
    if (typeof r.name === 'string') el.name = r.name
    if (r.startBinding?.elementId) el.startBinding = { elementId: r.startBinding.elementId }
    if (r.endBinding?.elementId) el.endBinding = { elementId: r.endBinding.elementId }
    if (el.type === 'freedraw') {
      el.points = Array.isArray(r.points) ? r.points.filter((p) => Array.isArray(p) && p.length === 2) : [[0, 0]]
      // Early versions kept freedraw points relative to the first point with no size.
      if (el.width === 0 && el.height === 0) el = normalizeFreedraw(el)
    }
    out.push(el)
  }
  return updateBindings(out)
}

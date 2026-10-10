import type { Bounds, Point, SkrawlElement } from './types'

export const isLinear = (el: SkrawlElement) => el.type === 'line' || el.type === 'arrow'
/** Shapes a line or arrow end can stick to. */
export const isBindable = (el: SkrawlElement) =>
  el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse' || el.type === 'text' || el.type === 'sticky'
/** Shapes that show their `text` as a centered label. */
export const hasCenteredLabel = (el: SkrawlElement) =>
  el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse'
export const canRotate = (el: SkrawlElement) => !isLinear(el) && el.type !== 'frame'

export function rotate(p: Point, c: Point, angle: number): Point {
  if (angle === 0) return p
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - c.x
  const dy = p.y - c.y
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos }
}

export const center = (el: SkrawlElement): Point => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 })

export const startPoint = (el: SkrawlElement): Point => ({ x: el.x, y: el.y })
export const endPoint = (el: SkrawlElement): Point => ({ x: el.x + el.width, y: el.y + el.height })

/** The four corners of a box element, rotated into world space. */
export function corners(el: SkrawlElement): Point[] {
  const c = center(el)
  return [
    { x: el.x, y: el.y },
    { x: el.x + el.width, y: el.y },
    { x: el.x + el.width, y: el.y + el.height },
    { x: el.x, y: el.y + el.height },
  ].map((p) => rotate(p, c, el.angle))
}

const boundsOf = (pts: Point[]): Bounds => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
})

/** Axis-aligned world bounds, including rotation. */
export function getBounds(el: SkrawlElement): Bounds {
  if (isLinear(el)) return boundsOf([startPoint(el), endPoint(el)])
  return boundsOf(corners(el))
}

export function unionBounds(list: Bounds[]): Bounds {
  return {
    minX: Math.min(...list.map((b) => b.minX)),
    minY: Math.min(...list.map((b) => b.minY)),
    maxX: Math.max(...list.map((b) => b.maxX)),
    maxY: Math.max(...list.map((b) => b.maxY)),
  }
}

export const boundsContain = (outer: Bounds, inner: Bounds) =>
  inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY

export function distToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

export function hitTest(el: SkrawlElement, world: Point, tolerance: number): boolean {
  if (isLinear(el)) {
    if (distToSegment(world, startPoint(el), endPoint(el)) <= tolerance) return true
    // Labels sit on the middle of the line and are easy to aim for.
    return !!el.text && Math.hypot(world.x - (el.x + el.width / 2), world.y - (el.y + el.height / 2)) <= 20
  }
  // Test in the element's own unrotated frame.
  const p = rotate(world, center(el), -el.angle)
  const { x, y, width: w, height: h } = el
  const inBox = p.x >= x - tolerance && p.x <= x + w + tolerance && p.y >= y - tolerance && p.y <= y + h + tolerance
  switch (el.type) {
    case 'rectangle':
    case 'text':
    case 'sticky':
      return inBox
    case 'frame': {
      // Only the border and title select a frame, so you can still draw and marquee inside it.
      const inner = p.x > x + tolerance && p.x < x + w - tolerance && p.y > y + tolerance && p.y < y + h - tolerance
      const onTitle = p.x >= x && p.x <= x + Math.max(80, w / 2) && p.y >= y - 24 && p.y <= y
      return (inBox && !inner) || onTitle
    }
    case 'ellipse': {
      const nx = (p.x - x - w / 2) / (w / 2 + tolerance)
      const ny = (p.y - y - h / 2) / (h / 2 + tolerance)
      return nx * nx + ny * ny <= 1
    }
    case 'diamond': {
      const nx = Math.abs(p.x - x - w / 2) / (w / 2 + tolerance)
      const ny = Math.abs(p.y - y - h / 2) / (h / 2 + tolerance)
      return nx + ny <= 1
    }
    case 'freedraw': {
      const pts = el.points ?? []
      if (pts.length === 1) return Math.hypot(p.x - x - pts[0][0], p.y - y - pts[0][1]) <= tolerance
      for (let i = 0; i < pts.length - 1; i++) {
        const a = { x: x + pts[i][0], y: y + pts[i][1] }
        const b = { x: x + pts[i + 1][0], y: y + pts[i + 1][1] }
        if (distToSegment(p, a, b) <= tolerance) return true
      }
      return false
    }
    default:
      return false
  }
}

/** Topmost element under the point. Frames sit underneath everything else. */
export function elementAt(
  elements: SkrawlElement[],
  world: Point,
  tolerance: number,
  filter: (el: SkrawlElement) => boolean = () => true,
) {
  for (const frames of [false, true]) {
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i]
      if ((el.type === 'frame') === frames && filter(el) && hitTest(el, world, tolerance)) return el
    }
  }
  return undefined
}

/** Flip negative sizes so boxes always grow down-right from (x, y). */
export function normalizeBox(el: SkrawlElement): SkrawlElement {
  if (isLinear(el) || (el.width >= 0 && el.height >= 0)) return el
  return {
    ...el,
    x: Math.min(el.x, el.x + el.width),
    y: Math.min(el.y, el.y + el.height),
    width: Math.abs(el.width),
    height: Math.abs(el.height),
  }
}

/** Re-bases freedraw points so (x, y) is the stroke's top-left and width/height its size. */
export function normalizeFreedraw(el: SkrawlElement): SkrawlElement {
  const pts = el.points ?? [[0, 0]]
  const minX = Math.min(...pts.map((p) => p[0]))
  const minY = Math.min(...pts.map((p) => p[1]))
  const maxX = Math.max(...pts.map((p) => p[0]))
  const maxY = Math.max(...pts.map((p) => p[1]))
  return {
    ...el,
    x: el.x + minX,
    y: el.y + minY,
    width: maxX - minX,
    height: maxY - minY,
    points: pts.map(([px, py]) => [px - minX, py - minY]),
  }
}

/**
 * Where a ray from the element's center toward `toward` leaves its outline, pushed out by `gap`.
 * Used to end bound arrows at the edge of the shape they point at.
 */
export function outlinePoint(el: SkrawlElement, toward: Point, gap: number): Point {
  const c = center(el)
  const local = rotate(toward, c, -el.angle)
  const dx = local.x - c.x
  const dy = local.y - c.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return c
  const hw = el.width / 2
  const hh = el.height / 2
  let t: number
  if (el.type === 'ellipse') t = 1 / Math.hypot(dx / hw, dy / hh)
  else if (el.type === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh)
  else t = Math.min(dx === 0 ? Infinity : hw / Math.abs(dx), dy === 0 ? Infinity : hh / Math.abs(dy))
  const edge = { x: c.x + dx * t + (dx / len) * gap, y: c.y + dy * t + (dy / len) * gap }
  return rotate(edge, c, el.angle)
}

export const round = (n: number) => Math.round(n * 100) / 100

import { distToSegment } from './geometry'
import type { SkrawlElement } from './types'

export type RecognizedType = 'line' | 'rectangle' | 'diamond' | 'ellipse'

/** How many points must lie close to a candidate outline for it to win. */
const MATCH_THRESHOLD = 0.8

/**
 * Guesses whether a pen stroke was meant as a straight line, rectangle, diamond or ellipse.
 * Works on the stroke's own box: each candidate outline is scored by the share of points near it.
 * Returns null for anything that looks like a real sketch, so doodles stay doodles.
 */
export function recognizeStroke(el: SkrawlElement): RecognizedType | null {
  const pts = (el.points ?? []).map(([x, y]) => ({ x, y }))
  if (pts.length < 6) return null
  const w = el.width
  const h = el.height
  const diag = Math.hypot(w, h)
  if (diag < 30) return null

  let length = 0
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
  const first = pts[0]
  const last = pts[pts.length - 1]
  const gap = Math.hypot(last.x - first.x, last.y - first.y)

  // Open stroke: a line if every point hugs the segment between its ends.
  if (gap > diag * 0.35) {
    const maxDev = Math.max(...pts.map((p) => distToSegment(p, first, last)))
    const straightish = length < gap * 1.2
    return straightish && maxDev < Math.max(8, gap * 0.07) ? 'line' : null
  }

  // Closed stroke: it should go round roughly once, and not be a thin squiggle.
  if (length > (w + h) * 2 * 1.6 || Math.min(w, h) < diag * 0.12) return null
  const tol = Math.max(6, Math.min(w, h) * 0.14)
  const hw = w / 2
  const hh = h / 2
  const near = (dist: (p: { x: number; y: number }) => number) => pts.filter((p) => dist(p) <= tol).length / pts.length

  const rect = near((p) => Math.min(Math.abs(p.x), Math.abs(p.x - w), Math.abs(p.y), Math.abs(p.y - h)))
  const diamond = near((p) => {
    // Distance from the diamond |dx|/hw + |dy|/hh = 1, scaled back to pixels.
    const v = Math.abs(p.x - hw) / hw + Math.abs(p.y - hh) / hh
    return (Math.abs(v - 1) * Math.min(hw, hh)) / 1.2
  })
  const ellipse = near((p) => {
    const r = Math.hypot((p.x - hw) / hw, (p.y - hh) / hh)
    return Math.abs(r - 1) * Math.min(hw, hh)
  })

  // A rectangle's corners poke out past an ellipse, so require the corners to be visited.
  const cornerReach = Math.min(w, h) * 0.22
  const cornersHit = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].filter(([cx, cy]) => pts.some((p) => Math.hypot(p.x - cx, p.y - cy) < cornerReach)).length

  const scores: [RecognizedType, number][] = [
    ['rectangle', cornersHit >= 3 ? rect : 0],
    ['diamond', cornersHit === 0 ? diamond : 0],
    ['ellipse', cornersHit <= 1 ? ellipse : 0],
  ]
  scores.sort((a, b) => b[1] - a[1])
  return scores[0][1] >= MATCH_THRESHOLD ? scores[0][0] : null
}

/** Builds the clean shape that replaces a recognized stroke. */
export function toShape(el: SkrawlElement, type: RecognizedType, backgroundColor: string): SkrawlElement {
  const { points: _points, ...base } = el
  void _points
  if (type === 'line') {
    const pts = el.points!
    const [sx, sy] = pts[0]
    const [ex, ey] = pts[pts.length - 1]
    return { ...base, type, angle: 0, x: el.x + sx, y: el.y + sy, width: ex - sx, height: ey - sy }
  }
  return { ...base, type, backgroundColor }
}

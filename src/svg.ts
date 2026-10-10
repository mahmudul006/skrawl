import rough from 'roughjs'
import { center } from './geometry'
import { CANVAS_BG, contentBounds, freedrawPath, textLayout } from './scene'
import { HAND_FONT, LINE_HEIGHT } from './text'
import type { SkrawlElement } from './types'

const NS = 'http://www.w3.org/2000/svg'

/** Builds a standalone SVG of the elements, with rough.js strokes and the hand-drawn font. */
export function exportToSvg(elements: SkrawlElement[], padding = 24): string {
  const svg = document.createElementNS(NS, 'svg')
  const b = contentBounds(elements)
  if (!b) return ''
  const minX = b.minX - padding
  const minY = b.minY - padding
  const w = b.maxX - b.minX + padding * 2
  const h = b.maxY - b.minY + padding * 2
  svg.setAttribute('xmlns', NS)
  svg.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`)
  svg.setAttribute('width', String(Math.ceil(w)))
  svg.setAttribute('height', String(Math.ceil(h)))

  const style = document.createElementNS(NS, 'style')
  style.textContent = "@import url('https://fonts.googleapis.com/css2?family=Caveat:wght@500&display=swap');"
  svg.appendChild(style)
  const bg = document.createElementNS(NS, 'rect')
  Object.entries({ x: minX, y: minY, width: w, height: h, fill: CANVAS_BG }).forEach(([k, v]) => bg.setAttribute(k, String(v)))
  svg.appendChild(bg)

  const rs = rough.svg(svg)

  const ordered = [...elements.filter((el) => el.type === 'frame'), ...elements.filter((el) => el.type !== 'frame')]
  for (const el of ordered) {
    const g = document.createElementNS(NS, 'g')
    if (el.angle) {
      const c = center(el)
      g.setAttribute('transform', `rotate(${(el.angle * 180) / Math.PI} ${c.x} ${c.y})`)
    }
    const add = (tag: string, attrs: Record<string, string | number>) => {
      const node = document.createElementNS(NS, tag)
      Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, String(v)))
      g.appendChild(node)
      return node
    }
    const o = {
      seed: el.seed,
      stroke: el.strokeColor,
      strokeWidth: el.strokeWidth,
      roughness: 1.2,
      fill: el.backgroundColor === 'transparent' ? undefined : el.backgroundColor,
      fillStyle: 'hachure' as const,
      fillWeight: el.strokeWidth / 2,
    }
    const { x, y, width: ew, height: eh } = el
    switch (el.type) {
      case 'rectangle':
        g.appendChild(rs.rectangle(x, y, ew, eh, o))
        break
      case 'ellipse':
        g.appendChild(rs.ellipse(x + ew / 2, y + eh / 2, ew, eh, o))
        break
      case 'diamond':
        g.appendChild(
          rs.polygon(
            [
              [x + ew / 2, y],
              [x + ew, y + eh / 2],
              [x + ew / 2, y + eh],
              [x, y + eh / 2],
            ],
            o,
          ),
        )
        break
      case 'line':
        g.appendChild(rs.line(x, y, x + ew, y + eh, o))
        break
      case 'arrow': {
        const x2 = x + ew
        const y2 = y + eh
        const a = Math.atan2(eh, ew)
        const len = Math.min(24, Math.hypot(ew, eh) / 3)
        g.appendChild(rs.line(x, y, x2, y2, o))
        for (const spread of [0.45, -0.45]) {
          g.appendChild(rs.line(x2, y2, x2 - len * Math.cos(a - spread), y2 - len * Math.sin(a - spread), o))
        }
        break
      }
      case 'freedraw':
        add('path', {
          d: freedrawPath(el),
          fill: 'none',
          stroke: el.strokeColor,
          'stroke-width': el.strokeWidth + 1,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
        break
      case 'sticky':
        add('rect', { x, y, width: ew, height: eh, fill: el.backgroundColor, filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.18))' })
        break
      case 'frame':
        add('rect', { x, y, width: ew, height: eh, fill: 'none', stroke: '#9a9aa6', 'stroke-width': 1 })
        break
    }
    const block = el.text ? textLayout(el) : null
    if (block) {
      const lh = block.size * LINE_HEIGHT
      if (el.type === 'line' || el.type === 'arrow') {
        const widest = Math.max(...block.lines.map((l) => l.length)) * block.size * 0.45
        add('rect', { x: block.x - widest / 2 - 6, y: block.y - 2, width: widest + 12, height: block.lines.length * lh + 4, fill: CANVAS_BG })
      }
      block.lines.forEach((line, i) => {
        const t = add('text', {
          x: block.x,
          y: block.y + i * lh + block.size * 0.85,
          'font-family': HAND_FONT,
          'font-size': block.size,
          'font-weight': 500,
          fill: el.strokeColor,
          'text-anchor': block.align === 'center' ? 'middle' : 'start',
        })
        t.textContent = line
      })
    }
    svg.appendChild(g)
  }
  return new XMLSerializer().serializeToString(svg)
}

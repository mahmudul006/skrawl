import { newId, randomSeed } from './scene'
import { LABEL_SIZE, measureText } from './text'
import type { ElementType, SkrawlElement } from './types'

export const MERMAID_EXAMPLE = `flowchart TD
  A[Sign up] --> B{Email verified?}
  B -->|Yes| C[Dashboard]
  B -->|No| D(Resend email)
  D --> B
  C --> E((Done))`

interface Node {
  id: string
  label: string
  shape: ElementType
}

interface Edge {
  from: string
  to: string
  label: string
  arrow: boolean
}

// Node: id, optionally followed by a shape-wrapped label: A[..] A(..) A((..)) A{..} A([..]) A[[..]]
const NODE = /^([A-Za-z0-9_\-.]+)\s*(\(\(.*?\)\)|\(\[.*?\]\)|\[\[.*?\]\]|\[.*?\]|\(.*?\)|\{.*?\})?/
// Link between nodes: -->, ---, ==>, -.->, with optional |label| or "-- label -->" forms.
const LINK = /^(?:--\s*([^-|>][^>]*?)\s*-->|-->|---|==>|-\.->|-\.-)\s*(?:\|([^|]*)\|)?/

function parseNode(src: string, nodes: Map<string, Node>): [string, string] | null {
  const m = NODE.exec(src)
  if (!m) return null
  const [whole, id, wrapped] = m
  let shape: ElementType = 'rectangle'
  let label = id
  if (wrapped) {
    if (wrapped.startsWith('((')) {
      shape = 'ellipse'
      label = wrapped.slice(2, -2)
    } else if (wrapped.startsWith('{')) {
      shape = 'diamond'
      label = wrapped.slice(1, -1)
    } else if (wrapped.startsWith('([') || wrapped.startsWith('[[')) {
      label = wrapped.slice(2, -2)
    } else {
      label = wrapped.slice(1, -1)
    }
    label = label.replace(/^"(.*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n')
  }
  const existing = nodes.get(id)
  // Later mentions without a label keep the first definition.
  if (!existing || wrapped) nodes.set(id, { id, label, shape })
  return [id, src.slice(whole.length).trim()]
}

export interface ParseResult {
  elements: SkrawlElement[]
  error?: string
}

/** Converts a Mermaid flowchart into Skrawl shapes and arrows, laid out in layers. */
export function mermaidToElements(source: string, strokeColor: string): ParseResult {
  const lines = source
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean)
  if (lines.length === 0) return { elements: [], error: 'Paste a Mermaid flowchart to import.' }
  const header = /^(flowchart|graph)\s*(TD|TB|BT|LR|RL)?\s*;?$/i.exec(lines[0])
  if (!header) return { elements: [], error: 'Only flowcharts are supported. Start with "flowchart TD" or "graph LR".' }
  const dir = (header[2] ?? 'TD').toUpperCase()
  const horizontal = dir === 'LR' || dir === 'RL'

  const nodes = new Map<string, Node>()
  const edges: Edge[] = []
  for (let i = 1; i < lines.length; i++) {
    for (const statement of lines[i].split(';').map((s) => s.trim()).filter(Boolean)) {
      if (/^(style|classDef|class|linkStyle|click|subgraph|end|direction)\b/.test(statement)) continue
      let parsed = parseNode(statement, nodes)
      if (!parsed) return { elements: [], error: `Couldn't read line ${i + 1}: "${lines[i]}"` }
      let [from, rest] = parsed
      while (rest) {
        const link = LINK.exec(rest)
        if (!link) return { elements: [], error: `Couldn't read line ${i + 1}: "${lines[i]}"` }
        rest = rest.slice(link[0].length).trim()
        parsed = parseNode(rest, nodes)
        if (!parsed) return { elements: [], error: `Line ${i + 1} has a link with nothing after it.` }
        const [to, after] = parsed
        edges.push({ from, to, label: (link[1] ?? link[2] ?? '').trim(), arrow: link[0].includes('>') })
        from = to
        rest = after
      }
    }
  }
  if (nodes.size === 0) return { elements: [], error: 'No nodes found in the flowchart.' }

  // Layer each node one below its deepest parent. Edges that close a cycle (found by a
  // depth-first search in declaration order) are left out of the layering.
  const order = [...nodes.keys()]
  const back = new Set<Edge>()
  const state = new Map<string, 'open' | 'done'>()
  const visit = (id: string) => {
    state.set(id, 'open')
    for (const e of edges.filter((e) => e.from === id)) {
      if (state.get(e.to) === 'open') back.add(e)
      else if (!state.has(e.to)) visit(e.to)
    }
    state.set(id, 'done')
  }
  order.forEach((id) => state.has(id) || visit(id))
  const rank = new Map(order.map((id) => [id, 0]))
  for (let pass = 0; pass < order.length; pass++) {
    let moved = false
    for (const e of edges) {
      if (back.has(e) || rank.get(e.to)! >= rank.get(e.from)! + 1) continue
      rank.set(e.to, rank.get(e.from)! + 1)
      moved = true
    }
    if (!moved) break
  }

  const sizes = new Map(
    order.map((id) => {
      const n = nodes.get(id)!
      const text = measureText(n.label, LABEL_SIZE)
      let w = Math.max(140, text.width + 48)
      let h = Math.max(64, text.height + 32)
      if (n.shape === 'diamond') {
        w *= 1.5
        h *= 1.5
      } else if (n.shape === 'ellipse') {
        w = h = Math.max(w * 0.9, h * 1.3)
      }
      return [id, { w, h }]
    }),
  )

  const layers: string[][] = []
  for (const id of order) (layers[rank.get(id)!] ??= []).push(id)
  const GAP_ACROSS = 60
  const GAP_ALONG = 90
  const positions = new Map<string, { x: number; y: number }>()
  let along = 0
  for (const layer of layers.filter(Boolean)) {
    const across = layer.map((id) => (horizontal ? sizes.get(id)!.h : sizes.get(id)!.w))
    const depth = Math.max(...layer.map((id) => (horizontal ? sizes.get(id)!.w : sizes.get(id)!.h)))
    let cursor = -(across.reduce((a, b) => a + b, 0) + GAP_ACROSS * (layer.length - 1)) / 2
    layer.forEach((id, i) => {
      const s = sizes.get(id)!
      const offsetAlong = along + (depth - (horizontal ? s.w : s.h)) / 2
      positions.set(id, horizontal ? { x: offsetAlong, y: cursor } : { x: cursor, y: offsetAlong })
      cursor += across[i] + GAP_ACROSS
    })
    along += depth + GAP_ALONG
  }

  const flip = dir === 'BT' || dir === 'RL'
  const base = { angle: 0, strokeColor, backgroundColor: 'transparent', strokeWidth: 2 }
  const ids = new Map(order.map((id) => [id, newId()]))
  const shapes: SkrawlElement[] = order.map((id) => {
    const n = nodes.get(id)!
    const s = sizes.get(id)!
    const p = positions.get(id)!
    return {
      ...base,
      id: ids.get(id)!,
      type: n.shape,
      x: flip && horizontal ? -p.x - s.w : p.x,
      y: flip && !horizontal ? -p.y - s.h : p.y,
      width: s.w,
      height: s.h,
      text: n.label,
      seed: randomSeed(),
    }
  })
  const arrows: SkrawlElement[] = edges.map((e) => ({
    ...base,
    id: newId(),
    type: e.arrow ? 'arrow' : 'line',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    text: e.label || undefined,
    startBinding: { elementId: ids.get(e.from)! },
    endBinding: { elementId: ids.get(e.to)! },
    seed: randomSeed(),
  }))
  return { elements: [...shapes, ...arrows] }
}

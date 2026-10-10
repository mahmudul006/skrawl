export const HAND_FONT = '"Caveat", "Comic Sans MS", cursive'
export const UI_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const TEXT_SIZE = 28
export const LABEL_SIZE = 22
export const STICKY_SIZE = 22
export const LINE_HEIGHT = 1.2
export const STICKY_PADDING = 14

export const handFont = (size: number) => `500 ${size}px ${HAND_FONT}`

let measureCtx: CanvasRenderingContext2D | null = null
function ctx() {
  measureCtx ??= document.createElement('canvas').getContext('2d')!
  return measureCtx
}

export function measureLines(lines: string[], size: number) {
  const c = ctx()
  c.font = handFont(size)
  const width = Math.max(0, ...lines.map((l) => c.measureText(l).width))
  return { width, height: Math.max(1, lines.length) * size * LINE_HEIGHT }
}

export const measureText = (text: string, size: number) => measureLines(text.split('\n'), size)

/** Breaks text into lines no wider than maxWidth, splitting long words when needed. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const c = ctx()
  c.font = handFont(size)
  const fits = (s: string) => c.measureText(s).width <= maxWidth
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(/(\s+)/)) {
      if (fits(line + word)) {
        line += word
        continue
      }
      if (line.trim()) out.push(line.trimEnd())
      line = word.trimStart()
      // A single word wider than the box gets broken by character.
      while (line && !fits(line)) {
        let i = line.length - 1
        while (i > 1 && !fits(line.slice(0, i))) i--
        out.push(line.slice(0, i))
        line = line.slice(i)
      }
    }
    out.push(line.trimEnd())
  }
  return out
}

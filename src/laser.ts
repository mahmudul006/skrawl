const FADE_MS = 700
const COLOR = '255, 59, 48'

interface TrailPoint {
  x: number
  y: number
  t: number
  stroke: number
}

/**
 * Draws a fading laser-pointer trail on its own overlay canvas, in screen pixels.
 * It runs its own animation loop so the drawing canvas never redraws for it.
 */
export class LaserTrail {
  private points: TrailPoint[] = []
  private stroke = 0
  private frame = 0
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  begin(x: number, y: number) {
    this.stroke++
    this.add(x, y)
  }

  add(x: number, y: number) {
    this.points.push({ x, y, t: performance.now(), stroke: this.stroke })
    if (!this.frame) this.frame = requestAnimationFrame(this.draw)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
  }

  private draw = () => {
    const { canvas } = this
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth * dpr
    const h = canvas.clientHeight * dpr
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const now = performance.now()
    this.points = this.points.filter((p) => now - p.t < FADE_MS)
    ctx.lineCap = 'round'
    ctx.shadowColor = `rgba(${COLOR}, 0.8)`
    ctx.shadowBlur = 10
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]
      const b = this.points[i]
      if (a.stroke !== b.stroke) continue
      const life = 1 - (now - b.t) / FADE_MS
      ctx.strokeStyle = `rgba(${COLOR}, ${life})`
      ctx.lineWidth = 2 + 4 * life
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    this.frame = this.points.length ? requestAnimationFrame(this.draw) : 0
  }
}

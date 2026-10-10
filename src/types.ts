export type Tool =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'eraser'

export type ElementType = 'rectangle' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text'

export interface SkrawlElement {
  id: string
  type: ElementType
  /** Top-left for boxes and text; start point for lines and arrows; origin for freedraw. */
  x: number
  y: number
  /** For lines and arrows these are the delta to the end point and may be negative. */
  width: number
  height: number
  /** Freedraw points, relative to (x, y). */
  points?: [number, number][]
  text?: string
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
  /** Keeps rough.js output stable between renders. */
  seed: number
}

/** screen = (world + scroll) * zoom */
export interface View {
  scrollX: number
  scrollY: number
  zoom: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type Tool =
  | 'select'
  | 'hand'
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'sticky'
  | 'frame'
  | 'laser'
  | 'eraser'

export type ElementType =
  | 'rectangle'
  | 'diamond'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'freedraw'
  | 'text'
  | 'sticky'
  | 'frame'

/** Line and arrow ends can stick to another element and follow it around. */
export interface Binding {
  elementId: string
}

export interface SkrawlElement {
  id: string
  type: ElementType
  /**
   * Box elements: top-left of the unrotated box, with width/height >= 0.
   * Lines and arrows: start point, with width/height the (possibly negative) delta to the end point.
   */
  x: number
  y: number
  width: number
  height: number
  /** Rotation in radians about the box center. Always 0 for lines, arrows and frames. */
  angle: number
  /** Freedraw points, relative to (x, y), inside the width x height box. */
  points?: [number, number][]
  /** Text content, or the label of a shape, sticky note, line or arrow. */
  text?: string
  /** Font size of a text element. */
  fontSize?: number
  /** Frame title. */
  name?: string
  startBinding?: Binding | null
  endBinding?: Binding | null
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

export interface Point {
  x: number
  y: number
}

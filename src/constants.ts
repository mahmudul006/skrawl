import type { Tool } from './types'

export interface ToolDef {
  tool: Tool
  label: string
  key: string
}

export const TOOLS: ToolDef[] = [
  { tool: 'select', label: 'Select', key: 'v' },
  { tool: 'hand', label: 'Hand (or hold Space)', key: 'h' },
  { tool: 'rectangle', label: 'Rectangle', key: 'r' },
  { tool: 'diamond', label: 'Diamond', key: 'd' },
  { tool: 'ellipse', label: 'Ellipse', key: 'o' },
  { tool: 'arrow', label: 'Arrow', key: 'a' },
  { tool: 'line', label: 'Line', key: 'l' },
  { tool: 'freedraw', label: 'Pen', key: 'p' },
  { tool: 'text', label: 'Text', key: 't' },
  { tool: 'sticky', label: 'Sticky note', key: 'n' },
  { tool: 'frame', label: 'Frame (a slide for presenting)', key: 'f' },
  { tool: 'laser', label: 'Laser pointer', key: 'k' },
  { tool: 'eraser', label: 'Eraser', key: 'e' },
]

export const STROKE_COLORS = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00']
export const FILL_COLORS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99']
export const STROKE_WIDTHS = [1, 2, 4]

export interface StyleValues {
  strokeColor: string
  backgroundColor: string
  strokeWidth: number
}

export interface ToastData {
  message: string
  action?: { label: string; onClick: () => void }
}


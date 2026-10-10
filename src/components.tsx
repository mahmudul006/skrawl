import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { FILL_COLORS, STROKE_COLORS, STROKE_WIDTHS, TOOLS } from './constants'
import type { StyleValues, ToastData } from './constants'
import type { LayerMove } from './ops'
import type { Tool } from './types'

// --- icons ---------------------------------------------------------------------

const svgProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

const ICONS: Record<Tool, ReactNode> = {
  select: <path d="M6 3l12 9-5.5 1.2L10 19z" />,
  hand: (
    <path d="M8 13V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7S5 17 4 14.5l-.9-2.3a1.4 1.4 0 012.4-1.3L8 13" />
  ),
  rectangle: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  diamond: <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />,
  ellipse: <ellipse cx="12" cy="12" rx="8.5" ry="7" />,
  arrow: <path d="M4 20L20 4m0 0h-8m8 0v8" />,
  line: <path d="M4 20L20 4" />,
  freedraw: <path d="M4 17c2.5-6 5-9 7-9s0 7 3 7 3.5-5 6-7" />,
  text: <path d="M5 6V4h14v2M12 4v16m-3 0h6" />,
  sticky: <path d="M5 4h14v10l-6 6H5zM13 20v-6h6" />,
  frame: <path d="M7 3v18M17 3v18M3 7h18M3 17h18" />,
  laser: (
    <>
      <circle cx="17" cy="7" r="2.5" fill="currentColor" />
      <path d="M14.5 9.5C10 13 9 16 4 19" strokeDasharray="2 3" />
    </>
  ),
  eraser: <path d="M8.5 20H20M4.6 15.4l9.8-9.8a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L11 19H8.2l-3.6-3.6z" />,
}

export const ToolIcon = ({ tool }: { tool: Tool }) => <svg {...svgProps}>{ICONS[tool]}</svg>

// --- toolbar -------------------------------------------------------------------

export function Toolbar({ tool, onSelect }: { tool: Tool; onSelect: (t: Tool) => void }) {
  return (
    <header className="toolbar panel" role="toolbar" aria-label="Tools">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          className={`tool ${tool === t.tool ? 'active' : ''}`}
          title={`${t.label} — ${t.key.toUpperCase()}`}
          aria-label={t.label}
          aria-pressed={tool === t.tool}
          onClick={() => onSelect(t.tool)}
        >
          <ToolIcon tool={t.tool} />
          <span className="tool-key">{t.key.toUpperCase()}</span>
        </button>
      ))}
    </header>
  )
}

// --- style panel ---------------------------------------------------------------

interface StylePanelProps {
  style: StyleValues
  onStyle: (patch: Partial<StyleValues>) => void
  /** Hides the transparent fill option, for sticky notes which always have paper. */
  solidFill: boolean
  selectionCount: number
  onDuplicate: () => void
  onDelete: () => void
  onLayer: (move: LayerMove) => void
  snapOnHold?: { on: boolean; toggle: () => void }
}

export function StylePanel(props: StylePanelProps) {
  const { style, onStyle, selectionCount } = props
  const fills = props.solidFill ? FILL_COLORS.filter((c) => c !== 'transparent') : FILL_COLORS
  return (
    <aside className="style-panel panel" aria-label="Style">
      <div className="field">
        <span className="field-label">Stroke</span>
        <div className="swatches">
          {STROKE_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${style.strokeColor === c ? 'active' : ''}`}
              style={{ background: c }}
              aria-label={`Stroke ${c}`}
              onClick={() => onStyle({ strokeColor: c })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{props.solidFill ? 'Paper' : 'Fill'}</span>
        <div className="swatches">
          {fills.map((c) => (
            <button
              key={c}
              className={`swatch ${c === 'transparent' ? 'transparent' : ''} ${style.backgroundColor === c ? 'active' : ''}`}
              style={{ background: c === 'transparent' ? undefined : c }}
              aria-label={`Fill ${c === 'transparent' ? 'none' : c}`}
              onClick={() => onStyle({ backgroundColor: c })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Width</span>
        <div className="swatches">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              className={`width-btn ${style.strokeWidth === w ? 'active' : ''}`}
              aria-label={`Stroke width ${w}`}
              onClick={() => onStyle({ strokeWidth: w })}
            >
              <span style={{ height: w + 1 }} />
            </button>
          ))}
        </div>
      </div>
      {props.snapOnHold && (
        <label className="toggle">
          <input type="checkbox" id="snap-on-hold" checked={props.snapOnHold.on} onChange={props.snapOnHold.toggle} />
          <span>Hold to snap</span>
          <small>Pause before lifting the pen to turn a stroke into a clean line, box, diamond or circle</small>
        </label>
      )}
      {selectionCount > 0 && (
        <div className="field">
          <span className="field-label">{selectionCount > 1 ? `${selectionCount} selected` : 'Layers'}</span>
          <div className="actions">
            <button className="chip" onClick={() => props.onLayer('back')} title="Send to back — Ctrl+Shift+[">
              To back
            </button>
            <button className="chip" onClick={() => props.onLayer('backward')} title="Send backward — Ctrl+[">
              Backward
            </button>
            <button className="chip" onClick={() => props.onLayer('forward')} title="Bring forward — Ctrl+]">
              Forward
            </button>
            <button className="chip" onClick={() => props.onLayer('front')} title="Bring to front — Ctrl+Shift+]">
              To front
            </button>
          </div>
          <div className="actions">
            <button className="chip" onClick={props.onDuplicate} title="Duplicate — Ctrl+D">
              Duplicate
            </button>
            <button className="chip danger" onClick={props.onDelete} title="Delete — Del">
              Delete
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}

// --- top-right menu --------------------------------------------------------------

export interface MenuItem {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  hint?: string
}

export function TopMenu({ primary, items }: { primary: MenuItem[]; items: MenuItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    // Close the menu on any click outside it.
    const close = (e: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [])
  return (
    <div className="top-menu">
      {primary.map((item) => (
        <button key={item.label} className="panel primary-btn" onClick={item.onClick} disabled={item.disabled} title={item.hint}>
          {item.label}
        </button>
      ))}
      <details className="menu" ref={ref}>
        <summary className="panel primary-btn" aria-label="Menu">
          <svg {...svgProps}>
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </summary>
        <div className="menu-list panel">
          {items.map((item) => (
            <button
              key={item.label}
              className={`text-btn ${item.danger ? 'danger' : ''}`}
              disabled={item.disabled}
              title={item.hint}
              onClick={() => {
                item.onClick()
                // Keep the menu open while a two-step action is armed.
                if (!item.danger && ref.current) ref.current.open = false
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </details>
    </div>
  )
}

// --- toast ---------------------------------------------------------------------

export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(onDone, toast.action ? 5000 : 2500)
    return () => clearTimeout(timer)
  }, [toast, onDone])
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action!.onClick()
            onDone()
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}

// --- dialog --------------------------------------------------------------------

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog panel" role="dialog" aria-modal="true" aria-label={title}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// --- presentation controls ------------------------------------------------------

export function PresentBar(props: { index: number; count: number; title: string; onPrev: () => void; onNext: () => void; onExit: () => void }) {
  return (
    <div className="present-bar panel">
      <button className="icon-btn" onClick={props.onPrev} disabled={props.index === 0} aria-label="Previous slide">
        ‹
      </button>
      <span className="present-count">
        <strong>{props.title}</strong>
        <span>
          {props.index + 1} / {props.count}
        </span>
      </span>
      <button className="icon-btn" onClick={props.onNext} disabled={props.index === props.count - 1} aria-label="Next slide">
        ›
      </button>
      <button className="text-btn" onClick={props.onExit}>
        Exit
      </button>
    </div>
  )
}

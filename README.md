# Skrawl

A hand-drawn style whiteboard, inspired by [Excalidraw](https://excalidraw.com).
Built with React, TypeScript, Vite and [rough.js](https://roughjs.com).

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Features

- Tools: select, hand, rectangle, ellipse, arrow, line, pen, text, eraser
- Sketchy rough.js rendering with stroke color, fill and stroke width
- Infinite canvas: scroll to pan, Ctrl/Cmd + scroll (or pinch) to zoom
- Move shapes, double-click to edit text, Delete to remove
- Undo / redo
- Auto-saves to your browser (localStorage)
- Export to PNG

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V | Select |
| H / hold Space | Pan |
| R | Rectangle |
| O | Ellipse |
| A | Arrow |
| L | Line |
| P | Pen |
| T | Text |
| E | Eraser |
| Shift while drawing | Square / circle |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Delete / Backspace | Delete selected |
| Esc | Deselect |

## Project layout

```
src/
  App.tsx    UI, tools, pointer + keyboard handling, history
  scene.ts   Rendering, hit testing, export
  types.ts   Element and view types
```

## Ideas for next steps

- Resize and rotate handles, multi-select
- Live collaboration (e.g. Yjs + WebRTC)
- AI: clean up rough sketches, text-to-diagram
- Presentation mode using frames
- SVG export, Mermaid import

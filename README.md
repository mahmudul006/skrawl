# Skrawl

A hand-drawn style whiteboard, inspired by [Excalidraw](https://excalidraw.com).
Built with React, TypeScript, Vite and [rough.js](https://roughjs.com).

**Live:** https://mahmudul006.github.io/skrawl/ (deployed from `main` by GitHub Actions)

## Getting started

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Features

**Drawing**
- Rectangle, diamond, ellipse, arrow, line, pen, text and sticky notes, all with a hand-drawn rough.js look
- Stroke color, fill and stroke width
- **Hold to snap:** draw a rough circle, box, diamond or straight line with the pen, then hold still for a moment before lifting and it snaps into a clean shape. Strokes you lift normally are never changed. Turn it off in the style panel
- Labels inside shapes and on arrows: double-click (or double-tap) a shape to write in it

**Editing**
- Resize and rotate handles (hold Shift to keep proportions or snap rotation to 15°)
- Multi-select by dragging a box or Shift-clicking; move, delete, restyle together
- Copy, cut, paste and duplicate; bring forward / send backward
- Arrows and lines stick to shapes and follow them when the shapes move
- Undo / redo, auto-save in your browser

**Presenting and sharing**
- **Frames and presentation mode:** draw frames (F) around parts of the board, press Present, and step through them as slides
- **Laser pointer** (K), also active while presenting
- **Share by link:** the whole drawing is compressed into the link, so nothing is uploaded anywhere
- **Mermaid import:** paste a `flowchart` / `graph` diagram (or use Menu → Import Mermaid) to get it as editable sketched shapes
- Export to PNG or SVG
- Dark mode, infinite canvas, pinch-zoom on touch screens

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| V | Select |
| H / hold Space | Pan |
| R / D / O | Rectangle / Diamond / Ellipse |
| A / L | Arrow / Line |
| P | Pen |
| T | Text |
| N | Sticky note |
| F | Frame |
| K | Laser pointer |
| E | Eraser |
| Double-click | Write text, or edit a shape's label |
| Enter | Edit the selected shape's label |
| Shift while drawing | Square / circle, or 15° steps for lines |
| Ctrl/Cmd + Z / Shift + Z | Undo / Redo |
| Ctrl/Cmd + A | Select all |
| Ctrl/Cmd + C / X / V | Copy / Cut / Paste |
| Ctrl/Cmd + D | Duplicate |
| Ctrl/Cmd + ] / [ | Bring forward / Send backward (add Shift for front / back) |
| Arrow keys | Nudge selection (Shift for 10px) |
| Delete / Backspace | Delete selection |
| While presenting: → / ← / Esc | Next / Previous / Exit |

## Project layout

```
src/
  App.tsx         State, pointer and keyboard handling, history, dialogs
  components.tsx  Toolbar, style panel, menu, toast, dialog, presentation bar
  constants.ts    Tools, palettes and shared UI types
  scene.ts        Canvas rendering, selection handles, PNG export
  geometry.ts     Bounds, rotation, hit testing, shape outlines
  ops.ts          Arrow binding, resize/rotate, clone, layer order, loading saved data
  recognize.ts    Hold to snap: classifies pen strokes as lines, boxes, diamonds or ellipses
  share.ts        Share links (compressed into the URL fragment)
  mermaid.ts      Mermaid flowchart import and layout
  svg.ts          SVG export
  laser.ts        Laser pointer trail
  text.ts         Fonts, text measuring and wrapping
  types.ts        Element and view types
```

## Ideas for next steps

- Live collaboration (e.g. Yjs with a hosted sync server)
- AI: text-to-diagram and sketch cleanup (needs a small serverless function to keep the API key private)
- Image paste and upload
- Group / ungroup, alignment tools

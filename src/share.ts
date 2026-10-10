import { round } from './geometry'
import { restoreElements } from './ops'
import type { SkrawlElement } from './types'

/** Shared drawings travel in the URL fragment, which browsers never send to the server. */
const PREFIX = '#s='

function toBase64Url(bytes: Uint8Array) {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

/** Rounds coordinates and drops ids that only matter locally, to keep links short. */
function compact(elements: SkrawlElement[]) {
  return elements.map((el) => ({
    ...el,
    x: round(el.x),
    y: round(el.y),
    width: round(el.width),
    height: round(el.height),
    angle: round(el.angle),
    points: el.points?.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]),
  }))
}

export async function createShareLink(elements: SkrawlElement[]): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(compact(elements)))
  const packed = await pipe(json, new CompressionStream('deflate-raw'))
  const url = new URL(window.location.href)
  url.hash = ''
  return url.toString() + PREFIX + toBase64Url(packed)
}

export const hasSharedScene = () => window.location.hash.startsWith(PREFIX)

/** Reads a drawing from the current URL, or returns null if there is none or it can't be read. */
export async function readSharedScene(): Promise<SkrawlElement[] | null> {
  if (!hasSharedScene()) return null
  try {
    const bytes = await pipe(fromBase64Url(window.location.hash.slice(PREFIX.length)), new DecompressionStream('deflate-raw'))
    return restoreElements(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

/** Removes the drawing from the address bar so a refresh doesn't load it again over later edits. */
export function clearSharedScene() {
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

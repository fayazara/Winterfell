/**
 * Turns the painted hand images in /public/sprites into game sprites:
 * crop to content, scale to the low-res framebuffer, harden the alpha, and
 * tag materials (steel → metal glint, glowing rag → ember flicker).
 */
import type { Sprite } from "./sprites"

export interface HandSprite extends Sprite {
  /** torch only: where the burning head sits (sprite pixels) */
  anchor?: { x: number; y: number; w: number }
}

export const HAND_IMAGES = {
  torch: "/sprites/hand-torch.png",
  sword: "/sprites/hand-sword.png",
} as const

export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}

const bboxCache = new WeakMap<HTMLImageElement, { x: number; y: number; w: number; h: number }>()

export function contentBox(img: HTMLImageElement) {
  const cached = bboxCache.get(img)
  if (cached) return cached
  const c = document.createElement("canvas")
  c.width = img.naturalWidth
  c.height = img.naturalHeight
  const g = c.getContext("2d")!
  g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data
  let x0 = c.width
  let y0 = c.height
  let x1 = 0
  let y1 = 0
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 40) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  const box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
  bboxCache.set(img, box)
  return box
}

export function buildHandSprite(img: HTMLImageElement, targetH: number, kind: "torch" | "sword"): HandSprite {
  const box = contentBox(img)
  const h = Math.max(8, Math.round(targetH))
  const w = Math.max(4, Math.round((box.w * h) / box.h))
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const g = c.getContext("2d")!
  g.imageSmoothingEnabled = true
  g.imageSmoothingQuality = "high"
  g.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, w, h)
  const src = g.getImageData(0, 0, w, h).data
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = src[i * 4 + 3]
    if (a < 120) continue
    const r = src[i * 4]
    const gg = src[i * 4 + 1]
    const b = src[i * 4 + 2]
    let tag = 255
    const mx = Math.max(r, gg, b)
    const mn = Math.min(r, gg, b)
    const y = Math.floor(i / w)
    if (kind === "sword" && mx - mn < 28 && mx > 100) tag = 200
    if (kind === "torch" && y < h * 0.25 && r > 170 && r - b > 100 && gg < 170) tag = 150
    data.set([r, gg, b, tag], i * 4)
  }

  const sprite: HandSprite = { w, h, k: 1, data }
  if (kind === "torch") {
    // the burning head: opaque span across the top few percent of rows
    let top = 0
    while (top < h && !rowHas(data, w, top)) top++
    const band = Math.max(2, Math.round(h * 0.05))
    let x0 = w
    let x1 = 0
    for (let y = top; y < Math.min(h, top + band); y++)
      for (let x = 0; x < w; x++)
        if (data[(y * w + x) * 4 + 3]) {
          x0 = Math.min(x0, x)
          x1 = Math.max(x1, x)
        }
    sprite.anchor = { x: (x0 + x1 + 1) / 2, y: top, w: Math.max(4, x1 - x0 + 1) }
  }
  return sprite
}

function rowHas(data: Uint8Array, w: number, y: number) {
  for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3]) return true
  return false
}

/**
 * A baked ground map over the playable valley, 1 texel per metre:
 *
 *   R = horizon ambient occlusion: for each spot, how much sky the nearby
 *       terrain hides (8 directions × 4 distances), the technique BRICKLAND
 *       uses for its terrain. Valleys, the lake bed and cliff feet darken.
 *   G = soft shadows of the painted props (trees, rocks, cottages) cast along
 *       the sun. Billboards cannot shadow themselves in the raymarcher, so we
 *       stamp their shadows here and re-bake when the sun moves.
 */
import type { Prop } from "./props"
import { clamp, terrainHeight } from "./world"

export const GROUND = { x0: -200, z0: -320, w: 400, h: 420 }

const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]
const DISTS = [2, 4, 8, 16]

export function bakeHeights() {
  const { x0, z0, w, h } = GROUND
  const hs = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) hs[j * w + i] = terrainHeight(x0 + i + 0.5, z0 + j + 0.5)
  return hs
}

export function bakeAO(hs: Float32Array) {
  const { w, h } = GROUND
  const ao = new Uint8Array(w * h)
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= w || j >= h ? NaN : hs[j * w + i])
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const y = hs[j * w + i]
      let sum = 0
      let counted = 0
      for (const [dx, dz] of DIRS) {
        const step = Math.hypot(dx, dz)
        let occ = 0
        let any = false
        for (const d of DISTS) {
          const nh = at(i + dx * d, j + dz * d)
          if (!Number.isFinite(nh)) continue
          any = true
          const rise = nh - y
          if (rise <= 0) continue
          const sinElev = rise / Math.hypot(rise, d * step)
          occ = Math.max(occ, sinElev / (1 + (d / 2 - 1) * 0.25))
        }
        if (any) {
          sum += occ
          counted++
        }
      }
      const t = clamp((counted ? sum / counted : 0) * 1.7, 0, 1)
      ao[j * w + i] = Math.round((0.42 + 0.58 * (1 - t)) * 255)
    }
  return ao
}

/** Footprint radius and shadow strength per prop kind. */
function shadowShape(p: Prop) {
  if (p.key.startsWith("pine")) return { r: 1.2 + p.h * 0.07, top: 1, base: 0.25, dark: 0.55, cone: true }
  if (p.key.startsWith("tree")) return { r: 2.4 + p.h * 0.08, top: 1, base: 0.35, dark: 0.55, cone: false }
  if (p.key.startsWith("cottage")) return { r: 2.6, top: 0.9, base: 0, dark: 0.6, cone: false }
  if (p.key.startsWith("rock")) return { r: p.h * 0.5, top: 0.8, base: 0, dark: 0.5, cone: false }
  if (p.key.startsWith("bush")) return { r: p.h * 0.45, top: 1, base: 0, dark: 0.35, cone: false }
  if (p.key === "horse") return { r: 0.8, top: 0.7, base: 0, dark: 0.4, cone: false }
  return null
}

/**
 * Stamp each prop's shadow as a chain of soft discs from its foot along the
 * sun's ground direction, like a cylinder/cone of foliage would cast.
 */
export function bakeShadows(props: Prop[], sun: [number, number, number]) {
  const { x0, z0, w, h } = GROUND
  const sh = new Uint8Array(w * h).fill(255)
  const sy = Math.max(sun[1], 0.12)
  // ground offset per metre of height (shadow points away from the sun)
  const ox = -sun[0] / sy
  const oz = -sun[2] / sy
  for (const p of props) {
    const s = shadowShape(p)
    if (!s) continue
    const steps = 8
    for (let k = 0; k <= steps; k++) {
      const t = s.base + (s.top - s.base) * (k / steps)
      const len = Math.min(p.h * t, 26)
      const cx = p.x + ox * len - x0
      const cz = p.z + oz * len - z0
      const r = s.cone ? s.r * (1.15 - t * 0.9) + 0.2 : s.r * (k === 0 ? 0.7 : 1)
      const i0 = Math.max(0, Math.floor(cx - r - 1))
      const i1 = Math.min(w - 1, Math.ceil(cx + r + 1))
      const j0 = Math.max(0, Math.floor(cz - r - 1))
      const j1 = Math.min(h - 1, Math.ceil(cz + r + 1))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(i + 0.5 - cx, j + 0.5 - cz) / r
          if (d >= 1) continue
          const v = 1 - s.dark * (1 - d * d)
          const idx = j * w + i
          sh[idx] = Math.min(sh[idx], Math.round(v * 255))
        }
    }
  }
  return sh
}

/** Interleave into an RGBA texture payload. */
export function packGround(ao: Uint8Array, sh: Uint8Array, out?: Uint8Array) {
  const n = ao.length
  const data = out ?? new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    data[i * 4] = ao[i]
    data[i * 4 + 1] = sh[i]
    data[i * 4 + 2] = 0
    data[i * 4 + 3] = 255
  }
  return data
}

/**
 * Pixel-art hands, painted procedurally as 2.5D shapes.
 *
 * Every part (finger, knuckle, forearm, torch shaft, blade) is a capsule,
 * ellipsoid or custom surface with a depth and a normal. A small z-buffer
 * keeps overlaps right (fingers in front of the shaft, thumb over fingers),
 * each pixel is lit with a fixed key light, and the result is snapped to a
 * per-material colour ramp so it stays pixel art rather than smooth CG.
 *
 * Shapes are authored in *logical* units and rasterised at `k`x detail, so
 * the hands keep their on-screen size while gaining detail at higher res.
 *
 * Alpha doubles as a material tag for the sprite shader:
 *   255 = matte, 200 = metal (moving glint), 150 = ember (self-lit).
 */

export interface Sprite {
  /** size in detail pixels (logical size × k) */
  w: number
  h: number
  /** detail multiplier */
  k: number
  data: Uint8Array
}

type RGBA = [number, number, number, number]
type V3 = [number, number, number]

const MATTE = 255
const METAL = 200
const EMBER = 150

const hex = (h: string, a = MATTE): RGBA => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
}
const hash = (x: number, y: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
const vn = (x: number, y: number) => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy)
  const b = hash(ix + 1, iy)
  const c = hash(ix, iy + 1)
  const d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

interface Material {
  ramp: RGBA[]
  /** extra brightness from surface texture, given logical x/y */
  tex?: (x: number, y: number) => number
  spec?: number
  /** override material per pixel (engravings, embers) */
  swap?: (x: number, y: number) => Material | null
}

const ramp = (cols: string[], tag = MATTE) => cols.map((c) => hex(c, tag))

const SKIN: Material = {
  ramp: ramp(["#2e1a12", "#4a281a", "#6a3a26", "#8e5236", "#b06e48", "#cc8c60", "#e2ac80"]),
  tex: (x, y) => (vn(x * 0.9, y * 0.9) - 0.5) * 0.08,
  spec: 0.12,
}
const NAIL: Material = { ramp: ramp(["#6a3a26", "#b06e48", "#cc8c60", "#e2ac80", "#e2d8c0"]), spec: 0.4 }
const WOOD: Material = {
  ramp: ramp(["#140c08", "#2e1e16", "#46301e", "#604228", "#7c5634", "#9a6e44"]),
  tex: (x, y) =>
    (vn(x * 1.6, y * 0.18) - 0.5) * 0.55 + (hash(Math.floor(x * 2), Math.floor(y / 5)) > 0.9 ? -0.25 : 0),
}
const EMBERS: Material = { ramp: ramp(["#82342a", "#c8643a", "#f0a040", "#f8d070"], EMBER) }
const RAG: Material = {
  ramp: ramp(["#1a1210", "#2e1e16", "#46301e", "#7c5634", "#9a6e44", "#b88a5a"]),
  tex: (x, y) => Math.sin((y + x * 0.35) * 1.4) * 0.16 + (vn(x * 1.5, y * 1.5) - 0.5) * 0.2,
}
const CHAR: Material = {
  ramp: ramp(["#08080c", "#1a1210", "#2e1e16", "#46301e"]),
  tex: (x, y) => (vn(x * 2, y * 2) - 0.5) * 0.3,
  swap: (x, y) => (hash(Math.floor(x * 1.5), Math.floor(y * 1.5)) > 0.8 ? EMBERS : null),
}
const STEEL: Material = {
  ramp: ramp(["#24202e", "#3a3e4a", "#5a6070", "#7e8696", "#a6aebc", "#d0d6e0"], METAL),
  spec: 0.9,
}
const BRASS: Material = {
  ramp: ramp(["#2e1e16", "#604228", "#9a6e44", "#c0b060", "#e0d088"], METAL),
  spec: 0.6,
}
const GRIP: Material = {
  ramp: ramp(["#140c08", "#2e1e16", "#46301e", "#604228", "#7c5634"]),
  tex: (x, y) => (Math.floor(y * 0.9 + x * 0.6) % 2 === 0 ? 0.12 : -0.12),
}
const LEATHER: Material = {
  ramp: ramp(["#140c08", "#2e1e16", "#46301e", "#604228", "#7c5634", "#9a6e44"]),
  tex: (x, y) => (vn(x * 1.2, y * 1.2) - 0.5) * 0.15,
}
/** Leather bracer with brass knotwork tooled into it. */
const knot = (x: number, y: number) =>
  Math.abs(Math.sin(x * 0.7 + 1.8 * Math.sin(y * 0.33))) * Math.abs(Math.sin(y * 0.7 - 1.8 * Math.sin(x * 0.33)))
const BRACER: Material = { ...LEATHER, swap: (x, y) => (knot(x, y) < 0.09 ? BRASS : null) }
const SLEEVE: Material = {
  ramp: ramp(["#16141e", "#24202e", "#322c40", "#443c56", "#574e6c"]),
  tex: (x, y) => Math.sin((x - y * 0.4) * 0.9) * 0.1,
}

const OUTLINE = hex("#08080c")
const LIGHT = norm3([-0.45, -0.7, 0.55])
const HALF = norm3([LIGHT[0], LIGHT[1], LIGHT[2] + 1])

class Painter {
  W: number
  H: number
  data: Uint8Array
  z: Float32Array
  constructor(
    public w: number,
    public h: number,
    public k: number,
  ) {
    this.W = w * k
    this.H = h * k
    this.data = new Uint8Array(this.W * this.H * 4)
    this.z = new Float32Array(this.W * this.H).fill(-1e9)
  }

  private shade(m: Material, n: V3, X: number, Y: number, x: number, y: number) {
    const sw = m.swap?.(x, y)
    if (sw) m = sw
    const dif = Math.max(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2], 0)
    const rim = Math.pow(1 - Math.max(n[2], 0), 3) * 0.18
    const sp = Math.pow(Math.max(n[0] * HALF[0] + n[1] * HALF[1] + n[2] * HALF[2], 0), 28) * (m.spec ?? 0)
    // tiny ordered dither so ramps blend instead of banding into blobs
    const dith = ((X + Y * 2) % 4) / 4 - 0.375
    const v = 0.18 + dif * 0.72 + rim + sp + (m.tex?.(x, y) ?? 0) + dith * 0.07
    const r = m.ramp
    return r[Math.max(0, Math.min(r.length - 1, Math.floor(v * r.length)))]
  }

  /** Visit every detail pixel in a logical bbox, with logical centre coords. */
  private scan(x0: number, y0: number, x1: number, y1: number, fn: (X: number, Y: number, x: number, y: number) => void) {
    const k = this.k
    for (let Y = Math.max(0, Math.floor(y0 * k)); Y <= Math.min(this.H - 1, Math.ceil(y1 * k)); Y++)
      for (let X = Math.max(0, Math.floor(x0 * k)); X <= Math.min(this.W - 1, Math.ceil(x1 * k)); X++)
        fn(X, Y, (X + 0.5) / k, (Y + 0.5) / k)
  }

  private plot(X: number, Y: number, z: number, n: V3, m: Material, x: number, y: number) {
    const i = Y * this.W + X
    if (z <= this.z[i]) return
    this.z[i] = z
    this.data.set(this.shade(m, n, X, Y, x, y), i * 4)
  }

  /** Tapered capsule from a to b; za/zb = depth of the axis. */
  capsule(ax: number, ay: number, bx: number, by: number, ra: number, rb: number, za: number, zb: number, m: Material) {
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy || 1e-6
    const R = Math.max(ra, rb)
    this.scan(Math.min(ax, bx) - R, Math.min(ay, by) - R, Math.max(ax, bx) + R, Math.max(ay, by) + R, (X, Y, x, y) => {
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      const ox = x - (ax + dx * t)
      const oy = y - (ay + dy * t)
      const r = ra + (rb - ra) * t
      const d2 = ox * ox + oy * oy
      if (d2 > r * r) return
      const hz = Math.sqrt(r * r - d2)
      this.plot(X, Y, za + (zb - za) * t + hz, norm3([ox / r, oy / r, hz / r]), m, x, y)
    })
  }

  ellipsoid(cx: number, cy: number, rx: number, ry: number, rz: number, z0: number, m: Material) {
    this.scan(cx - rx, cy - ry, cx + rx, cy + ry, (X, Y, x, y) => {
      const u = (x - cx) / rx
      const v = (y - cy) / ry
      const d = u * u + v * v
      if (d > 1) return
      const hz = Math.sqrt(1 - d)
      this.plot(X, Y, z0 + rz * hz, norm3([(u * rz) / rx, (v * rz) / ry, hz]), m, x, y)
    })
  }

  /** Arbitrary surface: fn returns depth + normal, or null for empty. */
  surface(x0: number, y0: number, x1: number, y1: number, m: Material, fn: (x: number, y: number) => { z: number; n: V3 } | null) {
    this.scan(x0, y0, x1, y1, (X, Y, x, y) => {
      const s = fn(x, y)
      if (s) this.plot(X, Y, s.z, s.n, m, x, y)
    })
  }

  /** Crease where a surface dips behind its neighbour, then a silhouette outline. */
  private finish() {
    const { W, H, z, data } = this
    const src = new Uint8Array(data)
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) {
        const i = Y * W + X
        if (!src[i * 4 + 3]) continue
        let crease = false
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = X + dx
          const ny = Y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const j = ny * W + nx
          if (src[j * 4 + 3] && z[j] - z[i] > 1.6) crease = true
        }
        if (crease) {
          data[i * 4] = Math.round(src[i * 4] * 0.55)
          data[i * 4 + 1] = Math.round(src[i * 4 + 1] * 0.5)
          data[i * 4 + 2] = Math.round(src[i * 4 + 2] * 0.5)
        }
      }
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : src[(y * W + x) * 4 + 3])
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) {
        if (a(X, Y)) continue
        if (a(X + 1, Y) || a(X - 1, Y) || a(X, Y + 1) || a(X, Y - 1)) data.set(OUTLINE, (Y * W + X) * 4)
      }
  }

  toSprite(): Sprite {
    this.finish()
    return { w: this.W, h: this.H, k: this.k, data: this.data }
  }
}

/**
 * Fingers wrapped around a grip. `rows` are the finger centres on the grip,
 * `across` points from the knuckle side to the fingertip side.
 */
function paintGrip(p: Painter, rows: [number, number][], across: [number, number], reach: number, zFront: number) {
  const radii = [3.5, 3.6, 3.4, 2.9]
  rows.forEach(([cx, cy], i) => {
    const r = radii[i]
    const kx = cx - across[0] * reach * 0.55
    const ky = cy - across[1] * reach * 0.55
    const tx = cx + across[0] * reach * 0.45
    const ty = cy + across[1] * reach * 0.45
    p.capsule(kx, ky, tx, ty, r, r * 0.92, zFront, zFront - 0.5, SKIN)
    p.capsule(tx, ty, tx + across[0] * 2.2, ty + across[1] * 2.2 + 1.4, r * 0.88, r * 0.75, zFront - 1, zFront - 3.5, SKIN)
    p.ellipsoid(kx - across[0] * 0.8, ky - 0.6, r * 0.85, r * 0.8, 1.8, zFront + r * 0.55, SKIN)
  })
}

/** Bare wrist, engraved leather bracer, then cloth sleeve off the edge. */
function paintForearm(p: Painter, ax: number, ay: number, bx: number, by: number, r0: number, z: number) {
  const L = Math.hypot(bx - ax, by - ay)
  const ux = (bx - ax) / L
  const uy = (by - ay) / L
  const at = (t: number): [number, number] => [ax + ux * t, ay + uy * t]
  const w1 = at(10)
  p.capsule(ax, ay, w1[0], w1[1], r0 * 0.72, r0 * 0.8, z, z, SKIN)
  const b0 = at(9)
  const b1 = at(34)
  p.capsule(b0[0], b0[1], b1[0], b1[1], r0 * 0.95, r0 * 1.08, z + 0.5, z + 0.5, BRACER)
  p.capsule(b0[0] - uy * r0, b0[1] + ux * r0, b0[0] + uy * r0, b0[1] - ux * r0, 1.3, 1.3, z + r0 * 0.9, z + r0 * 0.9, LEATHER)
  const s1 = at(L + 20)
  p.capsule(b1[0], b1[1], s1[0], s1[1], r0 * 1.12, r0 * 1.25, z, z, SLEEVE)
}

/** Torch head offset (logical px). */
const HEAD = 16

export function makeTorchSprite(k = 1): Sprite {
  const p = new Painter(56, 140, k)
  const sx = 30
  const fy = 74 + HEAD * 0.3

  paintForearm(p, 22, fy + 24, 2, 150, 10, -8)
  p.ellipsoid(20, fy + 10, 9.5, 13.5, 5.5, -1, SKIN)
  p.capsule(19, fy + 18, 15, fy + 30, 8, 8.5, -3, -4, SKIN)

  // gnarled wooden shaft with a knot
  p.capsule(sx + 1, 14 + HEAD, sx - 1, 142, 3.9, 4.4, 0, 0, WOOD)
  p.ellipsoid(sx - 2.5, 112, 1.6, 2.4, 1.2, 3.2, WOOD)

  // rag-wrapped head, charred on top, tied with strips
  const top = 4 + HEAD * 0.4
  p.capsule(sx + 1, top, sx + 1, 22 + HEAD, 6.8, 6, 0, 0, RAG)
  p.capsule(sx + 1, top - 2, sx + 1, top + 5, 6.4, 6.6, 0.5, 0.5, CHAR)
  for (const [y0, y1] of [[12, 15], [20, 22], [27, 29]] as const)
    p.capsule(sx - 6, y0 + HEAD * 0.5, sx + 7.5, y1 + HEAD * 0.5, 1.3, 1.2, 6, 6.2, RAG)
  p.capsule(sx + 6, 22 + HEAD * 0.6, sx + 10, 31 + HEAD * 0.6, 1.4, 0.8, 4, 3, RAG)

  // fingers wrap the shaft: knuckles left, tips curling round to the right
  paintGrip(p, [[sx - 2, fy], [sx - 2, fy + 7], [sx - 2.5, fy + 14], [sx - 3, fy + 20]], [1, 0.08], 19, 7)
  // thumb over the index finger
  p.capsule(17, fy - 2, 27, fy - 7, 3.8, 3.4, 9, 10, SKIN)
  p.capsule(27, fy - 7, 34, fy - 6, 3.3, 2.8, 10, 9.5, SKIN)
  p.ellipsoid(35, fy - 6.2, 2.3, 1.8, 1, 11, NAIL)

  return p.toSprite()
}

export function makeSwordSprite(k = 1): Sprite {
  const W = 92
  const H = 200
  const p = new Painter(W, H, k)
  const B: [number, number] = [52, 130]
  const T: [number, number] = [34, 0]
  const len = Math.hypot(T[0] - B[0], T[1] - B[1])
  const dir: [number, number] = [(T[0] - B[0]) / len, (T[1] - B[1]) / len]
  const perp: [number, number] = [-dir[1], dir[0]] // points right
  const at = (t: number, s = 0): [number, number] => [B[0] + dir[0] * t + perp[0] * s, B[1] + dir[1] * t + perp[1] * s]

  const wr = at(-30, 9)
  paintForearm(p, wr[0], wr[1], W + 14, H + 30, 11, -9)
  const bh = at(-16, 8)
  p.ellipsoid(bh[0], bh[1], 8.5, 13.5, 5.5, -1, SKIN)

  const g0 = at(-2)
  const g1 = at(-29)
  p.capsule(g0[0], g0[1], g1[0], g1[1], 2.9, 3.1, 0, 0, GRIP)
  const pm = at(-34)
  p.ellipsoid(pm[0], pm[1], 4.3, 4.6, 3.5, 1, BRASS)
  const pm2 = at(-38.5)
  p.ellipsoid(pm2[0], pm2[1], 2, 1.6, 1.5, 3, BRASS)

  // blade: bevelled edges, a fuller down the middle, tapering to the point
  const hw = (t: number) => {
    const base = 4.4 - 1.6 * (t / len)
    return t > len - 18 ? (base * (len - t)) / 18 : base
  }
  p.surface(0, 0, W, B[1] + 3, STEEL, (x, y) => {
    const ox = x - B[0]
    const oy = y - B[1]
    const t = ox * dir[0] + oy * dir[1]
    if (t < 0 || t > len) return null
    const s = ox * perp[0] + oy * perp[1]
    const w = hw(t)
    if (Math.abs(s) > w) return null
    const u = s / Math.max(w, 0.4)
    let tilt = u < 0 ? -0.75 : 0.75
    if (Math.abs(u) < 0.42) tilt = t < len * 0.72 ? (Math.abs(u) < 0.16 ? u * 2.5 : -u * 0.6) : u * 0.3
    return { z: 2 - Math.abs(u) * 0.8, n: norm3([perp[0] * tilt, perp[1] * tilt, 1]) }
  })
  // crossguard with drooping quillons
  const gl = at(-0.5, -15)
  const gr = at(-0.5, 15)
  const gc = at(-0.5)
  p.capsule(gl[0], gl[1] + 1.5, gc[0], gc[1], 2, 2.6, 4, 4.5, STEEL)
  p.capsule(gc[0], gc[1], gr[0], gr[1] + 1.5, 2.6, 2, 4.5, 4, STEEL)
  p.ellipsoid(gc[0], gc[1] + 0.5, 3.6, 3, 2.5, 4.5, BRASS)
  for (const e of [at(-0.5, -17.5), at(-0.5, 17.5)]) p.ellipsoid(e[0], e[1] + 2, 2.4, 2.6, 2, 4, BRASS)

  // fingers wrap from the knuckles on the right across to the left
  const rows = [-6, -12.6, -19.2, -25].map((t) => at(t, 0.5))
  paintGrip(p, rows, [-perp[0], -perp[1]], 18, 6.5)
  const th0 = at(-5, 10)
  const th1 = at(-3, -1)
  const th2 = at(-3.2, -6)
  p.capsule(th0[0], th0[1], th1[0], th1[1], 3.9, 3.4, 9, 10, SKIN)
  p.capsule(th1[0], th1[1], th2[0], th2[1], 3.3, 2.8, 10, 9.5, SKIN)
  p.ellipsoid(th2[0] - 0.5, th2[1], 2, 1.9, 1, 11, NAIL)

  return p.toSprite()
}

/** Flame anchor in torch-sprite logical pixels: top of the rag head. */
export const TORCH_FLAME_ANCHOR = { x: 31, y: 6 + HEAD * 0.4 }
export const FLAME_SIZE = { w: 26, h: 46 }

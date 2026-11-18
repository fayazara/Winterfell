/**
 * World layout shared by the CPU (camera, walking) and the GPU (scene shader).
 *
 * Every function here has a GLSL twin in `shaders.ts`. Keep them in sync:
 * the camera stands on `terrainHeight()` while the shader draws the ground
 * with `terrain()`, so a mismatch makes the knight float or sink.
 */

export const fract = (x: number) => x - Math.floor(x)
export const clamp = (x: number, a: number, b: number) =>
  Math.min(Math.max(x, a), b)
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Dave Hoskins' hash12 — identical formula to the GLSL version. */
export function hash12(x: number, y: number) {
  let p3x = fract(x * 0.1031)
  let p3y = fract(y * 0.1031)
  let p3z = fract(x * 0.1031)
  const d =
    p3x * (p3y + 33.33) + p3y * (p3z + 33.33) + p3z * (p3x + 33.33)
  p3x += d
  p3y += d
  p3z += d
  return fract((p3x + p3y) * p3z)
}

export function vnoise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash12(ix, iy)
  const b = hash12(ix + 1, iy)
  const c = hash12(ix, iy + 1)
  const d = hash12(ix + 1, iy + 1)
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy)
}

export function fbm(x: number, y: number, octaves: number) {
  let a = 0.5
  let s = 0
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.2
    a *= 0.5
  }
  return s
}

/** Centre line of the winding path, as x for a given z. */
export function pathX(z: number) {
  return Math.sin(z * 0.045) * 7 + Math.sin(z * 0.017 + 1.3) * 10
}

export const CASTLE_Z = -190
export const CASTLE_X = pathX(CASTLE_Z)

/** Walkable z range along the path (the castle crag sits beyond the far end). */
export const PATH_START_Z = 34
export const PATH_END_Z = -112

function terrainBase(x: number, z: number) {
  return fbm(x * 0.035, z * 0.035, 4) * 9 - 3
}

function ridged(x: number, z: number) {
  let a = 0.5
  let s = 0
  for (let i = 0; i < 3; i++) {
    s += a * (1 - Math.abs(2 * vnoise(x, z) - 1))
    x = x * 2.03 + 17.1
    z = z * 2.03 + 9.2
    a *= 0.5
  }
  return s
}

/**
 * Valley floor with the path, rising walls either side, a high start that
 * descends into the valley, a rocky crag under the castle and a far range.
 */
export function terrainHeight(x: number, z: number) {
  const px = pathX(z)
  const d = Math.abs(x - px)
  let h = terrainBase(x, z) + fbm(x * 0.15 + 5.3, z * 0.15 + 1.7, 2)
  h += smoothstep(20, 150, d) * (30 + 25 * vnoise(x * 0.012, z * 0.012))
  const m = 1 - smoothstep(1.5, 4, d)
  if (m > 0) h = lerp(h, terrainBase(px, z) - 0.2, m)
  h += 16 * smoothstep(-50, 40, z)
  h += smoothstep(-240, -420, z) * (50 + 170 * ridged(x * 0.005, z * 0.005))
  const cx = x - CASTLE_X
  const cz = z - CASTLE_Z
  const hm = Math.exp(-(cx * cx + cz * cz) / 2000)
  h += hm * (58 + 14 * (ridged(x * 0.06, z * 0.06) - 0.5))
  return h
}

export const CASTLE_Y = terrainHeight(CASTLE_X, CASTLE_Z) - 3

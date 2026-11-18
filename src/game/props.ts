/**
 * Painted world props (trees, bushes, rocks, cottages, the castle) drawn as
 * upright billboards, Daggerfall-style. Images are packed into one atlas;
 * placement is deterministic so the valley looks the same every visit.
 */
import { contentBox, loadImage } from "./handImages"
import { CASTLE_X, CASTLE_Y, CASTLE_Z, hash12, lerp, pathX, smoothstep, terrainHeight } from "./world"

const BASE = "/sprites/world/"

export const PROP_KEYS = [
  "pine_0", "pine_1", "pine_2", "tree_0", "tree_1",
  "bush_0", "bush_1", "bush_2", "rock_0", "rock_1",
  "cottage_0", "cottage_1", "castle", "horse",
] as const
export type PropKey = (typeof PROP_KEYS)[number]

export const SKY_URL = BASE + "sky.jpg"

export interface AtlasEntry {
  u0: number
  v0: number
  u1: number
  v1: number
  /** width / height of the visible content */
  aspect: number
}

export interface Atlas {
  canvas: HTMLCanvasElement
  entries: Record<PropKey, AtlasEntry>
}

const ATLAS = 2048

export async function buildAtlas(): Promise<Atlas> {
  const url = (k: PropKey) => (k === "horse" ? "/sprites/library/creatures/horse_brown.png" : `${BASE}${k}.png`)
  const imgs = await Promise.all(PROP_KEYS.map((k) => loadImage(url(k))))
  const canvas = document.createElement("canvas")
  canvas.width = ATLAS
  canvas.height = ATLAS
  const g = canvas.getContext("2d")!
  const entries = {} as Record<PropKey, AtlasEntry>
  // shelf packing, tallest first
  const order = imgs.map((img, i) => ({ img, key: PROP_KEYS[i], box: contentBox(img) }))
  order.sort((a, b) => b.box.h - a.box.h)
  let x = 0
  let y = 0
  let shelf = 0
  const pad = 2
  for (const { img, key, box } of order) {
    if (x + box.w + pad > ATLAS) {
      x = 0
      y += shelf + pad
      shelf = 0
    }
    g.drawImage(img, box.x, box.y, box.w, box.h, x, y, box.w, box.h)
    entries[key] = {
      u0: x / ATLAS,
      v0: y / ATLAS,
      u1: (x + box.w) / ATLAS,
      v1: (y + box.h) / ATLAS,
      aspect: box.w / box.h,
    }
    if (y + box.h > ATLAS) console.warn(`atlas overflow at ${key}`)
    x += box.w + pad
    shelf = Math.max(shelf, box.h)
  }
  return { canvas, entries }
}

export interface Prop {
  x: number
  y: number
  z: number
  h: number
  key: PropKey
  /** how far the top sways in the wind (m) */
  sway: number
  phase: number
}

const pick = <T,>(arr: readonly T[], r: number) => arr[Math.min(arr.length - 1, Math.floor(r * arr.length))]

/** Scatter props over the valley. Rules mirror the old SDF forest. */
export function placeProps(): Prop[] {
  const props: Prop[] = []
  const nearCastle = (x: number, z: number, r: number) => Math.hypot(x - CASTLE_X, z - CASTLE_Z) < r
  const ground = (x: number, z: number) => terrainHeight(x, z) - 0.35

  // trees: sparse meadows by the road, forest on the valley walls
  const CELL = 8
  for (let cz = -300; cz < 90; cz += CELL)
    for (let cx = -200; cx < 200; cx += CELL) {
      const i = cx / CELL
      const j = cz / CELL
      const r = hash12(i * 1.37 + 11.1, j * 1.37 + 11.1)
      const x = cx + CELL / 2 + (hash12(i + 3.1, j + 3.1) - 0.5) * CELL * 0.6
      const z = cz + CELL / 2 + (hash12(i + 7.7, j + 7.7) - 0.5) * CELL * 0.6
      const dp = Math.abs(x - pathX(z))
      const keep = lerp(0.86, 0.22, smoothstep(14, 40, dp))
      if (r < keep || dp < 5 + r * 3 || nearCastle(x, z, 45)) continue
      const kind = hash12(i + 21.7, j + 21.7)
      const pine = kind < 0.6
      const h = pine ? 9 + r * 8 : 7 + r * 5
      props.push({
        x, y: ground(x, z), z, h,
        key: pine ? pick(["pine_0", "pine_1", "pine_2"] as const, kind / 0.6) : pick(["tree_0", "tree_1"] as const, (kind - 0.6) / 0.4),
        sway: pine ? 0.25 : 0.35,
        phase: r * 40,
      })
    }

  // bushes and flowers along the road and in the meadows
  for (let cz = -200; cz < 80; cz += 5)
    for (let cx = -120; cx < 120; cx += 5) {
      const i = cx / 5 + 400
      const j = cz / 5 + 400
      const r = hash12(i * 2.3 + 1.7, j * 2.3 + 1.7)
      if (r < 0.7) continue
      const x = cx + 2.5 + (hash12(i + 5.5, j) - 0.5) * 4
      const z = cz + 2.5 + (hash12(i, j + 5.5) - 0.5) * 4
      const dp = Math.abs(x - pathX(z))
      if (dp < 3.2 || dp > 60 || nearCastle(x, z, 40)) continue
      props.push({
        x, y: ground(x, z) + 0.1, z, h: 0.9 + (r - 0.7) * 2.5,
        key: pick(["bush_0", "bush_1", "bush_2"] as const, hash12(i + 9, j + 9)),
        sway: 0.08, phase: r * 30,
      })
    }

  // boulders
  for (let cz = -220; cz < 80; cz += 11)
    for (let cx = -150; cx < 150; cx += 11) {
      const i = cx / 11 + 300
      const j = cz / 11 + 300
      const r = hash12(i * 3.1 + 2.2, j * 3.1 + 2.2)
      if (r < 0.84) continue
      const x = cx + 5.5 + (hash12(i + 1, j + 2) - 0.5) * 8
      const z = cz + 5.5 + (hash12(i + 2, j + 1) - 0.5) * 8
      const dp = Math.abs(x - pathX(z))
      if (dp < 3.8 || nearCastle(x, z, 30)) continue
      props.push({
        x, y: ground(x, z) + 0.2, z, h: 1.2 + (r - 0.84) * 14,
        key: pick(["rock_0", "rock_1"] as const, hash12(i + 4, j + 4)),
        sway: 0, phase: 0,
      })
    }

  // cottages scattered near the road
  const HC = 26
  for (let cz = -156; cz < 60; cz += HC)
    for (let cx = -130; cx < 130; cx += HC) {
      const i = Math.floor(cx / HC)
      const j = Math.floor(cz / HC)
      const r = hash12(i * 2.1 + 5, j * 2.1 + 5)
      if (r < 0.5) continue
      const x = cx + HC / 2 + (hash12(i + 1.3, j + 1.3) - 0.5) * HC * 0.35
      const z = cz + HC / 2 + (hash12(i + 8.1, j + 8.1) - 0.5) * HC * 0.35
      const dp = Math.abs(x - pathX(z))
      if (dp < 9 || dp > 60) continue
      props.push({
        x, y: ground(x, z) - 0.2, z, h: 5.5 + r * 2,
        key: r > 0.75 ? "cottage_0" : "cottage_1",
        sway: 0, phase: 0,
      })
    }

  // the castle on its crag
  props.push({ x: CASTLE_X, y: CASTLE_Y - 16, z: CASTLE_Z, h: 128, key: "castle", sway: 0, phase: 0 })
  return props
}

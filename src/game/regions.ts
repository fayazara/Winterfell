/**
 * Named places in the valley and landmarks to discover — the gentle
 * "what's over there?" pull BRICKLAND gets from its biomes and its sun gate.
 */
import { CASTLE_X, CASTLE_Z, COURT, lakeE, pathX } from "./world"

export interface Landmark {
  id: string
  name: string
  /** atlas key of its painted sprite */
  key: "shrine" | "signpost" | "well" | "stones" | "graves" | "arch" | "tower"
  x: number
  z: number
  /** sprite height, metres */
  h: number
  /** a line shown when you find it */
  line: string
}

const at = (z: number, offset: number) => ({ x: pathX(z) + offset, z })

export const LANDMARKS: Landmark[] = [
  { id: "shrine", name: "Wayside Shrine", key: "shrine", ...at(20, 5.5), h: 2.7, line: "A stone knight, praying for travellers who never came home." },
  { id: "signpost", name: "The Blank Signpost", key: "signpost", ...at(4, -3.8), h: 2.8, line: "Three arrows, no words. Every road leads somewhere." },
  { id: "well", name: "Hamlet Well", key: "well", ...at(-12, 12), h: 2.4, line: "The rope is new. Someone still draws water here." },
  { id: "tower", name: "Broken Watchtower", key: "tower", ...at(-30, 30), h: 13, line: "Its top is gone. It watched the road for a very long time." },
  { id: "stones", name: "Rune Stones", key: "stones", ...at(-70, -20), h: 4.6, line: "Older than the castle. The runes still glow, faintly." },
  { id: "graves", name: "Quiet Graves", key: "graves", ...at(-88, 9), h: 1.7, line: "Moss has taken the names. Only the crosses remain." },
  { id: "arch", name: "Gate to Nowhere", key: "arch", ...at(-102, -7), h: 6.2, line: "An arch with no wall. A door to something that is gone." },
]

/** How close you must come to find a landmark (m). */
export const DISCOVER_RADIUS = 10

export function regionAt(x: number, z: number) {
  if (x > COURT.x - 80) return "The Castle Courtyard"
  if (Math.hypot(x - CASTLE_X, z - CASTLE_Z) < 75) return "The Crag of Spires"
  if (lakeE(x, z) < 1.7) return "Stillwater Mere"
  const d = Math.abs(x - pathX(z))
  if (d > 32) return "Pinewood Deeps"
  if (z > 12) return "Hillside Meadows"
  if (z < -78) return "The Castle Road"
  return "Violet Vale"
}

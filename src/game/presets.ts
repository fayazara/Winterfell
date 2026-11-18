import { hexToRgb, type PaletteId, type RGB } from "./palettes"

type Vec3 = [number, number, number]

export interface Environment {
  skyTop: RGB
  horizon: RGB
  sunColor: RGB
  sunDir: Vec3
  ambient: RGB
  haze: RGB
  cloudLit: RGB
  cloudShade: RGB
  /** 0 = clear, 1 = overcast */
  cloudCover: number
  /** cloud band wreathing the crag and mountain feet */
  cloudBand: number
  /** how much the torch lights the world (low in daylight) */
  torchWorld: number
  windowGlow: number
  /** colour of the sun-catching cloud tops */
  cloudHi: RGB
  /** 0 = smooth painterly shading, 1 = hard cel-shaded light bands */
  cel: number
  /** 1 = use the painted sunset sky panorama */
  paintedSky: number
}

export interface Tweaks {
  fog: number
  mist: number
  torch: number
  wind: number
  dither: number
  palette: PaletteId
  /** preferred internal resolution for this look */
  pixelHeight?: number
}

export interface Preset {
  id: string
  name: string
  blurb: string
  env: Environment
  tweaks: Tweaks
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
}

export const PRESETS: Preset[] = [
  {
    id: "violetdusk",
    name: "Violet Dusk",
    blurb: "The sun sinks behind the peaks. Pink snow, gold-edged clouds, a long road.",
    env: {
      skyTop: hexToRgb("#2e2068"),
      horizon: hexToRgb("#f07ea0"),
      sunColor: hexToRgb("#ffe2b8"),
      sunDir: norm([0.6, 0.5, 0.15]),
      ambient: hexToRgb("#7462c4"),
      haze: hexToRgb("#6c58c8"),
      cloudLit: hexToRgb("#f2869e"),
      cloudHi: hexToRgb("#fcc070"),
      cloudShade: hexToRgb("#6e44a0"),
      cloudCover: 0.55,
      cloudBand: 0.25,
      torchWorld: 0.35,
      windowGlow: 0.7,
      cel: 1,
      paintedSky: 1,
    },
    tweaks: { fog: 0.0042, mist: 0.15, torch: 1, wind: 0.5, dither: 0.15, palette: "violet", pixelHeight: 280 },
  },
  {
    id: "mistypeaks",
    name: "Misty Peaks",
    blurb: "Clouds coil around the crag. The castle watches the valley road.",
    env: {
      skyTop: hexToRgb("#454c8c"),
      horizon: hexToRgb("#a29fc8"),
      sunColor: hexToRgb("#ffe6c0"),
      sunDir: norm([-0.5, 0.6, 0.45]),
      ambient: hexToRgb("#6670a8"),
      haze: hexToRgb("#8a88b8"),
      cloudLit: hexToRgb("#d6d0ea"),
      cloudHi: hexToRgb("#d6d0ea"),
      cel: 0,
      paintedSky: 0,
      cloudShade: hexToRgb("#666498"),
      cloudCover: 0.7,
      cloudBand: 0.5,
      torchWorld: 0.3,
      windowGlow: 0.6,
    },
    tweaks: { fog: 0.0026, mist: 0.3, torch: 1, wind: 0.6, dither: 1, palette: "painterly" },
  },
  {
    id: "valleyroad",
    name: "Valley Road",
    blurb: "A clear afternoon. Cottages, meadows, and a long way still to go.",
    env: {
      skyTop: hexToRgb("#3c62b8"),
      horizon: hexToRgb("#b6c8e6"),
      sunColor: hexToRgb("#fff2d8"),
      sunDir: norm([0.35, 0.75, 0.5]),
      ambient: hexToRgb("#7a90c8"),
      haze: hexToRgb("#a2b2d8"),
      cloudLit: hexToRgb("#f4f2f8"),
      cloudHi: hexToRgb("#f4f2f8"),
      cel: 0,
      paintedSky: 0,
      cloudShade: hexToRgb("#98a0c8"),
      cloudCover: 0.42,
      cloudBand: 0.3,
      torchWorld: 0.2,
      windowGlow: 0.2,
    },
    tweaks: { fog: 0.002, mist: 0.1, torch: 1, wind: 0.5, dither: 1, palette: "painterly" },
  },
  {
    id: "goldenhour",
    name: "Golden Hour",
    blurb: "Long shadows and amber light. The towers burn gold, then grey.",
    env: {
      skyTop: hexToRgb("#46549a"),
      horizon: hexToRgb("#eeb47c"),
      sunColor: hexToRgb("#ffb264"),
      sunDir: norm([-0.8, 0.22, 0.25]),
      ambient: hexToRgb("#76689a"),
      haze: hexToRgb("#d0a08a"),
      cloudLit: hexToRgb("#ffd2a2"),
      cloudHi: hexToRgb("#ffd2a2"),
      cel: 0,
      paintedSky: 0,
      cloudShade: hexToRgb("#86688c"),
      cloudCover: 0.5,
      cloudBand: 0.45,
      torchWorld: 0.5,
      windowGlow: 0.8,
    },
    tweaks: { fog: 0.003, mist: 0.25, torch: 1, wind: 0.4, dither: 1, palette: "painterly" },
  },
  {
    id: "morningmist",
    name: "Morning Mist",
    blurb: "Pale dawn. The valley is a sea of fog, the spires islands in it.",
    env: {
      skyTop: hexToRgb("#6878b0"),
      horizon: hexToRgb("#d6daec"),
      sunColor: hexToRgb("#fff0e0"),
      sunDir: norm([0.65, 0.3, 0.3]),
      ambient: hexToRgb("#8890b8"),
      haze: hexToRgb("#c6cae0"),
      cloudLit: hexToRgb("#f0f0f8"),
      cloudHi: hexToRgb("#f0f0f8"),
      cel: 0,
      paintedSky: 0,
      cloudShade: hexToRgb("#a0a4c4"),
      cloudCover: 0.3,
      cloudBand: 0.8,
      torchWorld: 0.3,
      windowGlow: 0.4,
    },
    tweaks: { fog: 0.0055, mist: 0.7, torch: 1, wind: 0.6, dither: 1, palette: "painterly" },
  },
]

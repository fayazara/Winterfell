import { useEffect, useRef } from "react"
import type { Engine } from "@/game/engine"
import { GROUND } from "@/game/groundMap"
import { LANDMARKS } from "@/game/regions"
import { loadSave } from "@/game/save"
import { CASTLE_X, CASTLE_Z, PATH_START_Z, WATER_Y, lakeE, pathX } from "@/game/world"

type RGB = [number, number, number]
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const C = {
  grassLo: hex("#2a6236"),
  grassHi: hex("#80ac44"),
  rock: hex("#6a5e7a"),
  snow: hex("#e6e0f0"),
  water: hex("#3e58a8"),
  shallow: hex("#6a86cc"),
  path: hex("#e2d4b4"),
  pine: hex("#143428"),
  tree: hex("#2f6a30"),
  stone: hex("#9a8aa4"),
  roof: hex("#c0482e"),
  castle: hex("#3a2468"),
}

/**
 * Bake the whole valley into a 1 px = 1 m image: hill-shaded ground, the lake,
 * the road, every tree as a dot, cottages and the castle.
 */
function bakeMap(heights: Float32Array, props: { x: number; z: number; key: string }[]) {
  const { x0, z0, w, h } = GROUND
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  const g = c.getContext("2d")!
  const img = g.createImageData(w, h)
  const at = (i: number, j: number) => heights[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = x0 + i + 0.5
      const z = z0 + j + 0.5
      const y = at(i, j)
      let col: RGB
      if (lakeE(x, z) < 1.2 && y < WATER_Y) col = y > WATER_Y - 0.4 ? C.shallow : C.water
      else if (Math.abs(x - pathX(z)) < 1.9 && z < PATH_START_Z + 30) col = C.path
      else {
        const t = Math.min(1, Math.max(0, (y + 2) / 50))
        col = [0, 1, 2].map((k) => C.grassLo[k] + (C.grassHi[k] - C.grassLo[k]) * t) as RGB
        if (y > 75) col = C.rock
        if (y > 150) col = C.snow
        // hill shading, lit from the upper left like the art
        const shade = Math.min(1.3, Math.max(0.55, 1 + ((at(i - 1, j) - at(i + 1, j)) + (at(i, j - 1) - at(i, j + 1))) * 0.22))
        col = col.map((v) => v * shade) as RGB
      }
      const o = (j * w + i) * 4
      img.data[o] = col[0]
      img.data[o + 1] = col[1]
      img.data[o + 2] = col[2]
      img.data[o + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const dot = (x: number, z: number, s: number, col: RGB) => {
    g.fillStyle = `rgb(${col.join(",")})`
    g.fillRect(Math.round(x - x0 - s / 2), Math.round(z - z0 - s / 2), s, s)
  }
  for (const p of props) {
    if (p.key.startsWith("pine")) dot(p.x, p.z, 3, C.pine)
    else if (p.key.startsWith("tree")) dot(p.x, p.z, 4, C.tree)
    else if (p.key.startsWith("rock")) dot(p.x, p.z, 2, C.stone)
    else if (p.key.startsWith("cottage")) dot(p.x, p.z, 5, C.roof)
  }
  dot(CASTLE_X, CASTLE_Z, 12, C.castle)
  dot(CASTLE_X, CASTLE_Z - 1, 4, C.roof)
  return c
}

export function Minimap(props: {
  engine: React.RefObject<Engine | null>
  expanded: boolean
  onToggle: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const baked = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let raf = 0
    let last = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      if (now - last < 90) return
      last = now
      const engine = props.engine.current
      const canvas = canvasRef.current
      if (!engine || !canvas) return
      if (!baked.current) {
        const data = engine.mapData()
        if (!data) return
        baked.current = bakeMap(data.heights, data.props)
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      if (canvas.width !== Math.round(cw * dpr)) {
        canvas.width = Math.round(cw * dpr)
        canvas.height = Math.round(ch * dpr)
      }
      const g = canvas.getContext("2d")!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.imageSmoothingEnabled = false
      const st = engine.status()
      const map = baked.current
      // local view: ~150 m across; expanded: the whole valley
      const scale = props.expanded ? Math.min(cw / GROUND.w, ch / GROUND.h) : 1.7
      const cx = props.expanded ? GROUND.x0 + GROUND.w / 2 : st.x
      const cz = props.expanded ? GROUND.z0 + GROUND.h / 2 : st.z
      const toX = (x: number) => cw / 2 + (x - cx) * scale
      const toY = (z: number) => ch / 2 + (z - cz) * scale
      g.fillStyle = "#1a1030"
      g.fillRect(0, 0, cw, ch)
      g.drawImage(map, toX(GROUND.x0), toY(GROUND.z0), GROUND.w * scale, GROUND.h * scale)

      // places Pell told you about, not yet found: a "?"
      const flags = loadSave().flags
      const hinted: Record<string, string> = { stones: "hint_stones", tower: "hint_tower", arch: "hint_arch" }
      for (const l of LANDMARKS) {
        if (engine.isFound(l.id) || !flags[hinted[l.id] ?? ""]) continue
        g.font = "bold 13px 'Pixelify Sans', monospace"
        g.fillStyle = "#08060e"
        g.fillText("?", toX(l.x) - 3, toY(l.z) + 6)
        g.fillStyle = "#fce060"
        g.fillText("?", toX(l.x) - 4, toY(l.z) + 5)
      }
      // landmarks you have found
      for (const l of LANDMARKS) {
        if (!engine.isFound(l.id)) continue
        const x = toX(l.x)
        const y = toY(l.z)
        g.fillStyle = "#f8e07a"
        g.strokeStyle = "#1a1030"
        g.lineWidth = 1.5
        g.beginPath()
        g.moveTo(x, y - 5)
        g.lineTo(x + 4, y)
        g.lineTo(x, y + 5)
        g.lineTo(x - 4, y)
        g.closePath()
        g.fill()
        g.stroke()
        if (props.expanded) {
          g.font = "11px 'Pixelify Sans', monospace"
          g.fillStyle = "#fff4b0"
          g.fillText(l.name, x + 7, y + 4)
        }
      }
      // you: an arrow pointing where you look
      const px = toX(st.x)
      const py = toY(st.z)
      g.save()
      g.translate(px, py)
      g.rotate(st.yaw)
      g.fillStyle = "#f0a040"
      g.strokeStyle = "#1a1030"
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(0, -8)
      g.lineTo(6, 6)
      g.lineTo(0, 3)
      g.lineTo(-6, 6)
      g.closePath()
      g.stroke()
      g.fill()
      g.restore()
      // north marker
      g.font = "10px 'Pixelify Sans', monospace"
      g.fillStyle = "#c49ae6"
      g.fillText("N", cw - 14, 14)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [props.engine, props.expanded])

  return (
    <aside className={`hud-glass map-card hud-part ${props.expanded ? "map-expanded" : ""}`} aria-label="Map of the valley">
      <div className="map-heading">
        <div>
          <span>The Valley</span>
          <span className="eyebrow">{props.expanded ? "FULL MAP" : "LOCAL MAP"}</span>
        </div>
        <button type="button" className="icon-button small" onClick={props.onToggle} aria-label={props.expanded ? "Collapse map" : "Expand map"} title={props.expanded ? "Collapse map (Esc)" : "Expand map"}>
          <Icon name={props.expanded ? "close" : "fullscreen"} />
        </button>
      </div>
      <canvas ref={canvasRef} className="minimap-canvas" />
      <div className="map-footer">
        <span>
          <i className="you-dot" /> You
        </span>
        <span>
          <i className="found-dot" /> Found
        </span>
      </div>
    </aside>
  )
}

/** 9×9 pixel-art icons ("X" = lit pixel), drawn as crisp squares. */
const ICONS: Record<string, string[]> = {
  pause: [".........", "..XX.XX..", "..XX.XX..", "..XX.XX..", "..XX.XX..", "..XX.XX..", "..XX.XX..", "..XX.XX..", "........."],
  play: [".........", "..X......", "..XX.....", "..XXX....", "..XXXX...", "..XXX....", "..XX.....", "..X......", "........."],
  home: ["....X....", "...XXX...", "..XXXXX..", ".XXXXXXX.", "..XXXXX..", "..XX.XX..", "..XX.XX..", "..XX.XX..", "........."],
  fire: ["....X....", "...XX....", "...XXX...", "..XXXX.X.", "..XXXXXX.", ".XXX.XXX.", ".XX...XX.", "..XX.XX..", "...XXX..."],
  sound: [".........", "...X.....", "..XX..X..", "XXXX...X.", "XXXX.X.X.", "XXXX...X.", "..XX..X..", "...X.....", "........."],
  muted: [".........", "...X.....", "..XX.....", "XXXX.X.X.", "XXXX..X..", "XXXX.X.X.", "..XX.....", "...X.....", "........."],
  music: ["....XXXX.", "....XXXX.", "....X..X.", "....X..X.", "....X..X.", "..XXX.XX.", ".XXXXXXX.", ".XXX.XXX.", "........."],
  help: ["..XXXX...", ".XX..XX..", ".....XX..", "....XX...", "...XX....", "...XX....", ".........", "...XX....", "........."],
  sliders: [".X.......", "XXXXXXXXX", ".X.......", ".....X...", "XXXXXXXXX", ".....X...", "...X.....", "XXXXXXXXX", "...X....."],
  fullscreen: ["XXX...XXX", "X.......X", "X.......X", ".........", ".........", ".........", "X.......X", "X.......X", "XXX...XXX"],
  eye: [".........", "...XXX...", ".XX...XX.", "X...X...X", "X..XXX..X", "X...X...X", ".XX...XX.", "...XXX...", "........."],
  close: ["XX.....XX", ".XX...XX.", "..XX.XX..", "...XXX...", "....X....", "...XXX...", "..XX.XX..", ".XX...XX.", "XX.....XX"],
  book: ["XXXX.XXXX", "X..X.X..X", "X.XX.XX.X", "X..X.X..X", "X.XX.XX.X", "X..X.X..X", "XXXX.XXXX", ".XXXXXXX.", "........."],
  talk: [".XXXXXXX.", "X.......X", "X.X.X.X.X", "X.......X", ".XXXXXXX.", "..XX.....", ".XX......", "X........", "........."],
  tower: ["X.X.X.X.X", "XXXXXXXXX", ".XXXXXXX.", ".XX.X.XX.", ".XXXXXXX.", ".XXXXXXX.", ".XXX.XXX.", ".XX...XX.", ".XX...XX."],
}

export function Icon({ name }: { name: string }) {
  const rows = ICONS[name] ?? ICONS.help
  return (
    <svg viewBox="0 0 9 9" shapeRendering="crispEdges" fill="currentColor" aria-hidden="true">
      {rows.flatMap((r, y) =>
        [...r].map((c, x) => (c === "X" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)),
      )}
    </svg>
  )
}

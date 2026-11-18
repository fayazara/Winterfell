import { useEffect, useRef, useState } from "react"
import { Engine, type Settings } from "@/game/engine"
import { PRESETS } from "@/game/presets"
import { PALETTES, type PaletteId } from "@/game/palettes"
import type { Landmark } from "@/game/regions"
import { Icon, Minimap } from "@/components/Minimap"

const initial: Settings = {
  pixelHeight: 400,
  ...PRESETS[0].tweaks,
  autoWalk: true,
  riding: false,
  grade: true,
  sound: true,
}

interface Toast {
  id: number
  eyebrow: string
  title: string
  line?: string
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * The opening: the game's own painted sky, pixelated onto the game's grid
 * (1 px = 6 screen px), dimmed at the edges. When the valley is ready it
 * dissolves away through an ordered-dither pattern, the classic pixel-art
 * transition, instead of a fade.
 */
function PixelVeil({ revealing }: { revealing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const start = useRef<number | null>(null)
  const img = useRef<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!img.current) {
      const i = new Image()
      i.src = "/sprites/world/sky.jpg"
      img.current = i
    }
    let raf = 0
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const c = ref.current
      if (!c) return
      const W = Math.ceil(window.innerWidth / 6)
      const H = Math.ceil(window.innerHeight / 6)
      if (c.width !== W || c.height !== H) {
        c.width = W
        c.height = H
      }
      const g = c.getContext("2d")!
      g.imageSmoothingEnabled = true
      g.fillStyle = "#1a1030"
      g.fillRect(0, 0, W, H)
      const sky = img.current
      if (sky?.complete && sky.naturalWidth) {
        // cover the screen, with a slow drift so it feels alive while loading
        const k = Math.max(W / sky.naturalWidth, H / sky.naturalHeight) * 1.08
        const dw = sky.naturalWidth * k
        const dh = sky.naturalHeight * k
        const drift = Math.sin(now / 4000) * (dw - W) * 0.3
        g.drawImage(sky, (W - dw) / 2 + drift, (H - dh) / 2, dw, dh)
      }
      // dusk vignette in hard dithered steps
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const dx = x / W - 0.5
          const dy = y / H - 0.5
          const v = (dx * dx + dy * dy) * 3.2
          if ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 < v - 0.35) {
            g.fillStyle = "rgba(14, 8, 30, 0.85)"
            g.fillRect(x, y, 1, 1)
          }
        }
      // reveal: clear cells whose Bayer threshold the wipe has passed,
      // sweeping outward from the centre so it opens like a window
      if (revealing && start.current === null) start.current = now
      if (start.current !== null) {
        const t = Math.min(1, (now - start.current) / 1100)
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const d = Math.hypot(x / W - 0.5, (y / H - 0.5) * (H / W)) * 1.6
            const th = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16
            if (t * 1.6 - d > th) g.clearRect(x, y, 1, 1)
          }
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [revealing])
  return <canvas ref={ref} className="pixel-veil" />
}

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [settings, setSettings] = useState<Settings>(initial)
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const [panel, setPanel] = useState(false)
  const [fps, setFps] = useState(0)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [camping, setCamping] = useState(false)
  const [verse, setVerse] = useState<string | null>(null)
  const [music, setMusic] = useState(true)
  const [paused, setPaused] = useState(false)
  const [cinema, setCinema] = useState(false)
  const [help, setHelp] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [region, setRegion] = useState("")
  const [found, setFound] = useState({ n: 0, total: 7 })
  const [toast, setToast] = useState<Toast | null>(null)
  const [veil, setVeil] = useState<"loading" | "revealing" | "gone">("loading")
  const [stage, setStage] = useState("Waking the valley…")
  const readings = useRef<HTMLDivElement>(null)
  const regionRef = useRef("")

  const showToast = (t: Omit<Toast, "id">, ms: number) => {
    const id = Date.now()
    setToast({ ...t, id })
    setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), ms)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const e = new Engine(canvas, {
        onFps: setFps,
        onAutoWalk: (autoWalk) => setSettings((s) => ({ ...s, autoWalk })),
        onPointerLock: setLocked,
        onRiding: (riding) => setSettings((s) => ({ ...s, riding })),
        onCamp: setCamping,
        onVerse: setVerse,
        onPreset: setPresetId,
        onSound: (sound) => setSettings((s) => ({ ...s, sound })),
        onMusic: setMusic,
        onPause: setPaused,
        onRegion: (name) => {
          if (regionRef.current) showToast({ eyebrow: "Entering", title: name }, 3200)
          regionRef.current = name
          setRegion(name)
        },
        onDiscover: (l: Landmark, n: number, total: number) => {
          setFound({ n, total })
          showToast({ eyebrow: `Landmark found · ${n} of ${total}`, title: l.name, line: l.line }, 7000)
        },
        onReady: () => {
          setVeil("revealing")
          setTimeout(() => setVeil("gone"), 1900)
        },
      })
      engineRef.current = e
      e.start()
      const st = e.status()
      setFound({ n: st.found, total: st.total })
      const stages = ["Painting the sky…", "Growing the pines…", "Filling the lake…", "Lighting the torch…"]
      let k = 0
      const id = setInterval(() => setStage(stages[k++ % stages.length]), 700)
      return () => {
        clearInterval(id)
        e.destroy()
        engineRef.current = null
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // live readings without re-rendering the whole HUD every frame
  useEffect(() => {
    const id = setInterval(() => {
      const e = engineRef.current
      const el = readings.current
      if (!e || !el) return
      const st = e.status()
      const set = (sel: string, v: string) => {
        const n = el.querySelector(sel)
        if (n) n.textContent = v
      }
      set("[data-speed]", st.speed.toFixed(1))
      set("[data-x]", Math.round(st.x).toString())
      set("[data-z]", Math.round(-st.z).toString())
      const bar = el.querySelector<HTMLElement>("[data-bar]")
      if (bar) bar.style.transform = `scaleX(${Math.min(1, st.speed / 9.5)})`
    }, 100)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT")) return
      if (e.code === "KeyP" || e.code === "Tab") {
        e.preventDefault()
        setPanel((p) => !p)
      }
      if (e.code === "KeyV") setCinema((c) => !c)
      if (e.code === "Escape") {
        setMapOpen(false)
        setHelp(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    engineRef.current?.setSettings(patch)
  }

  const pickPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    engineRef.current?.setPreset(p)
    update({ ...p.tweaks })
  }

  const act = (fn: () => void) => () => {
    engineRef.current?.uiCue()
    fn()
  }

  const openHelp = (open: boolean) => {
    setHelp(open)
    const e = engineRef.current
    if (e && open && !e.status().paused) e.togglePause(true)
    if (e && !open && e.status().paused) e.togglePause(false)
  }

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  const mode = camping ? "camp" : settings.riding ? "ride" : "walk"

  return (
    <div className={`pixel-ui hud-root fixed inset-0 overflow-hidden bg-[#07060d] text-[#c9c6e8] select-none ${cinema ? "is-cinema" : ""}`}>
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" />

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-lg">{error}</p>
        </div>
      ) : null}

      <Verse text={verse} />

      {/* header: brand + tools */}
      <header className="hud-header">
        <div className="brand hud-part">
          <span className="crest" aria-hidden="true">
            <Icon name="tower" />
          </span>
          <div>
            <h1>
              WINTERFELL<span>A LONG ROAD</span>
            </h1>
            <p>No finish line. No hurry.</p>
          </div>
        </div>
        <div className="header-tools">
          <span className="hud-glass badge hud-part">
            <i className={paused ? "is-paused" : ""} />
            {paused ? "Paused" : camping ? "Resting" : settings.riding ? "Riding" : "Wandering"}
          </span>
          <nav className="hud-glass action-bar" aria-label="Tools">
            <ToolButton icon={paused ? "play" : "pause"} label={paused ? "Continue (Space)" : "Pause (Space)"} pressed={paused}
              onClick={() => engineRef.current?.togglePause()} />
            <ToolButton icon="home" label="Back to the start of the road" onClick={() => engineRef.current?.goHome()} />
            <ToolButton icon="fire" label={camping ? "Break camp (C)" : "Make camp (C)"} pressed={camping}
              onClick={act(() => engineRef.current?.toggleCamp())} />
            <span className="tool-divider" />
            <ToolButton icon={settings.sound ? "sound" : "muted"} label={settings.sound ? "Mute (M)" : "Unmute (M)"} pressed={!settings.sound}
              onClick={act(() => update({ sound: !settings.sound }))} />
            <ToolButton icon="music" label={music ? "Music off" : "Music on"} pressed={!music}
              onClick={act(() => engineRef.current?.setMusic(!music))} />
            <ToolButton icon="help" label="How to play" onClick={act(() => openHelp(true))} />
            <ToolButton icon="sliders" label="Tune the look (P)" pressed={panel} onClick={act(() => setPanel((p) => !p))} />
            <ToolButton icon="fullscreen" label="Fullscreen" onClick={act(fullscreen)} />
            <ToolButton icon="eye" label="Hide interface (V)" pressed={cinema} onClick={act(() => setCinema((c) => !c))} />
          </nav>
        </div>
      </header>

      {/* where you are */}
      <section className="hud-glass location-card hud-part" ref={readings} aria-label="Where you are">
        <div className="eyebrow">
          NOW EXPLORING <span className="live-dot" />
        </div>
        <h2>{region || "The Valley"}</h2>
        <div className="readings">
          <div>
            <strong data-speed>0.0</strong>
            <span>m / s</span>
          </div>
          <div className="coords">
            <span>
              X <b data-x>—</b>
            </span>
            <span>
              N <b data-z>—</b>
            </span>
          </div>
        </div>
        <div className="speed-track" aria-hidden="true">
          <i data-bar />
        </div>
        <div className="found">
          <span>Landmarks</span>
          <span className="pips">
            {Array.from({ length: found.total }, (_, i) => (
              <i key={i} className={i < found.n ? "on" : ""} />
            ))}
          </span>
        </div>
      </section>

      {/* controls */}
      <div className="hud-glass control-hint hud-part">
        <span className="keys">
          {mode === "camp" ? (
            <kbd>C</kbd>
          ) : (
            <>
              <kbd>W</kbd>
              <span>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd>
              </span>
            </>
          )}
        </span>
        <span className="hint-copy">
          <b>{mode === "camp" ? "Rest a while" : mode === "ride" ? "Ride on" : "Walk the road"}</b>
          <span>
            {mode === "camp"
              ? "Look around freely · C to rise at dawn"
              : mode === "ride"
                ? "Shift to gallop · H to dismount · R auto-ride"
                : `${locked ? "Esc frees the mouse" : "Click to look"} · H horse · C camp · R auto-walk`}
          </span>
        </span>
        <button type="button" className="text-button" onClick={act(() => openHelp(true))}>
          Guide ↗
        </button>
      </div>

      <Minimap engine={engineRef} expanded={mapOpen} onToggle={() => {
        engineRef.current?.uiCue()
        setMapOpen((m) => !m)
      }} />

      {toast ? (
        <div key={toast.id} className="hud-glass hud-toast hud-part" role="status">
          <span className="eyebrow">{toast.eyebrow}</span>
          <b>{toast.title}</b>
          {toast.line ? <span className="toast-line">{toast.line}</span> : null}
        </div>
      ) : null}

      {paused && !help ? (
        <div className="pause-veil" onClick={() => engineRef.current?.togglePause(false)}>
          <div className="hud-glass pause-card">
            <span className="eyebrow">PAUSED</span>
            <b>The valley waits.</b>
            <span>Space or click to carry on</span>
          </div>
        </div>
      ) : null}

      {help ? (
        <div className="pause-veil" onClick={() => openHelp(false)}>
          <div className="hud-glass help-card" onClick={(e) => e.stopPropagation()}>
            <span className="eyebrow">LET'S WANDER</span>
            <h2>Follow the road, or don't</h2>
            <p>There is a castle at the end of the valley. Nobody is timing you. Light a fire whenever you like.</p>
            <dl>
              <Row k={<><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></>} v="Walk · Shift to run" />
              <Row k={<>Click, then mouse</>} v="Look around" />
              <Row k={<kbd>H</kbd>} v="Mount / dismount your horse" />
              <Row k={<><kbd>Shift</kbd> on horseback</>} v="Gallop" />
              <Row k={<kbd>R</kbd>} v="Auto-walk / auto-ride the road" />
              <Row k={<kbd>C</kbd>} v="Make camp · rest until dawn" />
              <Row k={<kbd>Space</kbd>} v="Pause" />
              <Row k={<kbd>M</kbd>} v="Sound on / off" />
              <Row k={<kbd>V</kbd>} v="Hide the interface" />
              <Row k={<kbd>P</kbd>} v="Tune the look" />
            </dl>
            <p className="note">Seven landmarks are hidden along the valley. Your map remembers the ones you find.</p>
            <button type="button" className="primary-button" onClick={act(() => openHelp(false))}>
              Back to the road <span>→</span>
            </button>
          </div>
        </div>
      ) : null}

      {panel ? (
        <aside className="hud-glass tune-panel">
          <div className="mb-2 flex items-center justify-between">
            <span className="tracking-widest text-[#e8a040] uppercase">Tune</span>
            <span className="text-xs text-[#7a7686] tabular-nums">{fps} fps</span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPreset(p.id)}
                className={`border px-2 py-1 text-left text-xs ${
                  p.id === presetId ? "border-[#e8a040] bg-[#2e2a5c] text-[#f6d27a]" : "border-[#2e2a5c] hover:border-[#6a62a6]"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <Slider label="Pixel size" value={settings.pixelHeight} min={120} max={600} step={20}
            display={`${settings.pixelHeight}p`} onChange={(v) => update({ pixelHeight: v })} invert />
          <Slider label="Fog" value={settings.fog} min={0} max={0.04} step={0.001} onChange={(v) => update({ fog: v })} />
          <Slider label="Mist" value={settings.mist} min={0} max={2} step={0.05} onChange={(v) => update({ mist: v })} />
          <Slider label="Torch" value={settings.torch} min={0} max={2} step={0.05} onChange={(v) => update({ torch: v })} />
          <Slider label="Wind" value={settings.wind} min={0} max={2} step={0.05} onChange={(v) => update({ wind: v })} />
          <Slider label="Dither" value={settings.dither} min={0} max={1.5} step={0.05} onChange={(v) => update({ dither: v })} />

          <label className="mt-2 flex items-center justify-between gap-2">
            <span>Palette</span>
            <select
              value={settings.palette}
              onChange={(e) => update({ palette: e.target.value as PaletteId })}
              className="border border-[#2e2a5c] bg-[#171530] px-1 py-0.5 text-xs"
            >
              {Object.entries(PALETTES).map(([id, p]) => (
                <option key={id} value={id}>{p.name}</option>
              ))}
              <option value="off">Off (raw)</option>
            </select>
          </label>
          <Check label="Toy colour grade" checked={settings.grade} onChange={(v) => update({ grade: v })} />
          <Check label="Ride the horse (H)" checked={settings.riding} onChange={(v) => update({ riding: v })} />
          <Check label={`Auto-${settings.riding ? "ride" : "walk"} the road`} checked={settings.autoWalk} onChange={(v) => update({ autoWalk: v })} />
        </aside>
      ) : null}

      {veil !== "gone" ? (
        <div className={`cloud-veil ${veil === "revealing" ? "is-revealing" : ""}`} aria-hidden="true">
          <PixelVeil revealing={veil === "revealing"} />
          <div className="hud-glass loading-card" role="status">
            <div className="veil-title">WINTERFELL</div>
            <span className="eyebrow">A long road, and no hurry</span>
            <h2>The valley is waking</h2>
            <p>{stage}</p>
            <div className="loading-track">
              <i />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton(props: { icon: string; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" className={`icon-button ${props.pressed ? "is-on" : ""}`} onClick={props.onClick}
      title={props.label} aria-label={props.label} aria-pressed={props.pressed}>
      <Icon name={props.icon} />
    </button>
  )
}

function Row({ k, v }: { k: React.ReactNode; v: string }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="mt-2 flex items-center justify-between">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.checked} className="accent-[#e8a040]" onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  )
}

function Slider(props: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display?: string
  invert?: boolean
  onChange: (v: number) => void
}) {
  const { label, value, min, max, step, display, invert, onChange } = props
  const shown = invert ? max + min - value : value
  return (
    <label className="mb-1.5 block">
      <span className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-[#7a7686] tabular-nums">{display ?? value.toFixed(step < 0.01 ? 3 : 2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value)
          onChange(invert ? max + min - v : v)
        }}
        className="w-full accent-[#e8a040]"
      />
    </label>
  )
}

/** A short verse that fades in and out over the scene while resting. */
function Verse({ text }: { text: string | null }) {
  const [shown, setShown] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (text) {
      setShown(text)
      const id = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(id)
    }
    setVisible(false)
    const id = setTimeout(() => setShown(null), 2500)
    return () => clearTimeout(id)
  }, [text])
  if (!shown) return null
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-[22%] text-center transition-opacity duration-[2500ms] ease-in-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <p className="mx-auto max-w-md px-4 text-lg leading-relaxed whitespace-pre-line text-[#f0e8f0] drop-shadow-[2px_2px_0_#07060d] sm:text-xl">
        {shown}
      </p>
    </div>
  )
}

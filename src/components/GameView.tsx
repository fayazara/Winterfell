import { useEffect, useRef, useState } from "react"
import { Engine, type Settings } from "@/game/engine"
import { PRESETS } from "@/game/presets"
import { PALETTES, type PaletteId } from "@/game/palettes"

const initial: Settings = { pixelHeight: 400, ...PRESETS[0].tweaks, autoWalk: true, riding: false }

export function GameView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const [settings, setSettings] = useState<Settings>(initial)
  const [presetId, setPresetId] = useState(PRESETS[0].id)
  const [panel, setPanel] = useState(true)
  const [fps, setFps] = useState(0)
  const [locked, setLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const e = new Engine(canvas, {
        onFps: setFps,
        onAutoWalk: (autoWalk) => setSettings((s) => ({ ...s, autoWalk })),
        onPointerLock: setLocked,
        onRiding: (riding) => setSettings((s) => ({ ...s, riding })),
      })
      engineRef.current = e
      e.start()
      return () => {
        e.destroy()
        engineRef.current = null
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyP" || e.code === "Tab") {
        e.preventDefault()
        setPanel((p) => !p)
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

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]

  return (
    <div className="pixel-ui fixed inset-0 overflow-hidden bg-[#07060d] text-[#c9c6e8] select-none">
      <canvas ref={canvasRef} className="block h-full w-full cursor-crosshair" />

      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <p className="max-w-sm text-lg">{error}</p>
        </div>
      ) : null}

      <div className="pointer-events-none absolute top-4 left-4 max-w-[60vw]">
        <h1 className="text-2xl tracking-[0.2em] text-[#e8a040] uppercase drop-shadow-[2px_2px_0_#07060d]">
          Winterfell
        </h1>
        <p className="mt-1 text-sm text-[#a19dab] drop-shadow-[1px_1px_0_#07060d]">
          {preset.name} — {preset.blurb}
        </p>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-center text-xs text-[#7a7686] drop-shadow-[1px_1px_0_#07060d]">
        {locked ? "Esc to free the mouse" : "Click to look around"} ·{" "}
        {settings.riding ? "W/S ride · A/D turn · Shift gallop" : "WASD walk · Shift run"} · H{" "}
        {settings.riding ? "dismount" : "mount horse"} · R auto-{settings.riding ? "ride" : "walk"}
        {settings.autoWalk ? " (on)" : " (off)"} · P panel
      </div>

      {panel ? (
        <aside className="absolute top-4 right-4 w-64 max-w-[calc(100vw-2rem)] border-2 border-[#3d3873] bg-[#0f0d1c]/90 p-3 text-sm shadow-[4px_4px_0_#07060d]">
          <div className="mb-2 flex items-center justify-between">
            <span className="tracking-widest text-[#e8a040] uppercase">Playground</span>
            <span className="text-xs text-[#7a7686] tabular-nums">{fps} fps</span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => pickPreset(p.id)}
                className={`border px-2 py-1 text-left text-xs ${
                  p.id === presetId
                    ? "border-[#e8a040] bg-[#2e2a5c] text-[#f6d27a]"
                    : "border-[#2e2a5c] hover:border-[#6a62a6]"
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>

          <Slider label="Pixel size" value={settings.pixelHeight} min={120} max={600} step={20}
            display={`${settings.pixelHeight}p`} onChange={(v) => update({ pixelHeight: v })} invert />
          <Slider label="Fog" value={settings.fog} min={0} max={0.04} step={0.001}
            onChange={(v) => update({ fog: v })} />
          <Slider label="Mist" value={settings.mist} min={0} max={2} step={0.05}
            onChange={(v) => update({ mist: v })} />
          <Slider label="Torch" value={settings.torch} min={0} max={2} step={0.05}
            onChange={(v) => update({ torch: v })} />
          <Slider label="Wind" value={settings.wind} min={0} max={2} step={0.05}
            onChange={(v) => update({ wind: v })} />
          <Slider label="Dither" value={settings.dither} min={0} max={1.5} step={0.05}
            onChange={(v) => update({ dither: v })} />

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

          <label className="mt-2 flex items-center justify-between">
            <span>Ride the horse (H)</span>
            <input type="checkbox" checked={settings.riding} className="accent-[#e8a040]"
              onChange={(e) => update({ riding: e.target.checked })} />
          </label>

          <label className="mt-2 flex items-center justify-between">
            <span>Auto-{settings.riding ? "ride" : "walk"} the road</span>
            <input type="checkbox" checked={settings.autoWalk} className="accent-[#e8a040]"
              onChange={(e) => update({ autoWalk: e.target.checked })} />
          </label>
        </aside>
      ) : null}
    </div>
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

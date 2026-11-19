import {
  PARTICLE_FRAG,
  PARTICLE_VERT,
  BILLBOARD_FRAG,
  BILLBOARD_VERT,
  FLAME_FRAG,
  FULLSCREEN_VERT,
  POST_FRAG,
  SCENE_FRAG,
  SPRITE_FRAG,
  SPRITE_VERT,
} from "./shaders"
import {
  FLAME_SIZE,
  TORCH_FLAME_ANCHOR,
  makeSwordSprite,
  makeTorchSprite,
  type Sprite,
} from "./sprites"
import { MAX_PALETTE, PALETTES } from "./palettes"
import { HAND_IMAGES, buildHandSprite, loadImage, type HandSprite } from "./handImages"
import { SKY_URL, buildAtlas, placeProps, type Atlas, type Prop } from "./props"
import { GROUND, bakeAO, bakeHeights, bakeShadows, packGround } from "./groundMap"
import { Ambience } from "./audio"
import { DISCOVER_RADIUS, LANDMARKS, regionAt, type Landmark } from "./regions"
import { COURT, HORSE_TALK, NPCS, type Action, type Ctx, type Npc } from "./npcs"
import { loadSave, updateSave } from "./save"
import { DAWN_ID, NIGHT_ID, PRESETS, type Environment, type Preset, type Tweaks } from "./presets"
import {
  CASTLE_X,
  CASTLE_Y,
  CASTLE_Z,
  PATH_END_Z,
  PATH_START_Z,
  COURT_Y,
  LAKE,
  LAKE_FLOOR,
  WATER_Y,
  lakeE,
  clamp,
  lerp,
  smoothstep,
  pathX,
  terrainHeight,
  vnoise,
} from "./world"

export interface Settings extends Tweaks {
  /** Target height of the internal framebuffer in pixels (smaller = chunkier). */
  pixelHeight: number
  autoWalk: boolean
  /** on horseback */
  riding: boolean
  /** BRICKLAND-style toy colour grade */
  grade: boolean
  /** synthesised ambient sound */
  sound: boolean
  /** time flows on its own: dawn, day, golden hour, dusk, night */
  dayCycle: boolean
  /** "auto" lets the sky decide */
  weather: "auto" | "clear" | "rain" | "fog"
}

export interface EngineCallbacks {
  onFps?: (fps: number) => void
  onAutoWalk?: (on: boolean) => void
  onPointerLock?: (locked: boolean) => void
  onRiding?: (on: boolean) => void
  onCamp?: (on: boolean) => void
  /** a short line of verse to show while resting, or null to clear it */
  onVerse?: (text: string | null) => void
  /** the engine moved to another preset on its own (night falls, dawn) */
  onPreset?: (id: string) => void
  onSound?: (on: boolean) => void
  onMusic?: (on: boolean) => void
  /** entered a named part of the valley */
  onRegion?: (name: string) => void
  /** found a landmark for the first time */
  onDiscover?: (landmark: Landmark, found: number, total: number) => void
  /** everything has loaded: lift the intro */
  onReady?: () => void
  onPause?: (paused: boolean) => void
  /** someone you can talk to is close (null when nobody is) */
  onNear?: (npc: Npc | null) => void
  /** a conversation begins */
  onTalk?: (npc: Npc) => void
  onCourtyard?: (inside: boolean) => void
}

type Prog = { p: WebGLProgram; u: Map<string, WebGLUniformLocation | null> }

const EYE = 1.72
/** eye height in the saddle */
const EYE_RIDING = 2.55
const easeInOut = (t: number) => t * t * (3 - 2 * t)
/** real seconds for one whole day */
const DAY_SECONDS = 20 * 60
/** hour → preset: the sky the day moves through */
const DAY_KEYS: [number, string][] = [
  [0, "starlit"], [4.6, "starlit"], [6, "morningmist"], [8.5, "valleyroad"], [14.5, "valleyroad"],
  [16.5, "mistypeaks"], [18, "goldenhour"], [19.3, "violetdusk"], [20.8, "starlit"], [24, "starlit"],
]
const presetEnv = (id: string) => PRESETS.find((p) => p.id === id)!.env

function mixEnv(a: Environment, b: Environment, t: number): Environment {
  const out = {} as Record<string, unknown>
  for (const key of Object.keys(b) as (keyof Environment)[]) {
    const va = a[key]
    const vb = b[key]
    out[key] = Array.isArray(va) ? lerp3(va, vb as number[], t) : lerp(va as number, vb as number, t)
  }
  return out as unknown as Environment
}

/** The sky at a given hour, eased between the day's key presets. */
function dayEnv(hour: number) {
  const h = ((hour % 24) + 24) % 24
  for (let i = 0; i < DAY_KEYS.length - 1; i++) {
    const [h0, a] = DAY_KEYS[i]
    const [h1, b] = DAY_KEYS[i + 1]
    if (h >= h0 && h <= h1) {
      const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0
      return mixEnv(presetEnv(a), presetEnv(b), t * t * (3 - 2 * t))
    }
  }
  return presetEnv("starlit")
}

/** eye height sitting by the fire */
const EYE_SITTING = 1.05
const FIREFLIES = 180
const EMBERS = 60

/** Original verses for resting by the fire. */
const VERSES = [
  "Embers climb the dark —\nthe road will wait till morning,\nand so will the stones.",
  "Fireflies drift low;\nthe horse dozes by the flame.\nNothing to be won.",
  "Far towers, faint light.\nThe fire knows only this hour\nand asks nothing more.",
  "Wind moves through the pines.\nI set the heavy sword down\nand listen a while.",
  "Stars over the vale —\nhow small the castle looks now,\nhow wide the night is.",
  "The torch burns lower.\nSomewhere an owl, then nothing.\nThe grass keeps breathing.",
]
/** floats per billboard instance: pos3 size2 uv4 sway2 tint1 */
const BB_FLOATS = 12
const FOV = (62 * Math.PI) / 180

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): Prog {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed")
    return s
  }
  const p = gl.createProgram()
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs))
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs))
  gl.bindAttribLocation(p, 0, "aPos")
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p) ?? "program link failed")
  return { p, u: new Map() }
}

function loc(gl: WebGL2RenderingContext, prog: Prog, name: string) {
  if (!prog.u.has(name)) prog.u.set(name, gl.getUniformLocation(prog.p, name))
  return prog.u.get(name) ?? null
}

const lerp3 = (a: number[], b: number[], t: number): [number, number, number] => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
]

export class Engine {
  private gl: WebGL2RenderingContext
  private scene: Prog
  private sprite: Prog
  private flame: Prog
  private post: Prog
  private vao: WebGLVertexArrayObject
  /** colour-only target (billboards, hands, flame draw here) */
  private fbo: WebGLFramebuffer
  private fboTex: WebGLTexture
  /** scene target: colour + ray depth, read back by the billboard pass */
  private fboScene: WebGLFramebuffer
  private depthTex: WebGLTexture
  private billboard: Prog
  private bbVao: WebGLVertexArrayObject
  private bbBuf: WebGLBuffer
  private bbData = new Float32Array(0)
  private atlasTex: WebGLTexture | null = null
  private atlas: Atlas | null = null
  private skyTex: WebGLTexture | null = null
  private props: Prop[] = []
  private propOrder: Int32Array = new Int32Array(0)
  private propDist: Float32Array = new Float32Array(0)
  private torchTex: { tex: WebGLTexture; s: HandSprite }
  private swordTex: { tex: WebGLTexture; s: HandSprite }
  private handImgs: { torch: HTMLImageElement; sword: HTMLImageElement; horse: HTMLImageElement } | null = null
  private handsH = 0
  private destroyed = false
  private low = { w: 320, h: 180, scale: 4, ox: 0, oy: 0 }
  private spriteK = 1
  private raf = 0
  private last = 0
  private time = 0
  private fpsAcc = { t: 0, n: 0 }

  // player
  private pos = { x: pathX(PATH_START_Z), z: PATH_START_Z }
  private camY = 0
  private yaw = 0
  private pitch = 0.03
  private lookOffset = { yaw: 0, pitch: 0 }
  private bobPhase = 0
  private moving = 0
  // riding
  private mountT = 0
  private rideSpeed = 0
  private turnRate = 0
  private ridePhase = 0
  private gallop = 0
  /** the horse standing in the world while you are on foot */
  private horseProp: Prop | null = null
  private horseTex: { tex: WebGLTexture; s: HandSprite } | null = null
  // camping
  private particles: Prog
  private camping = false
  private campT = 0
  private campTime = 0
  private campProp: Prop | null = null
  private verseShown = false
  private verseIndex = Math.floor(Math.random() * VERSES.length)
  private dawnTimer = 0
  /** seconds the current environment blend takes */
  private envDuration = 2
  // baked ground map: horizon AO + prop shadows
  private groundTex: WebGLTexture | null = null
  private groundAO: Uint8Array | null = null
  private groundData: Uint8Array | null = null
  private groundSun: number[] | null = null
  private groundTimer = 0
  private audio = new Ambience()
  private heights: Float32Array | null = null
  private paused = false
  private region = ""
  private regionTimer = 0
  private discovered = new Set<string>()
  private loaded = { hands: false, atlas: false, sky: false, ground: false }
  private readySent = false
  // people
  private npcProps = new Map<string, Prop>()
  private nearNpc: Npc | null = null
  private talking: Npc | null = null
  private npcTimer = 0
  private strangerGone = false
  private inCourt = false
  private teleport: { x: number; z: number; yaw: number; court: boolean } | null = null
  // the day: 0..24 game hours; a whole day takes DAY_SECONDS of real time
  private hour = 19.1
  private campRush = false
  private envCache: Environment | null = null
  // weather: what it is, how strongly, and what is coming next
  private wx: { kind: "clear" | "rain" | "fog"; amount: number; next: "clear" | "rain" | "fog"; at: number } = {
    kind: "clear",
    amount: 0,
    next: "rain",
    at: 21.5,
  }
  private keys = new Set<string>()
  private fade = 0
  private looping = false

  // environment blending between presets
  private envFrom: Environment
  private envTo: Environment
  private envT = 1

  settings: Settings

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: EngineCallbacks = {},
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false })
    if (!gl) throw new Error("WebGL2 is not available in this browser.")
    this.gl = gl
    this.scene = compile(gl, FULLSCREEN_VERT, SCENE_FRAG)
    this.post = compile(gl, FULLSCREEN_VERT, POST_FRAG)
    this.sprite = compile(gl, SPRITE_VERT, SPRITE_FRAG)
    this.flame = compile(gl, SPRITE_VERT, FLAME_FRAG)

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    this.fboTex = gl.createTexture()
    this.fbo = gl.createFramebuffer()
    this.depthTex = gl.createTexture()
    this.fboScene = gl.createFramebuffer()
    this.billboard = compile(gl, BILLBOARD_VERT, BILLBOARD_FRAG)
    this.particles = compile(gl, PARTICLE_VERT, PARTICLE_FRAG)
    // billboard VAO: unit quad corners + per-instance attributes
    this.bbVao = gl.createVertexArray()
    gl.bindVertexArray(this.bbVao)
    const corners = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, corners)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    this.bbBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bbBuf)
    const stride = BB_FLOATS * 4
    const attrs: [number, number, number][] = [[1, 3, 0], [2, 2, 3], [3, 4, 5], [4, 2, 9], [5, 1, 11]]
    for (const [locn, size, off] of attrs) {
      gl.enableVertexAttribArray(locn)
      gl.vertexAttribPointer(locn, size, gl.FLOAT, false, stride, off * 4)
      gl.vertexAttribDivisor(locn, 1)
    }
    gl.bindVertexArray(null)
    this.torchTex = this.uploadSprite(makeTorchSprite())
    this.swordTex = this.uploadSprite(makeSwordSprite())

    const p = PRESETS[0]
    this.envFrom = p.env
    this.envTo = p.env
    this.settings = { pixelHeight: 400, ...p.tweaks, autoWalk: true, riding: false, grade: true, sound: this.audio.on, dayCycle: true, weather: "auto" }
    queueMicrotask(() => {
      this.cb.onSound?.(this.audio.on)
      this.cb.onMusic?.(this.audio.musicOn)
    })
    try {
      const saved = JSON.parse(localStorage.getItem("winterfell-found") ?? "[]") as string[]
      for (const id of saved) this.discovered.add(id)
    } catch {
      /* no storage */
    }
    this.parkHorse(pathX(PATH_START_Z - 7) + 2.6, PATH_START_Z - 7)

    this.camY = terrainHeight(this.pos.x, this.pos.z) + EYE
    this.yaw = this.pathYaw(this.pos.z)
    // playground aids: #hour=6.5 sets the clock, #wx=rain|fog|clear forces the weather
    const hm = /hour=(-?[\d.]+)/.exec(window.location.hash)
    if (hm) this.hour = Number(hm[1]) % 24
    const wm = /wx=(rain|fog|clear)/.exec(window.location.hash)
    if (wm) {
      const kind = wm[1] as "rain" | "fog" | "clear"
      this.settings.weather = kind
      this.wx.kind = kind
      this.wx.amount = kind === "clear" ? 0 : 1
    }
    // playground aid: #cam=x,z,yawDegrees starts you standing there, free-looking
    const m = /cam=(-?[\d.]+),(-?[\d.]+)(?:,(-?[\d.]+))?/.exec(window.location.hash)
    if (m) {
      this.pos = { x: Number(m[1]), z: Number(m[2]) }
      this.yaw = ((Number(m[3] ?? 0)) * Math.PI) / 180
      this.pitch = -0.05
      this.camY = terrainHeight(this.pos.x, this.pos.z) + EYE
      this.settings.autoWalk = false
      this.inCourt = this.pos.x > COURT.x - 80
      queueMicrotask(() => {
        this.cb.onAutoWalk?.(false)
        if (this.inCourt) this.cb.onCourtyard?.(true)
      })
    }

    this.resize()
    window.addEventListener("resize", this.resize)
    window.addEventListener("keydown", this.onKeyDown)
    window.addEventListener("keyup", this.onKeyUp)
    window.addEventListener("blur", this.onBlur)
    canvas.addEventListener("click", this.onClick)
    canvas.addEventListener("pointerdown", this.onPointerDown)
    document.addEventListener("pointerlockchange", this.onLockChange)
    document.addEventListener("mousemove", this.onMouseMove)
  }

  // ---------- public API ----------
  start() {
    Promise.all([loadImage(HAND_IMAGES.torch), loadImage(HAND_IMAGES.sword), loadImage(HAND_IMAGES.horse)])
      .then(([torch, sword, horse]) => {
        if (this.destroyed) return
        this.handImgs = { torch, sword, horse }
        this.rebuildHands(true)
        this.markLoaded("hands")
      })
      .catch((err) => {
        console.warn("hand images unavailable, using procedural hands", err)
        this.markLoaded("hands")
      })
    buildAtlas()
      .then((atlas) => {
        if (this.destroyed) return
        const gl = this.gl
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        this.atlas = atlas
        this.atlasTex = tex
        this.props = placeProps()
        this.bbData = new Float32Array((this.props.length + 16) * BB_FLOATS)
        this.propOrder = new Int32Array(this.props.length + 16)
        this.propDist = new Float32Array(this.props.length + 16)
        this.markLoaded("atlas")
      })
      .catch((err) => {
        console.warn("world props unavailable, using procedural trees", err)
        this.markLoaded("atlas")
      })
    loadImage(SKY_URL)
      .then((img) => {
        if (this.destroyed) return
        const gl = this.gl
        const tex = gl.createTexture()
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        this.skyTex = tex
        this.markLoaded("sky")
      })
      .catch((err) => {
        console.warn("painted sky unavailable", err)
        this.markLoaded("sky")
      })
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    // ground occlusion takes ~100 ms of CPU; do it after the first frame
    setTimeout(() => {
      if (this.destroyed) return
      this.heights = bakeHeights()
      this.groundAO = bakeAO(this.heights)
      this.markLoaded("ground")
    }, 50)
  }

  destroy() {
    this.destroyed = true
    this.audio.dispose()
    cancelAnimationFrame(this.raf)
    window.removeEventListener("resize", this.resize)
    window.removeEventListener("keydown", this.onKeyDown)
    window.removeEventListener("keyup", this.onKeyUp)
    window.removeEventListener("blur", this.onBlur)
    this.canvas.removeEventListener("click", this.onClick)
    this.canvas.removeEventListener("pointerdown", this.onPointerDown)
    document.removeEventListener("pointerlockchange", this.onLockChange)
    document.removeEventListener("mousemove", this.onMouseMove)
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
  }

  setPreset(preset: Preset) {
    this.blendTo(preset.env, 2)
    this.settings = { ...this.settings, dayCycle: false }
  }

  private blendTo(env: Environment, seconds: number) {
    this.envFrom = this.currentEnv()
    this.envTo = env
    this.envT = 0
    this.envDuration = seconds
  }

  /** Light a fire and sit; night falls while you rest. C again to rise at dawn. */
  private setCamp(on: boolean) {
    if (on === this.camping || this.looping) return
    if (on) {
      if (this.settings.riding) this.setRiding(false)
      if (this.settings.autoWalk) this.setAutoWalk(false)
      const fx = Math.sin(this.yaw)
      const fz = -Math.cos(this.yaw)
      const x = this.pos.x + fx * 2.4
      const z = this.pos.z + fz * 2.4
      this.campProp = { x, y: terrainHeight(x, z) - 0.1, z, h: 1.1, key: "campfire", sway: 0, phase: 0, glow: true }
      // the horse wanders over to stand by the camp
      const rx = Math.cos(this.yaw)
      const rz = Math.sin(this.yaw)
      this.parkHorse(this.pos.x + rx * 3.6 + fx * 1.5, this.pos.z + rz * 3.6 + fz * 1.5)
      this.camping = true
      this.campTime = 0
      this.verseShown = false
      if (this.settings.dayCycle) this.campRush = true
      else {
        this.blendTo(PRESETS.find((p) => p.id === NIGHT_ID)!.env, 14)
        this.cb.onPreset?.(NIGHT_ID)
      }
    } else {
      this.camping = false
      this.cb.onVerse?.("Dawn comes up over the valley.\nThe road is still there.")
      this.dawnTimer = 5
      this.campRush = false
      if (this.settings.dayCycle) {
        // wake at first light
        this.envFrom = this.currentEnv()
        this.envT = 0
        this.envDuration = 6
        this.hour = 5.9
      } else {
        this.blendTo(PRESETS.find((p) => p.id === DAWN_ID)!.env, 6)
        this.cb.onPreset?.(DAWN_ID)
      }
    }
    this.cb.onCamp?.(on)
  }

  private markLoaded(part: keyof Engine["loaded"]) {
    this.loaded[part] = true
    if (!this.readySent && Object.values(this.loaded).every(Boolean)) {
      this.readySent = true
      // let the first frame with everything in it render before the reveal
      requestAnimationFrame(() => requestAnimationFrame(() => this.cb.onReady?.()))
    }
  }

  /** Live readings for the HUD and the minimap. */
  status() {
    return {
      x: this.pos.x,
      z: this.pos.z,
      yaw: this.yaw + this.lookOffset.yaw,
      speed: this.settings.riding ? Math.abs(this.rideSpeed) : this.moving * (this.settings.autoWalk ? 1.5 : 2.2),
      region: this.region,
      found: this.discovered.size,
      total: LANDMARKS.length,
      paused: this.paused,
      inCourt: this.inCourt,
      clock: this.clock(),
      hour: this.hour,
      weather: this.weatherKind(),
    }
  }

  /** Static data the minimap is drawn from (null until baked). */
  mapData() {
    return this.heights && this.props.length ? { heights: this.heights, props: this.props } : null
  }

  isFound(id: string) {
    return this.discovered.has(id)
  }

  togglePause(force?: boolean) {
    this.paused = force ?? !this.paused
    this.keys.clear()
    this.audio.cue(this.paused ? "pause" : "resume")
    this.audio.setPaused(this.paused)
    this.cb.onPause?.(this.paused)
  }

  /** Back to where the road begins, through a fade. */
  goHome() {
    if (this.camping) this.setCamp(false)
    this.looping = true
    this.audio.cue("home")
  }

  setMusic(on: boolean) {
    this.audio.setMusic(on)
    this.cb.onMusic?.(on)
  }

  uiCue() {
    this.audio.unlock()
    this.audio.cue("click")
  }

  private checkPlaces() {
    const r = regionAt(this.pos.x, this.pos.z)
    if (r !== this.region) {
      const first = this.region === ""
      this.region = r
      this.cb.onRegion?.(r)
      if (!first) this.audio.cue("region")
    }
    for (const l of LANDMARKS) {
      if (this.discovered.has(l.id)) continue
      if (Math.hypot(this.pos.x - l.x, this.pos.z - l.z) > DISCOVER_RADIUS) continue
      this.discovered.add(l.id)
      try {
        localStorage.setItem("winterfell-found", JSON.stringify([...this.discovered]))
      } catch {
        /* no storage */
      }
      this.audio.cue("discover")
      this.cb.onDiscover?.(l, this.discovered.size, LANDMARKS.length)
    }
  }

  /** What a conversation needs to know about the world right now. */
  dialogCtx(): Ctx {
    const env = this.currentEnv()
    return { save: loadSave(), night: env.stars, weather: this.weatherKind(), forecast: this.forecast(), riding: this.settings.riding }
  }

  /** Overridden by the weather system; clear skies until then. */
  weatherKind(): Ctx["weather"] {
    return this.wx.amount > 0.35 ? this.wx.kind : "clear"
  }

  forecast(): string {
    const n = this.wx.next
    const when = this.wx.at < 5 ? "before dawn" : this.wx.at < 12 ? "by morning" : this.wx.at < 18 ? "this afternoon" : "by evening"
    if (this.wx.kind === "rain" && this.wx.amount > 0.3) return "it'll clear up " + when
    return n === "rain" ? `rain ${when}` : n === "fog" ? `fog ${when}` : "clear skies for a while"
  }

  /** Begin talking to whoever is near (E). */
  talk() {
    const npc = this.nearNpc
    if (!npc || this.talking) return
    this.talking = npc
    this.keys.clear()
    if (document.pointerLockElement === this.canvas) document.exitPointerLock()
    if (this.settings.autoWalk) this.setAutoWalk(false)
    this.audio.cue("click")
    this.cb.onTalk?.(npc)
  }

  endTalk() {
    const npc = this.talking
    this.talking = null
    // recorded at the end, so a first conversation opens with a first greeting
    if (npc)
      updateSave((sv) => {
        sv.met[npc.id] = (sv.met[npc.id] ?? 0) + 1
      })
  }

  /** Things a conversation can make happen in the world. */
  doAction(a: Action) {
    if (a === "enterCourtyard") {
      if (this.settings.riding) this.setRiding(false)
      this.teleport = { x: COURT.x, z: COURT.z + COURT.size - 4, yaw: 0, court: true }
      this.looping = true
    } else if (a === "leaveCourtyard") {
      const z = PATH_END_Z + 7
      this.teleport = { x: pathX(z), z, yaw: Math.PI, court: false }
      this.looping = true
    } else if (a === "vanish") {
      this.strangerGone = true
    }
  }

  private npcVisible(n: Npc) {
    if (n.place === "camp") return this.camping && this.campTime > 18 && !this.strangerGone && !!this.campProp
    return true
  }

  /** Where each person is this frame (Pell walks; the stranger sits by your fire). */
  private placeNpcs() {
    for (const n of NPCS) {
      if (!this.npcVisible(n)) {
        this.npcProps.delete(n.id)
        continue
      }
      let x = n.x
      let z = n.z
      if (n.walk) {
        const span = Math.abs(n.walk.z1 - n.walk.z0)
        // walk the road back and forth, pausing to talk while you do
        const ph = (this.time * n.walk.speed) / span
        const k = 0.5 - 0.5 * Math.cos(ph * Math.PI)
        z = n.walk.z0 + (n.walk.z1 - n.walk.z0) * k
        x = pathX(z) + n.walk.offset
        const prev = this.npcProps.get(n.id)
        if (this.talking?.id === n.id && prev) {
          x = prev.x
          z = prev.z
          this.time -= 0 // conversation pauses nothing else
        }
      }
      if (n.place === "camp" && this.campProp) {
        const rx = Math.cos(this.yaw)
        const rz = Math.sin(this.yaw)
        x = this.campProp.x + rx * 1.9
        z = this.campProp.z + rz * 1.9
      }
      const y = terrainHeight(x, z) - 0.1
      const prop = this.npcProps.get(n.id)
      if (prop) {
        prop.x = x
        prop.y = y
        prop.z = z
      } else this.npcProps.set(n.id, { x, y, z, h: n.h, key: n.key as Prop["key"], sway: 0, phase: 0 })
    }
  }

  private findNear() {
    let best: Npc | null = null
    let bestD = Infinity
    for (const n of NPCS) {
      const p = this.npcProps.get(n.id)
      if (!p) continue
      const d = Math.hypot(p.x - this.pos.x, p.z - this.pos.z)
      const reach = n.place === "camp" ? 4.5 : 4.2
      if (d < reach && d < bestD) {
        best = n
        bestD = d
      }
    }
    if (this.horseProp && !this.settings.riding && !this.camping) {
      const d = Math.hypot(this.horseProp.x - this.pos.x, this.horseProp.z - this.pos.z)
      if (d < 3.4 && d < bestD) best = { ...HORSE_TALK, name: loadSave().horse || "Your horse" }
    }
    if (best?.id !== this.nearNpc?.id || best?.name !== this.nearNpc?.name) {
      this.nearNpc = best
      this.cb.onNear?.(best)
    }
  }

  /** Keep the player inside the valley (and out of the lake), or inside the courtyard walls. */
  private bound(px: number, pz: number) {
    if (this.inCourt) {
      const lim = COURT.size - 1.6
      this.pos.x = clamp(this.pos.x, COURT.x - lim, COURT.x + lim)
      this.pos.z = clamp(this.pos.z, COURT.z - lim + 2, COURT.z + lim)
      // the fountain in the middle
      if (Math.hypot(this.pos.x - COURT.x, this.pos.z - COURT.z) < 2.6) {
        this.pos.x = px
        this.pos.z = pz
      }
      return
    }
    this.pos.x = clamp(this.pos.x, -160, 160)
    this.pos.z = clamp(this.pos.z, -128, 90)
    if (lakeE(this.pos.x, this.pos.z) < 1.02) {
      this.pos.x = px
      this.pos.z = pz
    }
  }

  get isCamping() {
    return this.camping
  }

  toggleCamp() {
    this.setCamp(!this.camping)
  }

  setSettings(s: Partial<Settings>) {
    if (s.dayCycle === true && !this.settings.dayCycle) {
      // smoothly hand the sky back to the clock
      this.envFrom = this.currentEnv()
      this.envT = 0
      this.envDuration = 3
    }
    const prevH = this.settings.pixelHeight
    this.settings = { ...this.settings, ...s }
    if (s.autoWalk === true) this.lookOffset = { yaw: 0, pitch: 0 }
    if (s.riding !== undefined) this.applyRiding(s.riding)
    if (s.sound !== undefined) {
      this.audio.setEnabled(s.sound)
      if (s.sound) this.audio.unlock()
    }
    if (this.settings.pixelHeight !== prevH) this.resize()
  }

  // ---------- input ----------
  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return
    // while talking, keys belong to the conversation
    if (this.talking) return
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault()
      if (this.settings.autoWalk) this.setAutoWalk(false)
    }
    if (e.code === "Space") {
      e.preventDefault()
      this.togglePause()
      return
    }
    if (this.paused) return
    if (e.code === "KeyR") this.setAutoWalk(!this.settings.autoWalk)
    if (e.code === "KeyH" && !this.camping) this.setRiding(!this.settings.riding)
    if (e.code === "KeyE") {
      this.talk()
      return
    }
    if (this.talking) return
    if (e.code === "KeyC" && !this.inCourt) this.setCamp(!this.camping)
    if (e.code === "KeyM") {
      this.audio.setEnabled(!this.audio.on)
      this.settings = { ...this.settings, sound: this.audio.on }
      this.cb.onSound?.(this.audio.on)
    }
    this.audio.unlock()
    this.keys.add(e.code)
  }
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code)
  private onBlur = () => this.keys.clear()
  private onClick = () => {
    this.audio.unlock()
    if (document.pointerLockElement !== this.canvas) {
      // Chrome refuses a re-lock right after Esc; that is fine, just try again later
      const p = this.canvas.requestPointerLock?.() as Promise<void> | undefined
      p?.catch?.(() => {})
    }
  }
  private dragging: { x: number; y: number; id: number } | null = null
  private onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse") return
    this.dragging = { x: e.clientX, y: e.clientY, id: e.pointerId }
    const move = (ev: PointerEvent) => {
      if (!this.dragging || ev.pointerId !== this.dragging.id) return
      this.look((ev.clientX - this.dragging.x) * 2, (ev.clientY - this.dragging.y) * 2)
      this.dragging.x = ev.clientX
      this.dragging.y = ev.clientY
    }
    const up = () => {
      this.dragging = null
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }
  private onLockChange = () => this.cb.onPointerLock?.(document.pointerLockElement === this.canvas)
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== this.canvas) return
    this.look(e.movementX, e.movementY)
  }
  private look(dx: number, dy: number) {
    const k = 0.0022
    if (this.settings.autoWalk) {
      this.lookOffset.yaw = clamp(this.lookOffset.yaw + dx * k, -1.4, 1.4)
      this.lookOffset.pitch = clamp(this.lookOffset.pitch - dy * k, -0.6, 0.6)
    } else {
      this.yaw += dx * k
      this.pitch = clamp(this.pitch - dy * k, -1.2, 1.2)
    }
  }
  private setAutoWalk(on: boolean) {
    if (!on) {
      this.yaw += this.lookOffset.yaw
      this.pitch = clamp(this.pitch + this.lookOffset.pitch, -1.2, 1.2)
    }
    this.lookOffset = { yaw: 0, pitch: 0 }
    this.settings = { ...this.settings, autoWalk: on }
    this.cb.onAutoWalk?.(on)
  }

  private setRiding(on: boolean) {
    this.settings = { ...this.settings, riding: on }
    this.applyRiding(on)
    this.cb.onRiding?.(on)
  }

  /** Mount (the parked horse leaves the world) or dismount (it stays beside you). */
  private applyRiding(on: boolean) {
    if (on) {
      this.horseProp = null
    } else if (!this.horseProp) {
      const rx = Math.cos(this.yaw)
      const rz = Math.sin(this.yaw)
      this.parkHorse(this.pos.x + rx * 2.4, this.pos.z + rz * 2.4)
      this.rideSpeed = 0
      this.turnRate = 0
    }
  }

  /** (Re)bake prop shadows when the sun has moved; upload with the AO. */
  private refreshGround() {
    if (!this.groundAO || !this.props.length) return
    const sun = normalize(this.currentEnv().sunDir)
    const moved = !this.groundSun || Math.hypot(sun[0] - this.groundSun[0], sun[1] - this.groundSun[1], sun[2] - this.groundSun[2]) > 0.015
    if (!moved) return
    this.groundSun = sun
    const shadowCasters = this.horseProp ? [...this.props, this.horseProp] : this.props
    const sh = bakeShadows(shadowCasters, sun as [number, number, number])
    this.groundData = packGround(this.groundAO, sh, this.groundData ?? undefined)
    const gl = this.gl
    if (!this.groundTex) {
      this.groundTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.groundTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GROUND.w, GROUND.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.groundData)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.groundTex)
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GROUND.w, GROUND.h, gl.RGBA, gl.UNSIGNED_BYTE, this.groundData)
    }
  }

  private parkHorse(x: number, z: number) {
    this.horseProp = { x, y: terrainHeight(x, z) - 0.15, z, h: 2.5, key: "horse", sway: 0, phase: 0 }
    this.groundSun = null
  }

  // ---------- sizing ----------
  private resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    this.canvas.width = w
    this.canvas.height = h
    const scale = Math.max(1, Math.round(h / this.settings.pixelHeight))
    const lw = Math.ceil(w / scale)
    const lh = Math.ceil(h / scale)
    this.low = { w: lw, h: lh, scale, ox: (w - lw * scale) / 2, oy: (h - lh * scale) / 2 }

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0)
    gl.bindTexture(gl.TEXTURE_2D, this.depthTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.depthTex, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    this.rebuildHands()
  }

  /**
   * Hands keep the same on-screen size at any resolution. The painted images
   * are used once loaded; the procedural hands are only a loading fallback.
   */
  private rebuildHands(force = false) {
    const gl = this.gl
    const lh = this.low.h
    if (this.handImgs) {
      if (!force && lh === this.handsH) return
      this.handsH = lh
      this.spriteK = Math.max(1, Math.round(lh / 180))
      gl.deleteTexture(this.torchTex.tex)
      gl.deleteTexture(this.swordTex.tex)
      this.torchTex = this.uploadSprite(buildHandSprite(this.handImgs.torch, lh * 0.68, "torch"))
      this.swordTex = this.uploadSprite(buildHandSprite(this.handImgs.sword, lh * 0.96, "sword"))
      if (this.horseTex) gl.deleteTexture(this.horseTex.tex)
      this.horseTex = this.uploadSprite(buildHandSprite(this.handImgs.horse, lh * 0.52, "horse"))
      return
    }
    const k = Math.max(1, Math.round(lh / 180))
    if (k !== this.spriteK) {
      this.spriteK = k
      gl.deleteTexture(this.torchTex.tex)
      gl.deleteTexture(this.swordTex.tex)
      this.torchTex = this.uploadSprite(makeTorchSprite(k))
      this.swordTex = this.uploadSprite(makeSwordSprite(k))
    }
  }

  private uploadSprite(s: Sprite) {
    const gl = this.gl
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, s.w, s.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, s.data)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    return { tex, s }
  }

  // ---------- simulation ----------
  private pathYaw(z: number) {
    const ahead = z - 16
    const vx = pathX(ahead) - pathX(z)
    const pathYaw = Math.atan2(vx, 16)
    const cYaw = Math.atan2(CASTLE_X - pathX(z), z - CASTLE_Z)
    return lerp(pathYaw, cYaw, 0.35)
  }

  private currentEnv(): Environment {
    if (this.envCache) return this.envCache
    const t = this.envT * this.envT * (3 - 2 * this.envT)
    const target = this.settings.dayCycle ? dayEnv(this.hour) : this.envTo
    const env = mixEnv(this.envFrom, target, t)
    // weather leans on the sky: rain greys and dims it, fog thickens it
    const w = this.wx.amount
    if (this.wx.kind === "rain" && w > 0) {
      const grey: [number, number, number] = [0.42, 0.44, 0.56]
      env.sunColor = lerp3(env.sunColor, [env.sunColor[0] * 0.35, env.sunColor[1] * 0.37, env.sunColor[2] * 0.45], w)
      env.ambient = lerp3(env.ambient, [env.ambient[0] * 0.85, env.ambient[1] * 0.88, env.ambient[2] * 0.95], w)
      env.haze = lerp3(env.haze, grey, w * 0.7)
      env.horizon = lerp3(env.horizon, grey, w * 0.6)
      env.skyTop = lerp3(env.skyTop, [0.22, 0.23, 0.32], w * 0.6)
      env.cloudLit = lerp3(env.cloudLit, [0.6, 0.6, 0.7], w * 0.7)
      env.cloudShade = lerp3(env.cloudShade, [0.28, 0.28, 0.36], w * 0.7)
      env.cloudCover = lerp(env.cloudCover, 0.95, w)
      env.paintedSky *= 1 - w
      env.stars *= 1 - w
      env.fireflies *= 1 - w
      env.cloudHi = lerp3(env.cloudHi, env.cloudLit, w)
    } else if (this.wx.kind === "fog" && w > 0) {
      env.cloudBand = lerp(env.cloudBand, 1.2, w)
      env.haze = lerp3(env.haze, lerp3(env.cloudLit, env.haze, 0.5), w * 0.5)
      env.stars *= 1 - w * 0.7
    }
    return env
  }

  /** Fog and mist after weather. */
  private atmos() {
    const w = this.wx.amount
    const fogW = this.wx.kind === "fog" ? w : 0
    const rainW = this.wx.kind === "rain" ? w : 0
    return {
      fog: this.settings.fog * (1 + fogW * 3.5) + rainW * 0.0025,
      mist: this.settings.mist + fogW * 1.3 + rainW * 0.3,
      rain: rainW,
    }
  }

  /** Advance the clock and the weather. */
  private tickSky(dt: number) {
    if (this.settings.dayCycle) {
      // resting makes the evening pass quickly, until it's properly night
      const night = this.hour >= 21.5 || this.hour < 4
      if (this.campRush && night) this.campRush = false
      this.hour = (this.hour + dt * (this.campRush ? 0.55 : 24 / DAY_SECONDS)) % 24
    }
    const wx = this.wx
    const forced = this.settings.weather
    if (forced !== "auto") {
      if (wx.kind !== forced) {
        wx.amount = Math.max(0, wx.amount - dt / 6)
        if (wx.amount === 0) wx.kind = forced
      } else wx.amount = Math.min(forced === "clear" ? 0 : 1, wx.amount + dt / 12)
      return
    }
    // the sky changes its mind every few hours
    const due = ((this.hour - wx.at + 24) % 24) < 0.5 && wx.next !== wx.kind
    if (due) {
      wx.amount = Math.max(0, wx.amount - dt / 10)
      if (wx.amount === 0) {
        wx.kind = wx.next
        const r = Math.random()
        wx.next = wx.kind !== "clear" ? "clear" : r < 0.55 ? "rain" : "fog"
        wx.at = (this.hour + (wx.kind === "clear" ? 3 + Math.random() * 4 : 1.2 + Math.random() * 1.8)) % 24
      }
    } else if (wx.kind !== "clear") wx.amount = Math.min(1, wx.amount + dt / 25)
  }

  /** Clock for the HUD, e.g. "18:40". */
  clock() {
    const h = Math.floor(this.hour)
    const m = Math.floor((this.hour - h) * 60)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  }

  setHour(h: number) {
    this.hour = ((h % 24) + 24) % 24
  }

  private update(dt: number) {
    this.time += dt
    this.envT = Math.min(1, this.envT + dt / this.envDuration)
    const s = this.settings
    let speed = 0

    this.regionTimer -= dt
    if (this.regionTimer <= 0) {
      this.regionTimer = 0.25
      this.checkPlaces()
    }
    this.groundTimer -= dt
    if (this.groundTimer <= 0) {
      this.groundTimer = 0.35
      this.refreshGround()
    }
    this.placeNpcs()
    this.npcTimer -= dt
    if (this.npcTimer <= 0) {
      this.npcTimer = 0.2
      this.findNear()
    }
    const riding = s.riding
    this.mountT = clamp(this.mountT + (riding ? dt : -dt) / 0.9, 0, 1)
    this.campT = clamp(this.campT + (this.camping ? dt : -dt) / 1.6, 0, 1)
    if (!this.camping && this.campT === 0) this.campProp = null
    if (this.dawnTimer > 0) {
      this.dawnTimer -= dt
      if (this.dawnTimer <= 0) this.cb.onVerse?.(null)
    }

    if (this.talking) {
      // stand still and turn to face whoever you're talking to
      const p = this.talking.id === "horse" ? this.horseProp : this.npcProps.get(this.talking.id)
      if (p) {
        const want = Math.atan2(p.x - this.pos.x, -(p.z - this.pos.z))
        let dy = want - (this.yaw + this.lookOffset.yaw)
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        this.yaw += dy * (1 - Math.exp(-dt * 4))
        this.pitch += (-0.02 - this.pitch) * (1 - Math.exp(-dt * 3))
      }
      if (this.camping) this.campTime += dt
      if (this.settings.riding) this.rideSpeed *= Math.exp(-dt * 3)
    } else if (this.camping) {
      // sit, look into the fire for a moment, then the view is yours
      this.campTime += dt
      if (this.campTime < 2) this.pitch += (-0.16 - this.pitch) * (1 - Math.exp(-dt * 3))
      if (!this.verseShown && this.campTime > 4) {
        this.verseShown = true
        const verse = VERSES[this.verseIndex++ % VERSES.length]
        this.cb.onVerse?.(verse)
        updateSave((sv) => {
          if (!sv.verses.includes(verse)) sv.verses.push(verse)
        })
      }
      if (this.verseShown && this.campTime > 16 && this.campTime - dt <= 16) this.cb.onVerse?.(null)
    } else if (s.autoWalk && !this.inCourt) {
      if (riding) {
        this.rideSpeed += (4.2 - this.rideSpeed) * (1 - Math.exp(-dt * 1.5))
        speed = this.rideSpeed
      } else speed = 1.5
      if (!this.looping) {
        this.pos.z -= speed * dt
        this.pos.x = lerp(this.pos.x, pathX(this.pos.z) + Math.sin(this.time * 0.13) * 0.4, 1 - Math.exp(-dt * 2))
        const target = this.pathYaw(this.pos.z)
        this.yaw += (target - this.yaw) * (1 - Math.exp(-dt * 1.2))
        this.pitch += (0.04 - this.pitch) * (1 - Math.exp(-dt * 1.5))
        // arrive at the gate and stop: Sir Hallan is waiting
        if (this.pos.z < PATH_END_Z + 6) this.setAutoWalk(false)
      }
      // mouse look drifts back to the road
      const k = 1 - Math.exp(-dt * 0.6)
      if (document.pointerLockElement !== this.canvas && !this.dragging) {
        this.lookOffset.yaw -= this.lookOffset.yaw * k
        this.lookOffset.pitch -= this.lookOffset.pitch * k
      }
    } else if (riding) {
      const px = this.pos.x
      const pz = this.pos.z
      // the horse has weight: throttle and turning ease in and out
      const fwd = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0)
      const turn =
        (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0)
      const galloping = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")
      const target = fwd > 0 ? (galloping ? 9.5 : 4) : fwd < 0 ? -1.3 : 0
      const accel = target > this.rideSpeed ? 1.6 : 2.4
      this.rideSpeed += (target - this.rideSpeed) * (1 - Math.exp(-dt * accel))
      const maxTurn = lerp(1.5, 0.75, smoothstep(4, 9.5, Math.abs(this.rideSpeed)))
      this.turnRate += (turn * maxTurn - this.turnRate) * (1 - Math.exp(-dt * 4))
      this.yaw += this.turnRate * dt
      this.pos.x += Math.sin(this.yaw) * this.rideSpeed * dt
      this.pos.z -= Math.cos(this.yaw) * this.rideSpeed * dt
      this.bound(px, pz)
      speed = Math.abs(this.rideSpeed)
    } else {
      const fwd = (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0)
      const str = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0)
      const turn = (this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("ArrowLeft") ? 1 : 0)
      this.yaw += turn * dt * 1.6
      const run = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") ? 2.2 : 1
      const len = Math.hypot(fwd, str)
      if (len > 0) {
        const px = this.pos.x
        const pz = this.pos.z
        speed = 2.2 * run
        const fx = Math.sin(this.yaw)
        const fz = -Math.cos(this.yaw)
        const rx = Math.cos(this.yaw)
        const rz = Math.sin(this.yaw)
        this.pos.x += ((fx * fwd + rx * str) / len) * speed * dt
        this.pos.z += ((fz * fwd + rz * str) / len) * speed * dt
        this.bound(px, pz)
      }
    }

    // loop the walk with a fade through black
    if (this.looping) {
      this.fade = Math.max(0, this.fade - dt / 1.2)
      if (this.fade === 0 && this.teleport) {
        const t = this.teleport
        this.teleport = null
        this.pos = { x: t.x, z: t.z }
        this.yaw = t.yaw
        this.lookOffset = { yaw: 0, pitch: 0 }
        this.pitch = 0.02
        this.camY = terrainHeight(t.x, t.z) + EYE
        this.looping = false
        if (t.court !== this.inCourt) {
          this.inCourt = t.court
          this.cb.onCourtyard?.(t.court)
          if (t.court) this.audio.cue("discover")
        }
      } else if (this.fade === 0) {
        this.inCourt = false
        this.pos.z = PATH_START_Z
        this.pos.x = pathX(PATH_START_Z)
        this.yaw = this.pathYaw(this.pos.z)
        this.camY = terrainHeight(this.pos.x, this.pos.z) + (this.settings.riding ? EYE_RIDING : EYE)
        this.looping = false
      }
    } else {
      this.fade = Math.min(1, this.fade + dt / 1.6)
    }

    this.moving += ((speed > 0.1 ? 1 : 0) - this.moving) * (1 - Math.exp(-dt * 5))
    if (riding) {
      // walk is a 4-beat gait (two bumps per stride); gallop a slower, bigger roll
      this.gallop += (smoothstep(5, 8.5, speed) - this.gallop) * (1 - Math.exp(-dt * 3))
      this.ridePhase += dt * Math.PI * 2 * lerp(1.45, 2.2, this.gallop) * Math.min(1, speed / 1.5)
    } else {
      this.bobPhase += speed * dt * 2.3
    }
    const ground = terrainHeight(this.pos.x, this.pos.z)
    const eye = lerp(lerp(EYE, EYE_RIDING, easeInOut(this.mountT)), EYE_SITTING, easeInOut(this.campT))
    this.camY += (ground + eye - this.camY) * (1 - Math.exp(-dt * 10))
  }

  private torchFlicker() {
    const t = this.time
    const f =
      0.84 +
      0.07 * Math.sin(t * 13.1) +
      0.05 * Math.sin(t * 23.7 + 1.3) +
      0.16 * (vnoise(t * 6.3, 0.5) - 0.5) +
      0.08 * (vnoise(t * 17, 3.1) - 0.5)
    return f * this.settings.torch
  }

  // ---------- rendering ----------
  private frame = (now: number) => {
    const dt = Math.min((now - this.last) / 1000, 0.05)
    this.last = now
    this.envCache = null
    if (!this.paused) {
      this.tickSky(dt)
      this.update(dt)
    }
    this.envCache = this.currentEnv()
    this.render()
    const env = this.envCache
    if (!this.paused) this.audio.update(dt, {
      speed: this.settings.riding ? Math.abs(this.rideSpeed) : this.moving * (this.settings.autoWalk ? 1.5 : 2.2),
      riding: this.settings.riding && this.mountT > 0.5,
      gallop: this.gallop,
      ridePhase: this.ridePhase,
      bobPhase: this.bobPhase,
      camping: this.camping,
      night: env.stars,
      wind: this.settings.wind,
      rain: this.wx.kind === "rain" ? this.wx.amount : 0,
    })
    this.envCache = null
    this.fpsAcc.t += dt
    this.fpsAcc.n++
    if (this.fpsAcc.t > 0.5) {
      this.cb.onFps?.(Math.round(this.fpsAcc.n / this.fpsAcc.t))
      this.fpsAcc = { t: 0, n: 0 }
    }
    this.raf = requestAnimationFrame(this.frame)
  }

  /** Cull, sort back-to-front and pack visible billboards. Returns count. */
  private fillBillboards(cam: number[], fwd: number[]) {
    const atlas = this.atlas!
    const props = this.props
    const extras = [this.horseProp, this.campProp, ...this.npcProps.values()].filter((p): p is Prop => p !== null)
    const total = props.length + extras.length
    const get = (i: number) => (i < props.length ? props[i] : extras[i - props.length])
    let n = 0
    for (let i = 0; i < total; i++) {
      const p = get(i)
      const dx = p.x - cam[0]
      const dz = p.z - cam[2]
      const along = dx * fwd[0] + dz * fwd[2]
      const d2 = dx * dx + dz * dz
      const reach = p.h * 1.2
      if (along < -reach || d2 > 700 * 700) continue
      this.propOrder[n] = i
      this.propDist[i] = d2
      n++
    }
    const order = Array.from(this.propOrder.subarray(0, n)).sort((a, b) => this.propDist[b] - this.propDist[a])
    const out = this.bbData
    for (let k = 0; k < n; k++) {
      const p = get(order[k])
      const e = atlas.entries[p.key]
      const o = k * BB_FLOATS
      out[o] = p.x
      out[o + 1] = p.y
      out[o + 2] = p.z
      out[o + 3] = p.h * e.aspect
      out[o + 4] = p.h
      out[o + 5] = e.u0
      out[o + 6] = e.v0
      out[o + 7] = e.u1
      out[o + 8] = e.v1
      out[o + 9] = p.sway
      out[o + 10] = p.glow ? -1 : p.phase
      out[o + 11] = p.tint ?? 0
    }
    return n
  }

  private render() {
    const gl = this.gl
    const { w, h, scale } = this.low
    const env = this.currentEnv()
    const s = this.settings
    const torch = this.torchFlicker()
    const torchColor: [number, number, number] = [1.0, 0.6, 0.28]

    // camera basis
    const ct = easeInOut(this.campT)
    const mt = easeInOut(this.mountT)
    const rp = this.ridePhase
    const gaitAmp = lerp(0.03, 0.1, this.gallop) * this.moving
    const gait = lerp(Math.sin(rp * 2), Math.sin(rp) * 0.75 + Math.sin(rp * 2) * 0.25, this.gallop)
    const bob = lerp(Math.sin(this.bobPhase * 2) * 0.035 * this.moving, gait * gaitAmp, mt)
    const sway = lerp(Math.sin(this.bobPhase) * 0.012 * this.moving, Math.sin(rp) * 0.01 * this.moving, mt)
    const breathe = Math.sin(this.time * 1.4) * 0.006
    const rock = Math.sin(rp + 0.8) * gaitAmp * 0.22 * mt
    const yaw = this.yaw + this.lookOffset.yaw + sway * 0.3
    const pitch = this.pitch + this.lookOffset.pitch + breathe + rock
    const cp = Math.cos(pitch)
    const fwd = [Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]
    const right = [Math.cos(yaw), 0, Math.sin(yaw)]
    const up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ]
    const cam = [this.pos.x + right[0] * sway, this.camY + bob, this.pos.z + right[2] * sway]
    // a touch wider at a gallop: speed you can feel
    const tanHalf = Math.tan((FOV + this.gallop * this.moving * mt * ((7 * Math.PI) / 180)) / 2)

    // sprite layout (low-res pixels, top-left origin)
    const ss = this.spriteK
    const gaitPx = lerp(2, 7, this.gallop) * this.moving * ss
    const handBobX = Math.round(lerp(Math.sin(this.bobPhase) * 2.5 * this.moving * ss, Math.sin(rp) * 1.5 * this.moving * ss, mt))
    const handBobY = Math.round(
      lerp(Math.abs(Math.sin(this.bobPhase)) * 3 * this.moving * ss, gait * gaitPx * 0.8, mt) + Math.sin(this.time * 1.4) * 1.2 * ss,
    )
    const torchS = this.torchTex.s
    const swordS = this.swordTex.s
    const swordBob = Math.round(Math.abs(Math.cos(this.bobPhase)) * 3 * this.moving * ss)
    const anchor = torchS.anchor
    let torchX: number, torchY: number, swordX: number, swordY: number
    let fs: number, flameX: number, flameY: number
    if (anchor) {
      // painted hands: arms run off the bottom corners
      torchX = Math.round(Math.max(w * 0.2, torchS.w * 0.55) - torchS.w * 0.5) + handBobX
      torchY = h - torchS.h + Math.round(h * 0.06) + handBobY
      swordX = Math.round(Math.min(w * 0.8, w - swordS.w * 0.42) - swordS.w * 0.5) - handBobX
      swordY = h - swordS.h + Math.round(h * 0.1) + swordBob
      fs = Math.max(1, Math.round((anchor.w * 1.25) / FLAME_SIZE.w))
      flameX = torchX + Math.round(anchor.x - (FLAME_SIZE.w * fs) / 2)
      flameY = torchY + Math.round(anchor.y + anchor.w * 0.35 - FLAME_SIZE.h * fs)
    } else {
      torchX = Math.round(Math.max(w * 0.13, 30 * ss) - torchS.w / 2) + handBobX
      torchY = h + 14 * ss - torchS.h + handBobY
      swordX = Math.round(Math.min(w * 0.82, w - 26 * ss) - swordS.w / 2) - handBobX
      swordY = h + 34 * ss - swordS.h + swordBob
      fs = ss
      flameX = torchX + Math.round((TORCH_FLAME_ANCHOR.x - FLAME_SIZE.w / 2) * ss)
      flameY = torchY + Math.round((TORCH_FLAME_ANCHOR.y + 4 - FLAME_SIZE.h) * ss)
    }
    // sitting by the fire: torch planted, sword laid down
    const away = Math.round(ct * h * 0.95)
    torchY += away
    swordY += away
    flameY += away
    const flameCx = flameX + (FLAME_SIZE.w * fs) / 2
    const flameCy = flameY + FLAME_SIZE.h * fs * 0.7

    // world-space torch: unproject the flame's screen position ~0.7m ahead
    const nx = (flameCx / w) * 2 - 1
    const ny = 1 - (flameCy / h) * 2
    const aspect = w / h
    const dir = [0, 1, 2].map((i) => fwd[i] + right[i] * nx * tanHalf * aspect + up[i] * ny * tanHalf)
    const dl = Math.hypot(dir[0], dir[1], dir[2])
    const handTorch = [0, 1, 2].map((i) => cam[i] + (dir[i] / dl) * 0.7)
    // at camp the campfire takes over as the light: bigger, lower, its own flicker
    const fire = this.campProp
    const firePos = fire ? [fire.x, fire.y + 0.55, fire.z] : handTorch
    const torchPos = [0, 1, 2].map((i) => lerp(handTorch[i], firePos[i], fire ? ct : 0))
    const fireFlicker = 0.85 + 0.1 * Math.sin(this.time * 9.3) + 0.12 * (vnoise(this.time * 4.1, 7.7) - 0.5)
    const lightAmt = lerp(torch, fireFlicker * 0.95, fire ? ct : 0)
    const torchWorld = lerp(env.torchWorld, 1, ct)

    // hands take the scene's light: sun + sky, slightly lifted so they read
    const tint = [0, 1, 2].map((i) => env.sunColor[i] * 0.62 + env.ambient[i] * 0.55)
    const lum = tint[0] * 0.3 + tint[1] * 0.59 + tint[2] * 0.11 || 1
    // ~0.8 is the light level the painted art was made for; night darkens it
    const dayness = Math.min(1.1, lum / 0.8)
    const handLight = tint.map((c) => lerp(1, c / lum, 0.35) * (anchor ? 0.95 : 1.15) * Math.max(0.4, dayness))
    // painted props are drawn for the sunset look; other moods tint them
    const propTint = tint.map((c, i) => (lerp(1, c / lum, 0.5) * lerp(0.92, 1, env.paintedSky) + (i === 2 ? 0.02 : 0)) * dayness)

    const ground0 = terrainHeight(this.pos.x, this.pos.z)

    // ---- pass 1: scene ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene)
    gl.viewport(0, 0, w, h)
    gl.bindVertexArray(this.vao)
    gl.disable(gl.BLEND)
    let P = this.scene
    gl.useProgram(P.p)
    gl.uniform2f(loc(gl, P, "uRes"), w, h)
    gl.uniform1f(loc(gl, P, "uTime"), this.time)
    gl.uniform3fv(loc(gl, P, "uCamPos"), cam)
    gl.uniform3fv(loc(gl, P, "uCamRight"), right)
    gl.uniform3fv(loc(gl, P, "uCamUp"), up)
    gl.uniform3fv(loc(gl, P, "uCamFwd"), fwd)
    gl.uniform1f(loc(gl, P, "uTanHalfFov"), tanHalf)
    gl.uniform3fv(loc(gl, P, "uTorchPos"), torchPos)
    gl.uniform3fv(loc(gl, P, "uTorchColor"), torchColor)
    gl.uniform1f(loc(gl, P, "uTorch"), lightAmt)
    const atm = this.atmos()
    gl.uniform1f(loc(gl, P, "uFog"), atm.fog)
    gl.uniform1f(loc(gl, P, "uMist"), atm.mist)
    gl.uniform1f(loc(gl, P, "uWind"), s.wind)
    gl.uniform1f(loc(gl, P, "uWindowGlow"), env.windowGlow)
    gl.uniform1f(loc(gl, P, "uTorchWorld"), torchWorld)
    gl.uniform1f(loc(gl, P, "uStars"), env.stars)
    gl.uniform1f(loc(gl, P, "uCloudCover"), env.cloudCover)
    gl.uniform1f(loc(gl, P, "uCloudBand"), env.cloudBand)
    gl.uniform1f(loc(gl, P, "uGround"), ground0)
    gl.uniform3fv(loc(gl, P, "uSkyTop"), env.skyTop)
    gl.uniform3fv(loc(gl, P, "uHorizon"), env.horizon)
    gl.uniform3fv(loc(gl, P, "uSunColor"), env.sunColor)
    gl.uniform3fv(loc(gl, P, "uSunDir"), normalize(env.sunDir))
    gl.uniform3fv(loc(gl, P, "uAmbient"), env.ambient)
    gl.uniform3fv(loc(gl, P, "uHaze"), env.haze)
    gl.uniform3fv(loc(gl, P, "uCloudLit"), env.cloudLit)
    gl.uniform3fv(loc(gl, P, "uCloudShade"), env.cloudShade)
    gl.uniform3fv(loc(gl, P, "uCloudHi"), env.cloudHi)
    gl.uniform1f(loc(gl, P, "uCel"), env.cel)
    gl.uniform3f(loc(gl, P, "uCastle"), CASTLE_X, CASTLE_Y, CASTLE_Z)
    const painted = this.skyTex ? env.paintedSky : 0
    const propsReady = this.atlasTex && this.props.length > 0
    gl.uniform1f(loc(gl, P, "uPainted"), painted)
    gl.uniform1f(loc(gl, P, "uSdfProps"), propsReady ? 0 : 1)
    gl.uniform1f(loc(gl, P, "uSdfCastle"), propsReady ? 0 : 1)
    gl.uniform4f(loc(gl, P, "uLake"), LAKE.x, LAKE.z, LAKE.rx, LAKE.rz)
    gl.uniform1f(loc(gl, P, "uWaterY"), WATER_Y)
    gl.uniform1f(loc(gl, P, "uLakeFloor"), LAKE_FLOOR)
    gl.uniform4f(loc(gl, P, "uCourt"), COURT.x, COURT_Y, COURT.z, COURT.size)
    gl.uniform4f(loc(gl, P, "uGroundRect"), GROUND.x0, GROUND.z0, GROUND.w, GROUND.h)
    gl.uniform1f(loc(gl, P, "uGroundOn"), this.groundTex ? 1 : 0)
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, this.groundTex)
    gl.uniform1i(loc(gl, P, "uGroundMap"), 2)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.skyTex)
    gl.uniform1i(loc(gl, P, "uSky"), 0)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // ---- pass 1b: painted billboards (trees, props, castle) ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
    if (propsReady) {
      const n = this.fillBillboards(cam, fwd)
      gl.bindVertexArray(this.bbVao)
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bbBuf)
      gl.bufferData(gl.ARRAY_BUFFER, this.bbData.subarray(0, n * BB_FLOATS), gl.DYNAMIC_DRAW)
      P = this.billboard
      gl.useProgram(P.p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex)
      gl.uniform1i(loc(gl, P, "uAtlas"), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex)
      gl.uniform1i(loc(gl, P, "uDepth"), 1)
      gl.uniform2f(loc(gl, P, "uRes"), w, h)
      gl.uniform3fv(loc(gl, P, "uCamPos"), cam)
      gl.uniform3fv(loc(gl, P, "uCamRight"), right)
      gl.uniform3fv(loc(gl, P, "uCamUp"), up)
      gl.uniform3fv(loc(gl, P, "uCamFwd"), fwd)
      gl.uniform1f(loc(gl, P, "uTanHalfFov"), tanHalf)
      gl.uniform1f(loc(gl, P, "uAspect"), w / h)
      gl.uniform1f(loc(gl, P, "uTime"), this.time)
      gl.uniform1f(loc(gl, P, "uWind"), s.wind)
      gl.uniform1f(loc(gl, P, "uFog"), atm.fog)
      gl.uniform1f(loc(gl, P, "uCloudBand"), env.cloudBand)
      gl.uniform1f(loc(gl, P, "uBandY"), CASTLE_Y - 6)
      gl.uniform3fv(loc(gl, P, "uTint"), propTint)
      gl.uniform3fv(loc(gl, P, "uHaze"), env.haze)
      gl.uniform3fv(loc(gl, P, "uHorizon"), env.horizon)
      gl.uniform3fv(loc(gl, P, "uSunColor"), env.sunColor)
      gl.uniform3fv(loc(gl, P, "uSunDir"), normalize(env.sunDir))
      gl.uniform3fv(loc(gl, P, "uCloudLit"), env.cloudLit)
      gl.uniform3fv(loc(gl, P, "uTorchPos"), torchPos)
      gl.uniform3fv(loc(gl, P, "uTorchColor"), torchColor)
      gl.uniform1f(loc(gl, P, "uTorch"), lightAmt)
      gl.uniform1f(loc(gl, P, "uTorchWorld"), torchWorld)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindVertexArray(this.vao)
    }

    // ---- pass 1c: fireflies + campfire embers (additive points) ----
    const embers = fire ? ct : 0
    if (env.fireflies > 0.01 || embers > 0.01) {
      P = this.particles
      gl.useProgram(P.p)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.depthTex)
      gl.uniform1i(loc(gl, P, "uDepth"), 1)
      gl.uniform2f(loc(gl, P, "uRes"), w, h)
      gl.uniform3fv(loc(gl, P, "uCamPos"), cam)
      gl.uniform3fv(loc(gl, P, "uCamRight"), right)
      gl.uniform3fv(loc(gl, P, "uCamUp"), up)
      gl.uniform3fv(loc(gl, P, "uCamFwd"), fwd)
      gl.uniform3fv(loc(gl, P, "uFirePos"), fire ? [fire.x, fire.y, fire.z] : cam)
      gl.uniform1f(loc(gl, P, "uTanHalfFov"), tanHalf)
      gl.uniform1f(loc(gl, P, "uAspect"), w / h)
      gl.uniform1f(loc(gl, P, "uTime"), this.time)
      gl.uniform1f(loc(gl, P, "uGround"), ground0)
      gl.uniform1f(loc(gl, P, "uCount"), FIREFLIES)
      gl.uniform1f(loc(gl, P, "uFireflies"), env.fireflies)
      gl.uniform1f(loc(gl, P, "uEmbers"), embers)
      gl.uniform1f(loc(gl, P, "uWind"), s.wind)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.ONE, gl.ONE)
      gl.drawArrays(gl.POINTS, 0, FIREFLIES + (embers > 0.01 ? EMBERS : 0))
      gl.disable(gl.BLEND)
      gl.activeTexture(gl.TEXTURE0)
    }

    // ---- pass 2: hands + flame ----
    const toGl = (x: number, y: number, sw: number, sh: number) => [x, h - (y + sh), sw, sh]
    const drawSprite = (t: { tex: WebGLTexture; s: Sprite }, x: number, y: number) => {
      const Q = this.sprite
      gl.useProgram(Q.p)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, t.tex)
      gl.uniform1i(loc(gl, Q, "uTex"), 0)
      gl.uniform4fv(loc(gl, Q, "uRect"), toGl(x, y, t.s.w, t.s.h))
      gl.uniform2f(loc(gl, Q, "uRes"), w, h)
      gl.uniform2f(loc(gl, Q, "uSize"), t.s.w, t.s.h)
      gl.uniform2f(loc(gl, Q, "uFlame"), flameCx, h - flameCy)
      gl.uniform1f(loc(gl, Q, "uLightR"), h * 0.75)
      gl.uniform1f(loc(gl, Q, "uTorch"), torch)
      gl.uniform1f(loc(gl, Q, "uGlint"), this.bobPhase * 1.5 + this.time * 0.4)
      gl.uniform1f(loc(gl, Q, "uTime"), this.time)
      gl.uniform3fv(loc(gl, Q, "uTorchColor"), torchColor)
      gl.uniform3fv(loc(gl, Q, "uHandLight"), handLight)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    // on horseback the sword is sheathed and the horse's neck rises into view
    if (this.horseTex && mt > 0.01) {
      const hs = this.horseTex.s
      const ax = hs.anchor ? hs.anchor.x : hs.w / 2
      const hx = Math.round(w * 0.5 - ax + Math.sin(rp) * 1.5 * this.moving * ss)
      const hy = h - hs.h + Math.round(h * 0.06 + (1 - mt) * h * 0.85 + Math.sin(rp * 2 + 0.6) * gaitPx)
      drawSprite(this.horseTex, hx, hy)
    }
    if (mt < 0.99 && ct < 0.99) drawSprite(this.swordTex, swordX, swordY + Math.round(mt * h * 0.9))
    if (ct < 0.99) drawSprite(this.torchTex, torchX, torchY)
    P = this.flame
    gl.useProgram(P.p)
    gl.uniform4fv(loc(gl, P, "uRect"), toGl(flameX, flameY, FLAME_SIZE.w * fs, FLAME_SIZE.h * fs))
    gl.uniform2f(loc(gl, P, "uRes"), w, h)
    gl.uniform2f(loc(gl, P, "uSize"), FLAME_SIZE.w * fs, FLAME_SIZE.h * fs)
    gl.uniform1f(loc(gl, P, "uK"), fs)
    gl.uniform1f(loc(gl, P, "uTime"), this.time)
    gl.uniform1f(loc(gl, P, "uWind"), s.wind)
    gl.uniform1f(loc(gl, P, "uTorch"), torch)
    if (ct < 0.99) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // ---- pass 3: palette + dither + upscale ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    P = this.post
    gl.useProgram(P.p)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex)
    gl.uniform1i(loc(gl, P, "uScene"), 0)
    gl.uniform2f(loc(gl, P, "uLowRes"), w, h)
    gl.uniform2f(loc(gl, P, "uOffset"), this.low.ox, this.low.oy)
    gl.uniform1f(loc(gl, P, "uScale"), scale)
    gl.uniform1f(loc(gl, P, "uDither"), s.dither)
    gl.uniform1f(loc(gl, P, "uGrade"), s.grade ? 1 : 0)
    gl.uniform1f(loc(gl, P, "uRain"), atm.rain)
    gl.uniform1f(loc(gl, P, "uTime"), this.time)
    gl.uniform1f(loc(gl, P, "uWind"), s.wind)
    gl.uniform1f(loc(gl, P, "uFade"), this.fade)
    const pal = s.palette !== "off" ? PALETTES[s.palette] : undefined
    gl.uniform1i(loc(gl, P, "uUsePal"), pal ? 1 : 0)
    if (pal) {
      const flat = new Float32Array(MAX_PALETTE * 3)
      pal.colors.slice(0, MAX_PALETTE).forEach((c, i) => flat.set(c, i * 3))
      gl.uniform3fv(loc(gl, P, "uPal"), flat)
      gl.uniform1i(loc(gl, P, "uPalN"), Math.min(MAX_PALETTE, pal.colors.length))
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}

function normalize(v: number[]) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

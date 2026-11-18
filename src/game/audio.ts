/**
 * Ambient sound, synthesised with Web Audio — no sound files. Like
 * BRICKLAND's flight ambience, the wind is filtered noise whose level and
 * brightness follow your speed; everything else is short generated voices:
 *
 *   wind      — looping brown noise, gusting, louder and brighter when moving
 *   birds     — sparse little chirps by day
 *   crickets  — pulsed high tones at night
 *   fire      — low rumble + random crackles while camping
 *   steps     — soft thuds on each footfall, hoof clops on each gait beat
 *   cues      — little interface chimes (after BRICKLAND's cue table)
 *   music     — a slow generative harp over a soft drone, never the same twice
 *
 * Browsers only allow audio after a user gesture, so call unlock() from one.
 */

export interface AudioState {
  /** ground speed, m/s */
  speed: number
  riding: boolean
  /** 0 walk … 1 gallop */
  gallop: number
  /** horse gait phase (radians) */
  ridePhase: number
  /** walking bob phase (radians) */
  bobPhase: number
  camping: boolean
  /** 0 day … 1 night */
  night: number
  /** wind slider */
  wind: number
}

const STORAGE_KEY = "winterfell-sound"
const MUSIC_KEY = "winterfell-music"

type Note = { f: number; f1?: number; at?: number; dur: number; gain: number; type?: OscillatorType }
/** Short chimes: frequencies in Hz, offsets in seconds. */
const CUES: Record<string, Note[]> = {
  click: [{ f: 880, f1: 620, dur: 0.065, gain: 0.05, type: "triangle" }],
  pause: [{ f: 523.25, dur: 0.15, gain: 0.05 }, { f: 392, at: 0.075, dur: 0.19, gain: 0.045 }],
  resume: [{ f: 392, dur: 0.15, gain: 0.045 }, { f: 523.25, at: 0.075, dur: 0.22, gain: 0.05 }],
  home: [{ f: 523.25, dur: 0.22, gain: 0.045 }, { f: 659.25, at: 0.09, dur: 0.24, gain: 0.04 }, { f: 783.99, at: 0.18, dur: 0.36, gain: 0.035 }],
  region: [{ f: 783.99, dur: 0.3, gain: 0.022 }, { f: 1174.66, at: 0.12, dur: 0.4, gain: 0.016 }],
  discover: [
    { f: 587.33, dur: 0.4, gain: 0.04 },
    { f: 880, at: 0.12, dur: 0.45, gain: 0.035 },
    { f: 1174.66, at: 0.24, dur: 0.7, gain: 0.03 },
    { f: 1396.91, at: 0.36, dur: 0.9, gain: 0.018 },
  ],
}

/** D dorian, two octaves: the harp wanders over these. */
const SCALE = [146.83, 164.81, 174.61, 196, 220, 246.94, 261.63, 293.66, 329.63, 349.23, 392, 440, 493.88, 523.25]
/** drone roots it drifts between (D, F, C, G) */
const ROOTS = [73.42, 87.31, 65.41, 98]

export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private windGain: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private fireGain: GainNode | null = null
  private noise: AudioBuffer | null = null
  private white: AudioBuffer | null = null
  private enabled = true
  private gust = 0
  private gustTarget = 0
  private gustTimer = 0
  private crackleTimer = 0
  private birdTimer = 3
  private cricketTimer = 1
  private lastBob = 0
  private lastRide = 0
  private musicEnabled = true
  private musicBus: GainNode | null = null
  private delayIn: GainNode | null = null
  private drone: OscillatorNode[] = []
  private droneTimer = 0
  private rootIndex = 0
  private phraseTimer = 2
  private noteIndex = 6

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== "off"
      this.musicEnabled = localStorage.getItem(MUSIC_KEY) !== "off"
    } catch {
      /* storage can be unavailable */
    }
  }

  get on() {
    return this.enabled
  }

  get musicOn() {
    return this.musicEnabled
  }

  setMusic(on: boolean) {
    this.musicEnabled = on
    try {
      localStorage.setItem(MUSIC_KEY, on ? "on" : "off")
    } catch {
      /* ignore */
    }
    if (this.ctx && this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.55 : 0, this.ctx.currentTime, 0.8)
  }

  /** Freeze everything while the game is paused. */
  setPaused(paused: boolean) {
    if (!this.ctx) return
    // give the pause chime a moment to sound before suspending
    if (paused) setTimeout(() => void this.ctx?.suspend(), 450)
    else void this.ctx.resume()
  }

  cue(name: keyof typeof CUES | string) {
    const ctx = this.ctx
    if (!ctx || !this.master || ctx.state !== "running") return
    const t = ctx.currentTime
    for (const n of CUES[name] ?? []) this.tone(n.f, n.f1 ?? n.f * 0.995, t + (n.at ?? 0), n.dur, n.gain, n.type ?? "sine")
  }

  setEnabled(on: boolean) {
    this.enabled = on
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off")
    } catch {
      /* ignore */
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.2)
  }

  /** Create the graph on the first gesture; resume afterwards. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      this.ctx = new AC()
      this.build(this.ctx)
    }
    if (this.ctx.state === "suspended") void this.ctx.resume()
  }

  private build(ctx: AudioContext) {
    this.master = ctx.createGain()
    this.master.gain.value = this.enabled ? 0.9 : 0
    this.master.connect(ctx.destination)

    // 4 s of brown noise, ends blended so the loop has no click
    const len = ctx.sampleRate * 4
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    let b = 0
    for (let i = 0; i < len; i++) {
      b = b * 0.985 + (Math.random() * 2 - 1) * 0.06
      d[i] = b * 3
    }
    const fade = ctx.sampleRate * 0.2
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t
    }
    this.white = ctx.createBuffer(1, ctx.sampleRate * 0.25, ctx.sampleRate)
    const w = this.white.getChannelData(0)
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1

    // wind bed
    const wind = ctx.createBufferSource()
    wind.buffer = this.noise
    wind.loop = true
    const hp = ctx.createBiquadFilter()
    hp.type = "highpass"
    hp.frequency.value = 140
    this.windFilter = ctx.createBiquadFilter()
    this.windFilter.type = "lowpass"
    this.windFilter.frequency.value = 500
    this.windFilter.Q.value = 0.5
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    wind.connect(hp).connect(this.windFilter).connect(this.windGain).connect(this.master)
    wind.start()

    // campfire rumble (crackles are scheduled separately)
    const rumble = ctx.createBufferSource()
    rumble.buffer = this.noise
    rumble.loop = true
    rumble.loopStart = 1.3
    const lp = ctx.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.value = 260
    this.fireGain = ctx.createGain()
    this.fireGain.gain.value = 0
    rumble.connect(lp).connect(this.fireGain).connect(this.master)
    rumble.start(0, 1.3)

    // music bus: a dry path plus a soft feedback echo for space
    this.musicBus = ctx.createGain()
    this.musicBus.gain.value = this.musicEnabled ? 0.55 : 0
    this.musicBus.connect(this.master)
    this.delayIn = ctx.createGain()
    const delay = ctx.createDelay(1.5)
    delay.delayTime.value = 0.46
    const fb = ctx.createGain()
    fb.gain.value = 0.38
    const tone = ctx.createBiquadFilter()
    tone.type = "lowpass"
    tone.frequency.value = 1700
    this.delayIn.connect(delay)
    delay.connect(tone).connect(fb).connect(delay)
    tone.connect(this.musicBus)
    // the drone: two soft sines a fifth apart, breathing slowly
    const droneGain = ctx.createGain()
    droneGain.gain.value = 0.018
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const lfoAmt = ctx.createGain()
    lfoAmt.gain.value = 0.008
    lfo.connect(lfoAmt).connect(droneGain.gain)
    lfo.start()
    for (const mult of [1, 1.5]) {
      const o = ctx.createOscillator()
      o.type = "sine"
      o.frequency.value = ROOTS[0] * mult
      o.connect(droneGain)
      o.start()
      this.drone.push(o)
    }
    droneGain.connect(this.musicBus)
  }

  /** One plucked note: bright attack, long soft decay, into the echo. */
  private pluck(f: number, at: number, gain: number) {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = "triangle"
    o.frequency.value = f
    const o2 = ctx.createOscillator()
    o2.type = "sine"
    o2.frequency.value = f * 2.001
    const lp = ctx.createBiquadFilter()
    lp.type = "lowpass"
    lp.frequency.setValueAtTime(f * 8, at)
    lp.frequency.exponentialRampToValueAtTime(f * 2, at + 1.2)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6)
    const g2 = ctx.createGain()
    g2.gain.value = 0.25
    o.connect(lp)
    o2.connect(g2).connect(lp)
    lp.connect(g)
    g.connect(this.musicBus!)
    g.connect(this.delayIn!)
    o.start(at)
    o2.start(at)
    o.stop(at + 2.7)
    o2.stop(at + 2.7)
  }

  /** A short phrase that steps around the scale, sometimes leaping. */
  private phrase(night: number) {
    const t = this.ctx!.currentTime + 0.05
    const notes = 2 + Math.floor(Math.random() * 4)
    let at = t
    for (let i = 0; i < notes; i++) {
      const step = Math.random() < 0.15 ? (Math.random() < 0.5 ? -3 : 3) : Math.random() < 0.5 ? -1 : 1
      this.noteIndex = Math.max(1, Math.min(SCALE.length - 1, this.noteIndex + step))
      // a little lower and slower at night
      const f = SCALE[this.noteIndex] * (night > 0.6 ? 0.5 : 1)
      this.pluck(f, at, 0.05 - i * 0.006)
      at += (0.32 + Math.random() * 0.36) * (1 + night * 0.4)
    }
  }

  update(dt: number, s: AudioState) {
    const ctx = this.ctx
    if (!ctx || !this.master || ctx.state !== "running") return
    const now = ctx.currentTime

    // wind: slow random gusts, more with speed
    this.gustTimer -= dt
    if (this.gustTimer <= 0) {
      this.gustTimer = 2 + Math.random() * 4
      this.gustTarget = Math.random()
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.6)
    const sp = Math.min(1, s.speed / 9.5)
    const windLevel = 0.012 + s.wind * 0.018 * (0.5 + this.gust) + sp * sp * 0.09
    this.windGain!.gain.setTargetAtTime(windLevel, now, 0.3)
    this.windFilter!.frequency.setTargetAtTime(380 + this.gust * 300 + sp * 1600, now, 0.3)

    // music: phrases with long rests; the drone shifts root now and then
    if (this.musicEnabled) {
      this.phraseTimer -= dt
      if (this.phraseTimer <= 0) {
        this.phraseTimer = 3.5 + Math.random() * 5
        this.phrase(s.night)
      }
      this.droneTimer -= dt
      if (this.droneTimer <= 0) {
        this.droneTimer = 18 + Math.random() * 14
        this.rootIndex = (this.rootIndex + 1 + Math.floor(Math.random() * 2)) % ROOTS.length
        const r = ROOTS[this.rootIndex]
        this.drone[0]?.frequency.setTargetAtTime(r, now, 3)
        this.drone[1]?.frequency.setTargetAtTime(r * 1.5, now, 3)
      }
    }

    // fire
    this.fireGain!.gain.setTargetAtTime(s.camping ? 0.05 : 0, now, 0.6)
    if (s.camping) {
      this.crackleTimer -= dt
      if (this.crackleTimer <= 0) {
        this.crackleTimer = 0.03 + Math.random() ** 2 * 0.35
        this.burst(1800 + Math.random() * 3200, 0.004, 0.015 + Math.random() * 0.05, 0.02 + Math.random() * 0.1, 1.4)
      }
    }

    // birds by day, crickets at night
    this.birdTimer -= dt
    if (this.birdTimer <= 0) {
      this.birdTimer = 3 + Math.random() * 9
      if (s.night < 0.5) this.bird(1 - s.night * 2)
    }
    this.cricketTimer -= dt
    if (this.cricketTimer <= 0) {
      this.cricketTimer = 0.5 + Math.random() * 1.1
      if (s.night > 0.3) this.cricket((s.night - 0.3) / 0.7)
    }

    // footfalls: each half walking cycle; hooves: 4 beats a stride, 3 at a gallop
    if (!s.riding && s.speed > 0.2 && !s.camping) {
      if (Math.floor(s.bobPhase / Math.PI) !== Math.floor(this.lastBob / Math.PI)) this.step(Math.min(1, s.speed / 4))
    }
    if (s.riding && s.speed > 0.3) {
      const beats = s.gallop > 0.5 ? [0, 0.14, 0.28] : [0, 0.25, 0.5, 0.75]
      const a = this.lastRide / (Math.PI * 2)
      const b = s.ridePhase / (Math.PI * 2)
      for (const off of beats) if (Math.floor(a - off) !== Math.floor(b - off)) this.hoof(0.7 + s.gallop * 0.5)
    }
    this.lastBob = s.bobPhase
    this.lastRide = s.ridePhase
  }

  /** A short filtered noise hit. */
  private burst(freq: number, attack: number, decay: number, gain: number, q = 1, type: BiquadFilterType = "bandpass") {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.white
    src.playbackRate.value = 0.8 + Math.random() * 0.4
    const f = ctx.createBiquadFilter()
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    src.connect(f).connect(g).connect(this.master!)
    src.start(t, Math.random() * 0.1)
    src.stop(t + attack + decay + 0.05)
  }

  private tone(f0: number, f1: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
    const ctx = this.ctx!
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, at)
    o.frequency.exponentialRampToValueAtTime(f1, at + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, at)
    g.gain.linearRampToValueAtTime(gain, at + Math.min(0.012, dur * 0.3))
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    o.connect(g).connect(this.master!)
    o.start(at)
    o.stop(at + dur + 0.02)
  }

  private bird(amount: number) {
    const t = this.ctx!.currentTime
    const base = 2400 + Math.random() * 1600
    const notes = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < notes; i++) {
      const at = t + i * (0.09 + Math.random() * 0.06)
      const up = Math.random() > 0.4
      this.tone(base * (up ? 0.85 : 1.15), base * (up ? 1.2 : 0.8), at, 0.07 + Math.random() * 0.05, 0.012 * amount)
    }
  }

  private cricket(amount: number) {
    const t = this.ctx!.currentTime
    const f = 4200 + Math.random() * 600
    for (let i = 0; i < 3; i++) this.tone(f, f * 0.98, t + i * 0.045, 0.028, 0.006 * amount, "triangle")
  }

  private step(amount: number) {
    this.burst(320 + Math.random() * 160, 0.003, 0.07, 0.05 * amount, 0.8, "lowpass")
    this.burst(1600 + Math.random() * 800, 0.002, 0.03, 0.008 * amount, 1.2)
  }

  private hoof(amount: number) {
    const t = this.ctx!.currentTime
    this.tone(150 + Math.random() * 30, 70, t, 0.08, 0.06 * amount)
    this.burst(1100 + Math.random() * 500, 0.002, 0.04, 0.03 * amount, 1.5)
  }

  dispose() {
    void this.ctx?.close()
    this.ctx = null
  }
}

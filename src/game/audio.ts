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

  constructor() {
    try {
      this.enabled = localStorage.getItem(STORAGE_KEY) !== "off"
    } catch {
      /* storage can be unavailable */
    }
  }

  get on() {
    return this.enabled
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

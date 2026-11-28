/* Chum's Revenge: 8-bit music and sound effects, made live with the Web Audio API (no audio files).
   Original tunes. Main theme: a quiet verse (clean picked arpeggio, mumbly lead, half-time drums) that
   breaks into a loud chorus (distorted power chords, high lead, driving drums), then back. Boss theme: fast, minor.
   Pulse + triangle + saw + noise, like an old console. */

type Cell = number | "-" | null;

/** How one section sounds. */
interface Part {
  /** 16 sixteenths: k = kick, s = snare, h = hat, . = nothing. */
  drums: string;
  snareVol: number;
  /** Extra soft hats on every eighth. */
  hat8: boolean;
  /** Clean arpeggio volume (0 = off). */
  arpVol: number;
  /** half: long root notes; drive: eighth-note octaves. */
  bass: "half" | "drive";
  /** Distorted power-chord chugs. */
  power: boolean;
  leadVol: number;
  leadDuty: 0.125 | 0.25 | 0.5;
}

interface Bar {
  /** Chord tones (MIDI), lowest first. */
  chord: number[];
  /** Lead: 8 eighth notes. A number starts a note, "-" holds it, null is a rest. */
  lead: Cell[];
  part: string;
}

interface Track {
  bpm: number;
  parts: Record<string, Part>;
  bars: Bar[];
}

const D = [62, 66, 69];
const Fsm = [66, 69, 73];
const G = [67, 71, 74];
const Gm = [67, 70, 74];
const Bm = [71, 74, 78];
const A = [69, 73, 76];
const v = (chord: number[], lead: Cell[]): Bar => ({ chord, lead, part: "verse" });
const c = (chord: number[], lead: Cell[]): Bar => ({ chord, lead, part: "chorus" });

const TRACKS: Record<"main" | "boss", Track> = {
  main: {
    bpm: 75,
    parts: {
      verse: { drums: "k.......s...k...", snareVol: 0.1, hat8: true, arpVol: 0.065, bass: "half", power: false, leadVol: 0.06, leadDuty: 0.5 },
      chorus: { drums: "k.h.s.h.k.k.s.h.", snareVol: 0.22, hat8: false, arpVol: 0.025, bass: "drive", power: true, leadVol: 0.1, leadDuty: 0.25 },
    },
    bars: [
      v(D, [null, null, 69, "-", 66, "-", 64, 62]),
      v(Fsm, [64, "-", "-", null, null, 66, 69, "-"]),
      v(G, [71, "-", 69, "-", 67, "-", null, null]),
      v(Gm, [70, "-", "-", "-", 69, "-", 67, "-"]),
      v(D, [null, 74, "-", 73, 71, "-", 69, "-"]),
      v(Fsm, [69, "-", 66, "-", "-", null, 64, 66]),
      v(G, [67, "-", 71, "-", 74, "-", 71, 69]),
      v(Gm, [70, "-", "-", "-", "-", "-", null, null]),
      c(Bm, [78, "-", "-", 76, 74, "-", 76, 78]),
      c(G, [79, "-", "-", "-", 78, "-", 76, "-"]),
      c(D, [74, "-", 76, 78, "-", 76, 74, "-"]),
      c(A, [73, "-", "-", "-", 76, "-", "-", "-"]),
      c(Bm, [78, "-", 81, "-", 78, "-", 76, 74]),
      c(G, [79, "-", "-", "-", 81, "-", 79, "-"]),
      c(D, [78, "-", 76, "-", 74, "-", 73, 74]),
      c(A, [76, "-", "-", "-", "-", "-", null, null]),
    ],
  },
  boss: {
    bpm: 140,
    parts: {
      boss: { drums: "khhhskhhkhkhskhh", snareVol: 0.2, hat8: false, arpVol: 0.04, bass: "drive", power: true, leadVol: 0.09, leadDuty: 0.25 },
    },
    bars: [
      { chord: [64, 67, 71], part: "boss", lead: [76, 76, 79, 76, 83, "-", 81, 79] },
      { chord: [60, 64, 67], part: "boss", lead: [79, "-", 76, "-", 72, 74, 76, "-"] },
      { chord: [62, 66, 69], part: "boss", lead: [78, 78, 81, 78, 86, "-", 84, 81] },
      { chord: [59, 63, 66], part: "boss", lead: [83, "-", 78, "-", 75, "-", 71, "-"] },
    ],
  },
};

export type Sfx = "shoot" | "hit" | "kill" | "hurt" | "coin" | "door" | "reload" | "buy" | "blast" | "win" | "lose";

const AUDIO_PREF = "bn-chums-audio";
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export function loadAudioPref(): { volume: number; muted: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(AUDIO_PREF) ?? "{}");
    return { volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.6, muted: !!p.muted };
  } catch {
    return { volume: 0.6, muted: false };
  }
}
function saveAudioPref(p: { volume: number; muted: boolean }) {
  try {
    localStorage.setItem(AUDIO_PREF, JSON.stringify(p));
  } catch {
    /* private mode: fine */
  }
}

export class Chiptune {
  private ctx: AudioContext;
  private master: GainNode;
  private musicBus: GainNode;
  private echo: DelayNode;
  private dirt: GainNode;
  private pulse: Record<string, PeriodicWave> = {};
  private noise: AudioBuffer;
  private track: Track | null = null;
  private pending: Track | null = null;
  private stepIdx = 0;
  private nextAt = 0;
  private timer = 0;
  private lastShoot = 0;
  volume: number;
  muted: boolean;

  constructor() {
    const pref = loadAudioPref();
    this.volume = pref.volume;
    this.muted = pref.muted;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1;
    this.musicBus.connect(this.master);
    // A little echo on the lead, for the lazy feel.
    this.echo = this.ctx.createDelay(1);
    this.echo.delayTime.value = 0.34;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.35;
    this.echo.connect(fb).connect(this.echo);
    this.echo.connect(wet).connect(this.musicBus);
    for (const d of [0.125, 0.25, 0.5]) this.pulse[d] = this.makePulse(d);
    // "Distorted guitar" for the power chords: a saw through a hard clipper and a lowpass.
    this.dirt = this.ctx.createGain();
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 6);
    }
    shaper.curve = curve;
    const tone = this.ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2400;
    const out = this.ctx.createGain();
    out.gain.value = 0.11;
    this.dirt.connect(shaper).connect(tone).connect(out).connect(this.musicBus);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolume();
  }

  private makePulse(duty: number) {
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 1; i < n; i++) real[i] = (2 / (i * Math.PI)) * Math.sin(i * Math.PI * duty);
    return this.ctx.createPeriodicWave(real, imag);
  }

  private applyVolume() {
    const v = this.muted ? 0 : this.volume * 0.5;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
    saveAudioPref({ volume: this.volume, muted: this.muted });
  }
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }
  toggleMute() {
    this.muted = !this.muted;
    this.applyVolume();
    return this.muted;
  }

  /** Browsers only allow sound after a click or key press: call this from one. */
  resume() {
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }
  pause() {
    if (this.ctx.state === "running") void this.ctx.suspend();
  }

  /** Start or switch the music. A switch waits for the end of the bar, so it stays in time. */
  play(name: "main" | "boss") {
    const t = TRACKS[name];
    if (this.track === t || this.pending === t) return;
    this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
    this.musicBus.gain.setValueAtTime(1, this.ctx.currentTime);
    if (!this.track) {
      this.track = t;
      this.stepIdx = 0;
      this.nextAt = this.ctx.currentTime + 0.08;
      if (!this.timer) this.timer = window.setInterval(() => this.schedule(), 25);
    } else this.pending = t;
  }

  /** Fade the music out (death, win). */
  stopMusic(fade = 0.8) {
    const now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, now);
    this.musicBus.gain.linearRampToValueAtTime(0, now + fade);
    window.setTimeout(() => {
      this.track = null;
      this.pending = null;
    }, fade * 1000);
  }

  dispose() {
    window.clearInterval(this.timer);
    this.timer = 0;
    void this.ctx.close();
  }

  /* ---------- the sequencer ---------- */

  private schedule() {
    if (!this.track || this.ctx.state !== "running") return;
    const ahead = this.ctx.currentTime + 0.12;
    while (this.nextAt < ahead && this.track) {
      this.playStep(this.track, this.stepIdx, this.nextAt);
      this.nextAt += 60 / this.track.bpm / 4;
      this.stepIdx++;
      if (this.stepIdx % 16 === 0 && this.pending) {
        this.track = this.pending;
        this.pending = null;
        this.stepIdx = 0;
      }
    }
  }

  private playStep(t: Track, i: number, at: number) {
    const s16 = 60 / t.bpm / 4;
    const barNo = Math.floor(i / 16) % t.bars.length;
    const bar = t.bars[barNo];
    const prev = t.bars[(barNo + t.bars.length - 1) % t.bars.length];
    const part = t.parts[bar.part];
    const pos = i % 16;
    const chord = bar.chord;
    const root = chord[0];

    // drums (a crash when a new section starts)
    const d = part.drums[pos];
    if (d === "k") this.kick(at);
    else if (d === "s") this.snare(at, part.snareVol);
    else if (d === "h") this.hat(at);
    if (part.hat8 && pos % 2 === 0 && d !== "h") this.hat(at, 0.022);
    if (pos === 0 && prev.part !== bar.part) this.noiseHit(at, 1.2, 0.12, "highpass", 5000);

    // clean arpeggio, like a picked guitar: root, fifth, octave, third, ...
    if (part.arpVol > 0) {
      const pick = [root, chord[2], root + 12, chord[1] + 12, chord[2], root + 12, chord[1] + 12, chord[2] + 12];
      this.tone(this.pulse[0.125], hz(pick[pos % 8] - 12), at, s16 * 2.2, part.arpVol, part.power ? false : true);
    }

    // distorted power chords: eighth-note chugs, the first of each bar rings out
    if (part.power && pos % 2 === 0) {
      const len = pos === 0 ? s16 * 3.5 : s16 * 1.1;
      for (const n of [root - 12, root - 5, root]) this.tone("sawtooth", hz(n), at, len, 0.5, false, this.dirt);
    }

    // bass (triangle)
    const b = root - 24;
    if (part.bass === "half") {
      if (pos === 0 || pos === 8) this.tone("triangle", hz(pos === 0 ? b : b + 7), at, s16 * 7, 0.2);
    } else if (pos % 2 === 0) this.tone("triangle", hz(pos % 4 === 0 ? b : b + 12), at, s16 * 1.8, 0.24);

    // lead: eighth notes, held through "-"
    if (pos % 2 === 0) {
      const k = pos / 2;
      const note = bar.lead[k];
      if (typeof note === "number") {
        let len = 1;
        while (k + len < bar.lead.length && bar.lead[k + len] === "-") len++;
        this.tone(this.pulse[part.leadDuty], hz(note), at, s16 * 2 * len * 0.92, part.leadVol, true);
      }
    }
  }

  /* ---------- instruments ---------- */

  private tone(wave: PeriodicWave | OscillatorType, freq: number, at: number, len: number, vol: number, echo = false, bus: AudioNode = this.musicBus, slideTo?: number) {
    const o = this.ctx.createOscillator();
    if (typeof wave === "string") o.type = wave as OscillatorType;
    else o.setPeriodicWave(wave);
    o.frequency.setValueAtTime(freq, at);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, at + len);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.005);
    g.gain.setValueAtTime(vol, at + Math.max(0.01, len - 0.03));
    g.gain.linearRampToValueAtTime(0, at + len);
    o.connect(g).connect(bus);
    if (echo) g.connect(this.echo);
    o.start(at);
    o.stop(at + len + 0.02);
  }

  private noiseHit(at: number, len: number, vol: number, filter: BiquadFilterType, freq: number, bus: AudioNode = this.musicBus) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + len);
    src.connect(f).connect(g).connect(bus);
    src.start(at, Math.random() * 0.5);
    src.stop(at + len + 0.02);
  }

  private kick(at: number) {
    this.tone("sine", 150, at, 0.14, 0.5, false, this.musicBus, 45);
  }
  private snare(at: number, vol: number) {
    this.noiseHit(at, 0.12, vol, "bandpass", 1800);
  }
  private hat(at: number, vol = 0.04) {
    this.noiseHit(at, 0.04, vol, "highpass", 7000);
  }

  /* ---------- sound effects ---------- */

  sfx(name: Sfx) {
    if (this.ctx.state !== "running") return;
    const at = this.ctx.currentTime + 0.005;
    const fx = this.master;
    switch (name) {
      case "shoot":
        if (at - this.lastShoot < 0.05) return;
        this.lastShoot = at;
        this.tone(this.pulse[0.25], 880, at, 0.07, 0.06, false, fx, 220);
        break;
      case "hit":
        this.noiseHit(at, 0.06, 0.12, "bandpass", 2500, fx);
        break;
      case "kill":
        this.tone(this.pulse[0.5], 300, at, 0.18, 0.1, false, fx, 60);
        this.noiseHit(at, 0.2, 0.15, "lowpass", 1200, fx);
        break;
      case "hurt":
        this.tone("square", 220, at, 0.25, 0.12, false, fx, 70);
        this.noiseHit(at, 0.25, 0.18, "lowpass", 900, fx);
        break;
      case "coin":
        this.tone(this.pulse[0.5], hz(88), at, 0.06, 0.07, false, fx);
        this.tone(this.pulse[0.5], hz(93), at + 0.06, 0.12, 0.07, false, fx);
        break;
      case "door":
        [60, 64, 67, 72].forEach((m, i) => this.tone(this.pulse[0.25], hz(m), at + i * 0.06, 0.1, 0.07, false, fx));
        break;
      case "reload":
        this.tone("square", 180, at, 0.05, 0.05, false, fx);
        this.tone("square", 260, at + 0.08, 0.05, 0.05, false, fx);
        break;
      case "buy":
        [72, 76, 79].forEach((m, i) => this.tone(this.pulse[0.5], hz(m), at + i * 0.07, 0.12, 0.07, false, fx));
        break;
      case "blast":
        this.noiseHit(at, 0.3, 0.2, "lowpass", 600, fx);
        break;
      case "win":
        [72, 76, 79, 84, 79, 84].forEach((m, i) => this.tone(this.pulse[0.25], hz(m), at + i * 0.13, i === 5 ? 0.8 : 0.12, 0.09, false, fx));
        break;
      case "lose":
        [67, 63, 60, 55].forEach((m, i) => this.tone(this.pulse[0.5], hz(m), at + i * 0.22, i === 3 ? 0.8 : 0.2, 0.09, false, fx));
        break;
    }
  }
}

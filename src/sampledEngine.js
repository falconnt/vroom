// sampledEngine.js
// Sample-gebaseerde motor met ECHT opgenomen geluiden (uit open-source games).
// Twee speelwijzen in één engine:
//   1) Losse loop  — één sample, gepitcht over een aangenaam window (idle->redline).
//   2) Gelaagd     — meerdere samples op vaste toerentallen; de twee dichtstbij-
//                    zijnde worden equal-power gecrossfade en licht gepitcht
//                    (granular/crossfade, zoals racegames). Klinkt het natuurlijkst.
// Plus echte accenten: schakel-"clunk" (gear) en overrun-backfire.

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// De sample-profielen (kind:'sample'). URL's zijn relatief -> werkt op GitHub Pages.
export const SAMPLE_PROFILES = [
  {
    id: 'real-fordgt', kind: 'sample', label: 'Ford GT V8 (echt)',
    idleRpm: 800, redline: 7000, linear: false, pitchLo: 0.72, pitchHi: 2.05,
    layers: [{ url: './assets/sounds/engines/fordgt.wav', rpm: 3500 }],
  },
  {
    id: 'real-f40', kind: 'sample', label: 'Ferrari F40 V8 (echt)',
    idleRpm: 900, redline: 7600, linear: false, pitchLo: 0.7, pitchHi: 2.1,
    layers: [{ url: './assets/sounds/engines/f40.wav', rpm: 3800 }],
  },
  {
    id: 'real-porsche', kind: 'sample', label: 'Porsche Flat-6 (echt)',
    idleRpm: 850, redline: 7200, linear: false, pitchLo: 0.72, pitchHi: 2.0,
    layers: [{ url: './assets/sounds/engines/porsche.wav', rpm: 3500 }],
  },
  {
    id: 'real-subaru', kind: 'sample', label: 'Subaru Boxer (echt)',
    idleRpm: 800, redline: 6800, linear: false, pitchLo: 0.7, pitchHi: 1.95,
    layers: [{ url: './assets/sounds/engines/subaru.wav', rpm: 3200 }],
  },
  {
    id: 'real-rally', kind: 'sample', label: 'Rally-motor (echt)',
    idleRpm: 800, redline: 6800, linear: false, pitchLo: 0.7, pitchHi: 2.0,
    layers: [{ url: './assets/sounds/tr_engine.wav', rpm: 3200 }],
  },
  {
    id: 'real-diesel', kind: 'sample', label: 'Diesel Truck (echt, gelaagd)',
    idleRpm: 600, redline: 4800, linear: false,
    layers: [
      { url: './assets/sounds/diesel/idle.wav', rpm: 600 },
      { url: './assets/sounds/diesel/low.wav', rpm: 1500 },
      { url: './assets/sounds/diesel/medium.wav', rpm: 2600 },
      { url: './assets/sounds/diesel/high.wav', rpm: 3600 },
      { url: './assets/sounds/diesel/force.wav', rpm: 4400 },
    ],
  },
  {
    id: 'real-bank', kind: 'sample', label: 'Smooth Engine (echt, RPM-bank)',
    idleRpm: 1000, redline: 8600, linear: false,
    layers: [
      { url: './assets/sounds/rpmbank/a1000.ogg', rpm: 1000 },
      { url: './assets/sounds/rpmbank/a3000.ogg', rpm: 3000 },
      { url: './assets/sounds/rpmbank/a5000.ogg', rpm: 5000 },
      { url: './assets/sounds/rpmbank/a7000.ogg', rpm: 7000 },
      { url: './assets/sounds/rpmbank/a9000.ogg', rpm: 9000 },
    ],
  },
];

const GEAR_URL = './assets/sounds/tr_gear.wav';
const BACKFIRE_URL = './assets/sounds/fx/backfire.wav';

export class SampledEngine {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.profile = null;
    this.layers = [];        // [{buf, rpm, src, gain}]
    this.started = false;
    this.gearBuffer = null;
    this.backfireBuffer = null;
    this._nextPop = 0;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.9;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 4000;
    this.lowpass.Q.value = 0.3;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.lowpass.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Accent-bus (crisp, buiten lowpass om)
    this.fxGain = ctx.createGain();
    this.fxGain.gain.value = 0.9;
    this.fxGain.connect(this.masterGain);
  }

  async _decode(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch ' + url + ' ' + res.status);
    return await this.ctx.decodeAudioData(await res.arrayBuffer());
  }

  /** Laad alle samples voor een profiel + (eenmalig) de accenten. */
  async load(profile) {
    this.profile = profile;
    const bufs = await Promise.all(profile.layers.map((l) => this._decode(l.url)));
    this.layers = profile.layers.map((l, i) => ({ rpm: l.rpm, buf: bufs[i], src: null, gain: null }));
    if (!this.gearBuffer) this.gearBuffer = await this._decode(GEAR_URL).catch(() => null);
    if (!this.backfireBuffer) this.backfireBuffer = await this._decode(BACKFIRE_URL).catch(() => null);
  }

  setVolume(v) {
    this.masterGain.gain.setTargetAtTime(clamp(v, 0, 1) * 1.1, this.ctx.currentTime, 0.05);
  }

  start() {
    if (this.started || !this.layers.length) return;
    const ctx = this.ctx;
    for (const L of this.layers) {
      const src = ctx.createBufferSource();
      src.buffer = L.buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.lowpass);
      src.start();
      L.src = src; L.gain = g;
    }
    this.started = true;
    this.engineGain.gain.setTargetAtTime(0.9, ctx.currentTime, 0.2);
  }

  stop() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.0, t, 0.12);
    for (const L of this.layers) {
      try { L.src.stop(t + 0.3); } catch (e) { /* al gestopt */ }
      L.src = null; L.gain = null;
    }
    this.started = false;
  }

  /**
   * @param {number} rpm
   * @param {number} load  -1..1
   * @param {{limiter?:boolean}} [opts]
   */
  update(rpm, load, opts = {}) {
    if (!this.started) return;
    const p = this.profile;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const frac = clamp((rpm - p.idleRpm) / (p.redline - p.idleRpm), 0, 1);
    const single = this.layers.length === 1;

    // Begrenzer-flutter
    let limMul = 1;
    if (opts.limiter) {
      this._fl = (this._fl || 0) + 1;
      limMul = this._fl % 6 < 3 ? 0.9 : 1;
    }

    if (single) {
      const L = this.layers[0];
      const lo = p.pitchLo ?? 0.72, hi = p.pitchHi ?? 2.05;
      L.gain.gain.setTargetAtTime(1, t, 0.03);
      L.src.playbackRate.setTargetAtTime((lo + (hi - lo) * frac) * limMul, t, 0.03);
    } else {
      // Gelaagd: vind de twee buur-lagen op toerental en crossfade equal-power.
      const rc = clamp(rpm, this.layers[0].rpm, this.layers[this.layers.length - 1].rpm);
      let hiIdx = 1;
      while (hiIdx < this.layers.length - 1 && this.layers[hiIdx].rpm < rc) hiIdx++;
      const loIdx = hiIdx - 1;
      const a = this.layers[loIdx], b = this.layers[hiIdx];
      const w = clamp((rc - a.rpm) / (b.rpm - a.rpm), 0, 1);
      const gA = Math.cos(w * Math.PI / 2), gB = Math.sin(w * Math.PI / 2);
      for (let i = 0; i < this.layers.length; i++) {
        const L = this.layers[i];
        const g = i === loIdx ? gA : i === hiIdx ? gB : 0;
        L.gain.gain.setTargetAtTime(g, t, 0.04);
        // Licht pitchen richting doel-rpm (klein bereik -> natuurlijk).
        const rate = clamp(rpm / L.rpm, 0.82, 1.22) * limMul;
        if (g > 0.001) L.src.playbackRate.setTargetAtTime(rate, t, 0.04);
      }
    }

    // Load opent de lowpass.
    const l = clamp(load, -1, 1);
    const drive = clamp(0.5 + l * 0.5, 0, 1);
    this.lowpass.frequency.setTargetAtTime(1000 + (frac * 0.5 + frac * drive * 0.5) * 12000, t, 0.05);

    // Overrun-backfire bij gas loslaten op hoger toerental.
    if (!opts.limiter && this.backfireBuffer && l < -0.18 && frac > 0.4 && t >= this._nextPop) {
      this._fire(this.backfireBuffer, Math.min(1, -l * (0.4 + frac)) * 0.6);
      this._nextPop = t + 0.06 + Math.random() * 0.18;
    }
  }

  _fire(buf, gain) {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = 0.9 + Math.random() * 0.3;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(g).connect(this.fxGain);
    s.start();
    s.stop(t + Math.min(0.4, buf.duration) + 0.05);
  }

  /** Echte schakel-"clunk". */
  gearShift() {
    if (this.gearBuffer) this._fire(this.gearBuffer, 0.8);
  }
}

// audioEngine.js
// Procedurele motorgeluid-synthese op de Web Audio API.
//
// Waarom procedureel en niet sample-gebaseerd?
//  - De omgeving/host laat geen externe geluids-CDN's toe, en procedurele
//    synthese heeft sowieso geen assets nodig: alles wordt in de browser
//    berekend. Dat is 100% rechtenvrij, werkt offline en is licht genoeg
//    voor de trage Tesla Atom-MCU (geen AudioWorklet/WASM nodig).
//
// Aanpak (bewust licht):
//  - Een 4-takt motor "vuurt" per cilinder één keer per 2 omwentelingen.
//    De hoorbare grondtoon = firingFreq = (rpm/60) * (cilinders/2).
//  - Twee OscillatorNodes met een op maat gemaakte PeriodicWave (harmonische
//    reeks per motorprofiel) geven het "orgel"-karakter van de motor.
//  - Een looping ruis-buffer door een bandpass geeft textuur/rauwheid.
//  - Een lowpass-filter waarvan de cutoff meebeweegt met RPM en "load"
//    (gaspedaal) maakt het verschil tussen loom stationair en agressief gas.
//  - Bij stationair een kleine random "wiebel" op toon en volume zodat het
//    levend klinkt in plaats van een statische zoemtoon.

/**
 * @typedef {Object} EngineProfile
 * @property {string} id
 * @property {string} label
 * @property {number} cylinders      aantal cilinders (firing-frequentie)
 * @property {number[]} harmonics    relatieve amplitudes van harmonische 1..n
 * @property {number} idleRpm
 * @property {number} redline
 * @property {number} baseCutoff     lowpass-cutoff bij stationair (Hz)
 * @property {number} maxCutoff      lowpass-cutoff bij redline + vol gas (Hz)
 * @property {number} noiseLevel     hoeveelheid ruistextuur (0..1)
 * @property {number} rumble         extra octaaf-onder body (0..1)
 * @property {boolean} linear        true = lineair geluid (geen versnellingsbak)
 */

/** @type {EngineProfile[]} */
export const PROFILES = [
  {
    id: 'v8',
    label: 'V8 Rumble (manueel)',
    cylinders: 8,
    harmonics: [1.0, 0.8, 0.55, 0.6, 0.3, 0.28, 0.18, 0.12],
    idleRpm: 750,
    redline: 6500,
    baseCutoff: 380,
    maxCutoff: 5200,
    noiseLevel: 0.22,
    rumble: 0.55,
    linear: false,
  },
  {
    id: 'i4turbo',
    label: 'Inline-4 Turbo (manueel)',
    cylinders: 4,
    harmonics: [0.7, 1.0, 0.5, 0.35, 0.45, 0.2, 0.15, 0.1],
    idleRpm: 850,
    redline: 7200,
    baseCutoff: 500,
    maxCutoff: 6500,
    noiseLevel: 0.32,
    rumble: 0.28,
    linear: false,
  },
  {
    id: 'scifi',
    label: 'Sci-Fi Whine (lineair)',
    cylinders: 2,
    harmonics: [1.0, 0.15, 0.6, 0.1, 0.4, 0.08, 0.25],
    idleRpm: 600,
    redline: 9000,
    baseCutoff: 700,
    maxCutoff: 9000,
    noiseLevel: 0.08,
    rumble: 0.15,
    linear: true,
  },
];

/** Vind een profiel op id, met veilige fallback. */
export function getProfile(id) {
  return PROFILES.find((p) => p.id === id) || PROFILES[0];
}

// --- helpers ----------------------------------------------------------------

function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

// Maak een PeriodicWave uit een harmonische amplitude-reeks.
function waveFromHarmonics(ctx, harmonics) {
  const n = harmonics.length + 1;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let i = 0; i < harmonics.length; i++) {
    // imag component => sinus-harmonischen
    imag[i + 1] = harmonics[i];
  }
  return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
}

// Gevuld met witte ruis, looping — één keer aanmaken.
function makeNoiseBuffer(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * De motor-synthesizer. Eén instantie per lopende sessie.
 * Roep update(rpm, load) ~60x/sec aan vanuit de render-loop.
 */
export class EngineSound {
  /** @param {AudioContext} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.profile = PROFILES[0];
    this.started = false;

    // Master keten: engineGain -> lowpass -> masterGain -> destination
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.9;

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 500;
    this.lowpass.Q.value = 0.9;

    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineGain.connect(this.lowpass);
    this.lowpass.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    // Tonale lagen
    this.oscMain = ctx.createOscillator();
    this.oscBody = ctx.createOscillator(); // octaaf-onder rumble
    this.mainGain = ctx.createGain();
    this.bodyGain = ctx.createGain();
    this.oscMain.connect(this.mainGain).connect(this.engineGain);
    this.oscBody.connect(this.bodyGain).connect(this.engineGain);

    // Ruis-textuur laag
    this.noise = ctx.createBufferSource();
    this.noise.buffer = makeNoiseBuffer(ctx);
    this.noise.loop = true;
    this.noiseBand = ctx.createBiquadFilter();
    this.noiseBand.type = 'bandpass';
    this.noiseBand.frequency.value = 900;
    this.noiseBand.Q.value = 0.7;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.0;
    this.noise.connect(this.noiseBand).connect(this.noiseGain).connect(this.engineGain);

    this.applyProfile(PROFILES[0]);
  }

  applyProfile(profile) {
    this.profile = profile;
    const wave = waveFromHarmonics(this.ctx, profile.harmonics);
    this.oscMain.setPeriodicWave(wave);
    this.oscBody.setPeriodicWave(wave);
    this.bodyGain.gain.value = 0.35 * profile.rumble;
    this.mainGain.gain.value = 0.5;
  }

  setVolume(v) {
    // v: 0..1 vanuit de slider
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(clamp(v, 0, 1) * 1.1, t, 0.05);
  }

  start() {
    if (this.started) return;
    this.oscMain.start();
    this.oscBody.start();
    this.noise.start();
    this.started = true;
    // Zacht infaden
    this.engineGain.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.15);
  }

  stop() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0.0, t, 0.1);
  }

  /**
   * Werk de motorklank bij op basis van huidig toerental en belasting.
   * @param {number} rpm    huidig toerental
   * @param {number} load   -1..1 (accel = positief/agressief, decel = negatief)
   */
  update(rpm, load) {
    const p = this.profile;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Firing-frequentie van een 4-takt: (rpm/60) * (cilinders/2)
    let firing = (rpm / 60) * (p.cylinders / 2);

    // Kleine idle-wiebel zodat stationair "leeft"
    const nearIdle = clamp(1 - (rpm - p.idleRpm) / 400, 0, 1);
    const jitter = nearIdle * (Math.random() * 2 - 1) * 2.5;
    firing = Math.max(12, firing + jitter);

    // Zet de oscillatoren; body een octaaf lager voor rumble
    this.oscMain.frequency.setTargetAtTime(firing, t, 0.02);
    this.oscBody.frequency.setTargetAtTime(firing * 0.5, t, 0.02);

    // Load bepaalt agressie: filter open, meer ruis, meer body
    const l = clamp(load, -1, 1);
    const drive = clamp(0.5 + l * 0.5, 0, 1); // 0 = rollen uit, 1 = vol gas
    const rpmFrac = clamp((rpm - p.idleRpm) / (p.redline - p.idleRpm), 0, 1);

    // Cutoff schaalt met rpm en gas
    const cutoff = p.baseCutoff + (p.maxCutoff - p.baseCutoff) * (0.4 * rpmFrac + 0.6 * rpmFrac * drive);
    this.lowpass.frequency.setTargetAtTime(cutoff, t, 0.04);

    // Ruis volgt rpm + load
    const noiseTarget = p.noiseLevel * (0.35 + 0.65 * rpmFrac) * (0.5 + 0.5 * drive);
    this.noiseGain.gain.setTargetAtTime(noiseTarget, t, 0.05);
    this.noiseBand.frequency.setTargetAtTime(700 + 2600 * rpmFrac, t, 0.06);

    // Bij hoog toerental iets meer main, minder body (schriller)
    this.mainGain.gain.setTargetAtTime(0.42 + 0.2 * rpmFrac, t, 0.05);
    this.bodyGain.gain.setTargetAtTime((0.4 - 0.2 * rpmFrac) * p.rumble, t, 0.05);
  }

  /** Korte volume-dip om een schakelmoment te suggereren. */
  shiftCut(ms = 110) {
    const t = this.ctx.currentTime;
    const g = this.engineGain.gain;
    const current = g.value;
    g.cancelScheduledValues(t);
    g.setValueAtTime(current, t);
    g.linearRampToValueAtTime(current * 0.25, t + 0.02);
    g.linearRampToValueAtTime(current, t + ms / 1000);
  }
}

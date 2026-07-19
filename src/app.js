// app.js — orchestratie: snelheid -> rpm-model -> (synth|sample) engine -> UI.
import { EngineSound, PROFILES } from './audioEngine.js';
import { SampledEngine, SAMPLE_PROFILES } from './sampledEngine.js';
import { RpmModel } from './rpmModel.js';
import { SpeedSource } from './speed.js';

const $ = (id) => document.getElementById(id);

// Alle geluiden: procedureel (synth) + echt opgenomen (sample).
const ALL_PROFILES = [...PROFILES, ...SAMPLE_PROFILES];
const getProfile = (id) => ALL_PROFILES.find((p) => p.id === id) || PROFILES[0];

const state = {
  running: false,
  ctx: null,
  engine: null,
  model: null,
  speed: new SpeedSource(),
  profileId: 'real-fordgt',
  maxSpeed: 120,
  volume: 0.85,
  lastFrame: 0,
  lastSpeed: 0,
  wakeLock: null,
  loading: false,
};

// --- Profielkeuze (gegroepeerd) ---------------------------------------------
function populateProfiles() {
  const sel = $('soundSelect');
  sel.innerHTML = '';
  const groups = [
    ['Echt opgenomen', SAMPLE_PROFILES],
    ['Procedureel (synth)', PROFILES],
  ];
  for (const [name, list] of groups) {
    const og = document.createElement('optgroup');
    og.label = name;
    for (const p of list) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  sel.value = state.profileId;
}

// --- Wake Lock ---------------------------------------------------------------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {});
    }
  } catch (e) { /* niet fataal */ }
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (state.running && document.visibilityState === 'visible') requestWakeLock();
});

// --- Engine bouwen (synth of sample) ----------------------------------------
function setLoading(on, label) {
  state.loading = on;
  $('modeLabel').textContent = on ? (label || 'Geluid laden…') : modeText(getProfile(state.profileId));
}
function modeText(p) {
  if (p.kind === 'sample') return p.layers.length > 1 ? 'Echt opgenomen · gelaagd' : 'Echt opgenomen';
  return p.linear ? 'Lineair' : 'Manueel (versnellingsbak)';
}

async function buildEngine(profile) {
  if (state.engine) state.engine.stop();
  if (profile.kind === 'sample') {
    const e = new SampledEngine(state.ctx);
    setLoading(true);
    try {
      await e.load(profile);
    } finally {
      setLoading(false);
    }
    e.setVolume(state.volume);
    e.start();
    state.engine = e;
  } else {
    const e = new EngineSound(state.ctx);
    e.applyProfile(profile);
    e.setVolume(state.volume);
    e.start();
    state.engine = e;
  }
}

// --- Start / stop ------------------------------------------------------------
async function start() {
  if (state.running || state.loading) return;
  state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.ctx.state === 'suspended') await state.ctx.resume();

  const profile = getProfile(state.profileId);
  const btn = $('startBtn');
  const orig = btn.textContent;
  if (profile.kind === 'sample') { btn.textContent = '⏳ Laden…'; btn.disabled = true; }

  await buildEngine(profile);
  btn.textContent = orig; btn.disabled = false;

  state.model = new RpmModel(profile, state.maxSpeed);
  state.speed.setSource(document.querySelector('input[name=src]:checked').value);

  state.running = true;
  state.lastFrame = performance.now();
  $('overlay').classList.add('hidden');
  $('stopBtn').disabled = false;
  document.body.classList.add('running');
  requestWakeLock();
  requestAnimationFrame(loop);
}

function stop() {
  if (!state.running) return;
  state.running = false;
  if (state.engine) state.engine.stop();
  releaseWakeLock();
  setTimeout(() => { if (state.ctx && state.ctx.state === 'running') state.ctx.suspend(); }, 350);
  $('overlay').classList.remove('hidden');
  document.body.classList.remove('running');
  $('glow').style.setProperty('--o', '0');
  $('glowRed').style.setProperty('--o', '0');
}

// --- Render-loop (60 fps) ----------------------------------------------------
function loop(now) {
  if (!state.running) return;
  const dt = Math.min(100, now - state.lastFrame);
  state.lastFrame = now;

  const speedKmh = state.speed.tick(dt);
  const accel = ((speedKmh - state.lastSpeed) / 3.6) / (dt / 1000 || 0.016);
  state.lastSpeed = speedKmh;

  const out = state.model.update(speedKmh, accel, dt);
  const e = state.engine;
  if (e) {
    if (out.shifted) {
      if (e instanceof SampledEngine) e.gearShift();
      else if (out.shiftDir === 'down') e.shiftBlip();
      else e.shiftCut();
      flashShift();
    }
    e.update(out.rpm, out.load, { limiter: out.limiter });
  }

  updateGauges(speedKmh, out.rpm, out.gear, getProfile(state.profileId), out.limiter);
  requestAnimationFrame(loop);
}

// --- UI-uitlezing ------------------------------------------------------------
const GAUGE = { start: -220, end: 40 };
let shiftFlashUntil = 0;
function flashShift() {
  shiftFlashUntil = performance.now() + 130;
  $('rpmArc').classList.add('shift');
}
function updateGauges(speedKmh, rpm, gear, profile, limiter) {
  $('speedVal').textContent = Math.round(speedKmh);
  $('rpmVal').textContent = Math.round(rpm).toLocaleString('nl-NL');
  $('gearVal').textContent = profile.linear ? '—' : gear;

  const frac = Math.min(1, rpm / profile.redline);
  const deg = GAUGE.start + (GAUGE.end - GAUGE.start) * frac;
  $('needle').style.transform = `rotate(${deg}deg)`;

  const arc = $('rpmArc');
  const circ = 2 * Math.PI * 90;
  const sweep = 0.72;
  arc.style.strokeDasharray = `${frac * sweep * circ} ${circ}`;
  arc.classList.toggle('redline', frac > 0.9);

  const nearRedline = !profile.linear && frac > 0.9;
  $('shiftLight').classList.toggle('on', nearRedline || limiter);
  $('shiftLight').classList.toggle('limit', !!limiter);

  const glow = $('glow');
  glow.style.setProperty('--o', (0.12 + 0.5 * frac).toFixed(3));
  glow.style.setProperty('--s', (0.5 + 0.55 * frac).toFixed(3));
  const redAmt = limiter ? 0.75 : Math.max(0, (frac - 0.82) / 0.18) * 0.6;
  const glowRed = $('glowRed');
  glowRed.style.setProperty('--o', redAmt.toFixed(3));
  glowRed.style.setProperty('--s', (0.55 + 0.5 * frac).toFixed(3));

  if (performance.now() > shiftFlashUntil) arc.classList.remove('shift');
}

// --- Controls ----------------------------------------------------------------
function wireControls() {
  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', stop);

  $('soundSelect').addEventListener('change', async (ev) => {
    state.profileId = ev.target.value;
    const p = getProfile(state.profileId);
    $('modeLabel').textContent = modeText(p);
    if (state.running) {
      await buildEngine(p);
      state.model.setProfile(p, state.maxSpeed);
    }
  });

  $('volume').addEventListener('input', (e) => {
    state.volume = e.target.value / 100;
    $('volVal').textContent = e.target.value + '%';
    if (state.engine) state.engine.setVolume(state.volume);
  });

  $('maxSpeed').addEventListener('input', (e) => {
    state.maxSpeed = parseInt(e.target.value, 10);
    $('maxSpeedVal').textContent = state.maxSpeed + ' km/h';
    if (state.model) state.model.setMaxSpeed(state.maxSpeed);
  });

  $('demoSpeed').addEventListener('input', (e) => {
    state.speed.setDemo(parseInt(e.target.value, 10));
    $('demoVal').textContent = e.target.value + ' km/h';
  });

  document.querySelectorAll('input[name=src]').forEach((r) =>
    r.addEventListener('change', (e) => {
      const src = e.target.value;
      state.speed.setSource(src);
      $('demoRow').classList.toggle('hidden', src !== 'demo');
      $('gpsStatus').classList.toggle('hidden', src !== 'gps');
    })
  );

  state.speed.onStatus = (s) => {
    const el = $('gpsStatus');
    el.textContent = s.msg;
    el.classList.toggle('err', !s.ok);
  };
}

// --- Init --------------------------------------------------------------------
populateProfiles();
wireControls();
$('modeLabel').textContent = modeText(getProfile(state.profileId));

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

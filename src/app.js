// app.js — orchestratie: snelheid -> rpm-model -> (synth|sample) engine -> UI.
import { EngineSound, PROFILES } from './audioEngine.js';
import { SampledEngine, SAMPLE_PROFILES } from './sampledEngine.js';
import { RpmModel } from './rpmModel.js';
import { SpeedSource } from './speed.js';

const $ = (id) => document.getElementById(id);

// Alle geluiden: procedureel (synth) + echt opgenomen (sample).
const ALL_PROFILES = [...PROFILES, ...SAMPLE_PROFILES];
const getProfile = (id) => ALL_PROFILES.find((p) => p.id === id) || PROFILES[0];

// UI-metadata per motor: korte knop-naam + subtiele merkkleur (r,g,b).
const UI_META = {
  'real-fordgt':  { short: 'Ford GT',    color: '58,130,246'  },
  'real-f40':     { short: 'Ferrari',    color: '226,32,28'   },
  'real-porsche': { short: 'Porsche',    color: '212,160,60'  },
  'real-subaru':  { short: 'Subaru',     color: '32,170,214'  },
  'real-rally':   { short: 'Rally',      color: '124,190,60'  },
  'real-diesel':  { short: 'Diesel',     color: '198,122,46'  },
  'real-bank':    { short: 'Smooth',     color: '46,184,166'  },
  'v8':           { short: 'V8',         color: '255,106,43'  },
  'i4turbo':      { short: 'Inline-4',   color: '255,179,0'   },
  'v10':          { short: 'V10',        color: '176,75,216'  },
  'vtwin':        { short: 'V-twin',     color: '225,75,107'  },
  'scifi':        { short: 'Sci-Fi',     color: '34,211,238'  },
};
const metaOf = (id) => UI_META[id] || { short: id, color: '255,120,40' };

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
  cat: 'sample',   // actieve categorie-tab
};

// --- Motorkeuze: knoppen per categorie --------------------------------------
function renderEngines() {
  const grid = $('engineGrid');
  const list = state.cat === 'sample' ? SAMPLE_PROFILES : PROFILES;
  grid.innerHTML = '';
  for (const p of list) {
    const m = metaOf(p.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'engine-btn' + (p.id === state.profileId ? ' active' : '');
    btn.dataset.id = p.id;
    btn.style.setProperty('--c', m.color);
    btn.innerHTML = `<span class="dot"></span><span class="ename">${m.short}</span>`;
    grid.appendChild(btn);
  }
  document.querySelectorAll('#catTabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.cat === state.cat)
  );
}

function setBrand(id) {
  document.documentElement.style.setProperty('--brand-rgb', metaOf(id).color);
}

async function selectEngine(id) {
  if (id === state.profileId) return;
  state.profileId = id;
  const p = getProfile(id);
  setBrand(id);
  $('modeLabel').textContent = modeText(p);
  renderEngines();
  if (state.running) {
    await buildEngine(p);
    state.model.setProfile(p, state.maxSpeed);
  }
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

  $('catTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state.cat = b.dataset.cat; renderEngines(); }
  });
  $('engineGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.engine-btn');
    if (b) selectEngine(b.dataset.id);
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
state.cat = getProfile(state.profileId).kind === 'sample' ? 'sample' : 'synth';
setBrand(state.profileId);
renderEngines();
wireControls();
$('modeLabel').textContent = modeText(getProfile(state.profileId));

if ('serviceWorker' in navigator) {
  // Herlaad automatisch zodra een nieuwe versie de controle overneemt —
  // maar niet bij de allereerste installatie (dan was er nog geen controller).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    // updateViaCache:'none' -> de browser checkt sw.js altijd vers (geen HTTP-cache).
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' })
      .then((reg) => reg.update())
      .catch(() => {});
  });
}

// app.js — orchestratie: koppelt snelheid -> rpm-model -> audio-engine -> UI.
import { EngineSound, PROFILES, getProfile } from './audioEngine.js';
import { RpmModel } from './rpmModel.js';
import { SpeedSource } from './speed.js';

const $ = (id) => document.getElementById(id);

const state = {
  running: false,
  ctx: null,
  engine: null,
  model: null,
  speed: new SpeedSource(),
  profileId: 'v8',
  maxSpeed: 120,      // km/h kalibratie
  volume: 0.85,
  lastFrame: 0,
  lastSpeed: 0,
  wakeLock: null,
};

// --- Profielkeuze vullen -----------------------------------------------------
function populateProfiles() {
  const sel = $('soundSelect');
  sel.innerHTML = '';
  for (const p of PROFILES) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    sel.appendChild(opt);
  }
  sel.value = state.profileId;
}

// --- Wake Lock (telefoon: scherm aan houden) --------------------------------
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => {});
    }
  } catch (e) {
    /* niet fataal */
  }
}
function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}
document.addEventListener('visibilitychange', () => {
  if (state.running && document.visibilityState === 'visible') requestWakeLock();
});

// --- Start / stop ------------------------------------------------------------
async function start() {
  if (state.running) return;
  // AudioContext mag pas na een user-gesture starten (deze klik).
  state.ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (state.ctx.state === 'suspended') await state.ctx.resume();

  state.engine = new EngineSound(state.ctx);
  const profile = getProfile(state.profileId);
  state.engine.applyProfile(profile);
  state.engine.setVolume(state.volume);
  state.engine.start();

  state.model = new RpmModel(profile, state.maxSpeed);

  // GPS of demo volgens de huidige keuze
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
  // Context even laten uitfaden, dan suspenden
  setTimeout(() => {
    if (state.ctx && state.ctx.state === 'running') state.ctx.suspend();
  }, 250);
  $('overlay').classList.remove('hidden');
  document.body.classList.remove('running');
}

// --- Render-loop (60 fps) ----------------------------------------------------
function loop(now) {
  if (!state.running) return;
  const dt = Math.min(100, now - state.lastFrame);
  state.lastFrame = now;

  const speedKmh = state.speed.tick(dt);
  // Acceleratie in m/s^2 uit snelheidsverschil
  const accel = ((speedKmh - state.lastSpeed) / 3.6) / (dt / 1000 || 0.016);
  state.lastSpeed = speedKmh;

  const out = state.model.update(speedKmh, accel, dt);
  if (out.shifted) state.engine.shiftCut();
  state.engine.update(out.rpm, out.load);

  updateGauges(speedKmh, out.rpm, out.gear, getProfile(state.profileId));
  requestAnimationFrame(loop);
}

// --- UI-uitlezing ------------------------------------------------------------
const GAUGE = { start: -220, end: 40 }; // graden voor de RPM-boog
function updateGauges(speedKmh, rpm, gear, profile) {
  $('speedVal').textContent = Math.round(speedKmh);
  $('rpmVal').textContent = Math.round(rpm).toLocaleString('nl-NL');
  $('gearVal').textContent = profile.linear ? '—' : gear;

  const frac = Math.min(1, rpm / profile.redline);
  const deg = GAUGE.start + (GAUGE.end - GAUGE.start) * frac;
  $('needle').style.transform = `rotate(${deg}deg)`;

  const arc = $('rpmArc');
  const circ = 2 * Math.PI * 90;
  const sweep = 0.72; // fractie van de cirkel die de boog beslaat
  arc.style.strokeDasharray = `${frac * sweep * circ} ${circ}`;
  arc.classList.toggle('redline', frac > 0.9);
}

// --- Controls ----------------------------------------------------------------
function wireControls() {
  $('startBtn').addEventListener('click', start);
  $('stopBtn').addEventListener('click', stop);

  $('soundSelect').addEventListener('change', (e) => {
    state.profileId = e.target.value;
    const p = getProfile(state.profileId);
    if (state.engine) state.engine.applyProfile(p);
    if (state.model) state.model.setProfile(p, state.maxSpeed);
    $('modeLabel').textContent = p.linear ? 'Lineair' : 'Manueel (versnellingsbak)';
  });

  const vol = $('volume');
  vol.addEventListener('input', (e) => {
    state.volume = e.target.value / 100;
    $('volVal').textContent = e.target.value + '%';
    if (state.engine) state.engine.setVolume(state.volume);
  });

  const ms = $('maxSpeed');
  ms.addEventListener('input', (e) => {
    state.maxSpeed = parseInt(e.target.value, 10);
    $('maxSpeedVal').textContent = state.maxSpeed + ' km/h';
    if (state.model) state.model.setMaxSpeed(state.maxSpeed);
  });

  const demo = $('demoSpeed');
  demo.addEventListener('input', (e) => {
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
$('modeLabel').textContent = 'Manueel (versnellingsbak)';

// Service worker voor offline gebruik (PWA).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

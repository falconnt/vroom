// sw.js — service worker.
// Strategie:
//   - App-shell (HTML/CSS/JS/manifest): NETWERK-FIRST. Zo krijg je online altijd
//     de nieuwste versie; offline valt hij terug op de cache. (Dit voorkomt het
//     "ik zie de oude versie"-probleem van een cache-first shell.)
//   - Zware, zelden wijzigende assets (geluiden, iconen): CACHE-FIRST.
const CACHE = 'vroom-v6';

const CORE = [
  './', './index.html', './about.html', './styles.css', './manifest.webmanifest',
  './src/app.js', './src/audioEngine.js', './src/sampledEngine.js',
  './src/rpmModel.js', './src/speed.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];
const AUDIO = [
  './assets/sounds/engines/fordgt.wav', './assets/sounds/engines/f40.wav',
  './assets/sounds/engines/porsche.wav', './assets/sounds/engines/subaru.wav',
  './assets/sounds/tr_engine.wav', './assets/sounds/tr_gear.wav',
  './assets/sounds/fx/backfire.wav',
  './assets/sounds/diesel/idle.wav', './assets/sounds/diesel/low.wav',
  './assets/sounds/diesel/medium.wav', './assets/sounds/diesel/high.wav',
  './assets/sounds/diesel/force.wav',
  './assets/sounds/rpmbank/a1000.ogg', './assets/sounds/rpmbank/a3000.ogg',
  './assets/sounds/rpmbank/a5000.ogg', './assets/sounds/rpmbank/a7000.ogg',
  './assets/sounds/rpmbank/a9000.ogg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled([...CORE, ...AUDIO].map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAudioOrIcon(url) {
  return url.pathname.includes('/assets/sounds/') || url.pathname.includes('/icons/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isAudioOrIcon(url)) {
    // Cache-first voor zware assets.
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Netwerk-first voor de app-shell; val terug op cache (offline).
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});

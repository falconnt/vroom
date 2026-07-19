// sw.js — service worker: cache de app-shell + geluiden zodat Vroom offline werkt.
const CACHE = 'vroom-v4';
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/audioEngine.js',
  './src/sampledEngine.js',
  './src/rpmModel.js',
  './src/speed.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  // Echte motorgeluiden (open-source games, GPL/MIT — zie about.html)
  './assets/sounds/engines/fordgt.wav',
  './assets/sounds/engines/f40.wav',
  './assets/sounds/engines/porsche.wav',
  './assets/sounds/engines/subaru.wav',
  './assets/sounds/tr_engine.wav',
  './assets/sounds/tr_gear.wav',
  './assets/sounds/fx/backfire.wav',
  './assets/sounds/diesel/idle.wav',
  './assets/sounds/diesel/low.wav',
  './assets/sounds/diesel/medium.wav',
  './assets/sounds/diesel/high.wav',
  './assets/sounds/diesel/force.wav',
  './assets/sounds/rpmbank/a1000.ogg',
  './assets/sounds/rpmbank/a3000.ogg',
  './assets/sounds/rpmbank/a5000.ogg',
  './assets/sounds/rpmbank/a7000.ogg',
  './assets/sounds/rpmbank/a9000.ogg',
];

self.addEventListener('install', (e) => {
  // Audio faalt soms per bestand; blokkeer install niet daarop.
  e.waitUntil(
    caches.open(CACHE).then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});

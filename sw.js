// sw.js — service worker: cache de hele app-shell zodat Vroom offline werkt.
// De app heeft geen externe assets (geluid is procedureel), dus dit is een
// simpele, complete offline-cache.
const CACHE = 'vroom-v1';
const ASSETS = [
  './',
  './index.html',
  './about.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/audioEngine.js',
  './src/rpmModel.js',
  './src/speed.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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

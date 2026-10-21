'use strict';
const SHELL = 'dt-shell-v1';
const TILES = 'dt-tiles-v1';
const ASSETS = [
  './', 'index.html', 'style.css', 'app.js', 'icon.svg', 'manifest.webmanifest',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];
const TILE_HOSTS = ['data.geopf.fr', 'server.arcgisonline.com'];
const STATIC_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => Promise.all(ASSETS.map((a) => c.add(a).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![SHELL, TILES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) (await caches.open(name)).put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || (await caches.match('index.html'));
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/socket.io/') && url.origin === location.origin && !url.pathname.endsWith('.js')) return;
  if (TILE_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req, TILES)); return; }
  if (STATIC_HOSTS.includes(url.hostname)) { e.respondWith(cacheFirst(req, SHELL)); return; }
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
});

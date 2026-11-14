// ============================================================
// SW v3 : cache app (stale-while-revalidate) + cache tuiles carte
// (cache-first, 800 tuiles) → zones blanches partiellement couvertes
// ============================================================
const VERSION = 'fc-v3';
const SHELL = VERSION + '-shell';
const TILES = VERSION + '-tiles';
const TILE_MAX = 800;

const SHELL_URLS = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/config.js', './js/utils.js', './js/state.js', './js/db.js',
  './js/notify.js', './js/map.js', './js/ui.js', './js/navigation.js', './js/radars.js',
  './js/radarzen.js', './js/trips.js', './js/radio.js', './js/avatar.js', './js/diag.js'
];

const TILE_HOSTS = [
  'api.maptiler.com', 'data.geopf.fr',
  'tile.openstreetmap.org', 'a.tile.openstreetmap.org', 'b.tile.openstreetmap.org', 'c.tile.openstreetmap.org'
];

// PNG transparent 1×1 (tuile manquante hors ligne → fond neutre, pas d'erreur)
const BLANK_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const blankResponse = () => new Response(
  Uint8Array.from(atob(BLANK_PNG), c => c.charCodeAt(0)),
  { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' } }
);

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.allSettled(SHELL_URLS.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys())
      if (!key.startsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

async function trimTiles(){
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  if (keys.length > TILE_MAX)
    await Promise.all(keys.slice(0, keys.length - TILE_MAX).map(k => cache.delete(k)));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 1) Navigations : réseau d'abord, repli cache (app utilisable hors ligne)
  if (req.mode === 'navigate'){
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch(err){
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 2) Tuiles carte : cache-first + remplissage + purge LRU
  if (TILE_HOSTS.includes(url.hostname)){
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const fresh = await fetch(req);
        if (fresh.ok){
          await cache.put(req, fresh.clone());
          trimTiles();
        }
        return fresh;
      } catch(err){
        return blankResponse();
      }
    })());
    return;
  }

  // 3) Base radars (CSV) : stale-while-revalidate
  if (url.hostname === 'raw.githubusercontent.com'){
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // 4) Fichiers de l'app : stale-while-revalidate
  if (url.origin === self.location.origin){
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }

  // 5) Reste (Firebase, Valhalla, OSRM, worker TTS…) : réseau direct, jamais caché
});

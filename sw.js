/* ==========================================================================
 * Chewy's POS — Service Worker (PWA / mode offline)
 *
 * - App shell (HTML/JS/CSS/CDN) di-cache saat install -> halaman tetap bisa
 *   dibuka walau internet mati.
 * - GET ke Supabase REST: stale-while-revalidate -> data menu/kategori tetap
 *   tampil offline (dari cache terakhir).
 * - POST/PUT/PATCH/DELETE tidak di-cache; saat offline request gagal dan
 *   ditangani lapisan outbox di api-supabase.js (checkout diantre, disinkron
 *   otomatis saat online).
 * ========================================================================== */
var CACHE_NAME = 'chewys-pos-v1';

var APP_SHELL = [
  './pos.html',
  './owner.html',
  './admin.html',
  './api-supabase.js',
  './brand-config.js',
  './manifest.json',
  './assets/logo-chewys-orange.png',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/lucide@latest'
];

function isSupabaseRest(url) {
  return url.hostname.indexOf('supabase.co') !== -1 &&
         url.pathname.indexOf('/rest/v1/') === 0;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      // addAll per-satu agar 1 file gagal tidak menggagalkan semuanya
      return Promise.all(APP_SHELL.map(function (u) {
        return cache.add(u).catch(function () { /* lewati yg gagal */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // tulis-menulis: biarkan gagal offline -> outbox
  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 1) Supabase REST GET -> stale-while-revalidate
  if (isSupabaseRest(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(function (cache) {
        return cache.match(req).then(function (hit) {
          var net = fetch(req).then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit || Response.error(); });
          return hit || net;
        });
      })
    );
    return;
  }

  // 2) Aset same-origin -> cache-first, fallback navigasi ke pos.html
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () {
          if (req.mode === 'navigate') return caches.match('./pos.html');
          return Response.error();
        });
      })
    );
    return;
  }

  // 3) CDN pihak ketiga (tailwind/lucide sudah di APP_SHELL) -> cache-first
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return Response.error(); });
    })
  );
});

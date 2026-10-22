/* HhGames — sw.js: keeps the site and its pictures on the phone so it opens fast and works offline.
   Pages always come fresh from the internet when there is a connection, so updates show straight away.
   Darts Champion has its own sw.js and isn't handled here. */
var CACHE = 'hhgames-v1';
var SHELL = ['./', 'index.html', 'privacy.html', 'manifest.webmanifest', 'favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('hhgames-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function save(req, res) {
  if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
  return res;
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;          // leave reviews, scores and fonts alone
  var path = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (path.indexOf('darts-champion/') === 0 || path.indexOf('admin') === 0 || path.indexOf('supabase/') === 0) return;

  if (req.mode === 'navigate' || /\.html?$/.test(path) || path === '') {
    // Pages: newest from the internet, the saved copy when offline.
    e.respondWith(fetch(req).then(function (res) { return save(req, res); }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || (req.destination === 'iframe' ? Response.error() : caches.match('index.html')); });
    }));
    return;
  }
  // Pictures, icons and scripts: the saved copy straight away, refreshed in the background.
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) { return save(req, res); }).catch(function () { return hit; });
    return hit || net;
  }));
});

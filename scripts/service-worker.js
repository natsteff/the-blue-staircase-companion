const prefix = 'last-witness-' + self.registration.scope + '-';
const cacheName = prefix + '__REVISION__';
const assets = __FILES__;
const scope = self.registration.scope;
const files = new Set(assets.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(assets.map(path => new Request(new URL(path, scope), {cache: 'reload'})))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(prefix) && key !== cacheName)
    .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

async function serve(request, url) {
  const cache = await caches.open(cacheName);
  const response = await cache.match(url);
  if (!response) return fetch(request);
  const range = request.headers.get('Range');
  if (!range) return response;
  const body = await response.arrayBuffer();
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  const start = match?.[1] ? Number(match[1]) : Math.max(0, body.byteLength - Number(match?.[2]));
  const end = match?.[1] && match[2] ? Math.min(Number(match[2]), body.byteLength - 1) : body.byteLength - 1;
  if (!match || (!match[1] && !match[2]) || start > end || start >= body.byteLength) {
    return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.byteLength}});
  }
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + body.byteLength);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), {status: 206, headers});
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const route = url.origin + url.pathname;
  if (event.request.mode === 'navigate' && (route === scope || route === scope + 'index.html')) {
    event.respondWith(serve(event.request, scope + 'index.html'));
  } else if (files.has(route)) {
    event.respondWith(serve(event.request, route));
  }
});

const CACHE_NAME = 'sauti-sounds-shell-v1'
const APP_SHELL = ['/', '/manifest.json', '/brand/icon-192.png', '/brand/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tracks/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')))
    return
  }

  if (['font', 'image', 'manifest', 'script', 'style'].includes(request.destination)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => (
        fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone())
            }
            return response
          })
          .catch(() => cache.match(request))
      )),
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request)),
  )
})

const BUILD_ID = "69a4fdf908ae"
const CACHE_NAME = `crm-pwa-${BUILD_ID}`
const APP_SCOPE = new URL('./', self.registration.scope)
const PRECACHE_URLS = ["","apple-touch-icon.png","favicon.svg","icon-192.png","icon-512.png","icon-maskable-512.png","icons.svg","manifest.webmanifest","assets/eb-garamond-latin-CRpggXlh.woff2","assets/es-D4THWdz3.js","assets/index-D7xUwj4K.css","assets/index-TTJSOI1B.js","assets/index.es-DUXKxZAC.js","assets/jspdf.es.min-BsyNeE-A.js","assets/purify.es-Bvo9QlJ8.js","assets/report.worker-CfkjNNw8.js"].map((path) => new URL(path, APP_SCOPE).href)
const PRECACHE_SET = new Set(PRECACHE_URLS)
const ASSET_PATH = new URL('assets/', APP_SCOPE).pathname

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // One missing icon must not stop the whole worker from installing.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(url)
          } catch (error) {
            console.warn('PWA precache skipped', url, error)
          }
        }),
      )
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('crm-pwa-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Supabase traffic is deliberately not cached here. The app has its own
  // TTL/invalidation layer; caching API responses in the worker caused stale
  // rows and unbounded token-keyed entries in an earlier version.
  if (
    request.method !== 'GET' ||
    url.origin !== APP_SCOPE.origin ||
    !url.pathname.startsWith(APP_SCOPE.pathname)
  ) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME)
        const shell = await cache.match(PRECACHE_URLS[0])
        if (shell) return shell
        throw new Error('The app shell is not available offline.')
      }),
    )
    return
  }

  if (!PRECACHE_SET.has(url.href) && !url.pathname.startsWith(ASSET_PATH)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok && response.type !== 'opaque') await cache.put(request, response.clone())
      return response
    }),
  )
})

// Push is optional infrastructure: a server still has to send the message.
// Keeping the handlers here means a deployed scheduler needs no worker change.
self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Anthrovisor', body: event.data.text() }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Anthrovisor', {
      body: payload.body || '',
      tag: payload.tag,
      icon: new URL('icon-192.png', APP_SCOPE).href,
      badge: new URL('favicon.svg', APP_SCOPE).href,
      data: { path: payload.path || './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.path || './', APP_SCOPE).href
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const existing = open.find((client) => client.url === target)
      if (existing) return existing.focus()
      return clients.openWindow(target)
    }),
  )
})

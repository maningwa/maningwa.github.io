const CACHE_NAME = 'crm-pwa-v1'
const APP_SCOPE = new URL('./', self.registration.scope)
const APP_SHELL = APP_SCOPE.href
const STATIC_ASSETS = [
  new URL('manifest.webmanifest', APP_SCOPE).href,
  new URL('favicon.svg', APP_SCOPE).href,
  new URL('apple-touch-icon.png', APP_SCOPE).href,
  new URL('icon-192.png', APP_SCOPE).href,
  new URL('icon-512.png', APP_SCOPE).href,
  new URL('icon-maskable-512.png', APP_SCOPE).href,
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll([APP_SHELL, ...STATIC_ASSETS]))
      .then(() => self.skipWaiting()),
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (
    request.method !== 'GET' ||
    url.origin !== APP_SCOPE.origin ||
    !url.pathname.startsWith(APP_SCOPE.pathname)
  ) {
    return
  }

  const isNavigation = request.mode === 'navigate'
  const isStaticAsset =
    url.pathname.startsWith(new URL('assets/', APP_SCOPE).pathname) ||
    STATIC_ASSETS.includes(url.href)

  if (isNavigation) {
    event.respondWith(
      fetch(request).catch(async () => {
        const shell = await caches.match(APP_SHELL)
        if (shell) return shell
        throw new Error('The app shell is not available offline.')
      }),
    )
    return
  }

  if (!isStaticAsset) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response.ok && response.type !== 'opaque') {
        await cache.put(request, response.clone())
      }
      return response
    }),
  )
})

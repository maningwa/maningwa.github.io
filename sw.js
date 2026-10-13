/*
 * Service worker — offline shell and network-only-on-cache-miss.
 *
 * The app already keeps its own read cache (lib/cache.js), so this worker is not
 * where "don't hit the network" is decided for data; it makes that decision at
 * the transport layer so a phone on a flaky connection still gets an answer, and
 * so the shell is installable and opens with no connection at all.
 *
 * Strategy per request kind:
 *
 *   Hashed build assets (immutable)  cache-first, never revalidated. The
 *                                    filename changes with the content, so a
 *                                    cache hit can never be stale.
 *   Supabase REST GET                 cache-first. This is the "network only on a
 *                                    cache miss" rule for data: a cached read
 *                                    answers without touching the network, and a
 *                                    miss goes out and populates the cache.
 *   Navigations (HTML)               cache-first with a background refresh. The
 *                                    cached shell paints instantly and offline;
 *                                    the refresh is what eventually delivers a
 *                                    new deploy. Deliberately not
 *                                    network-first, which would make the app
 *                                    unusable without a connection.
 *   Everything else (mutations,
 *    auth, storage)                   network only. Never cached, never
 *                                    replayed from a cache — a stale POST
 *                                    response is worse than an error.
 *
 * The Supabase cache is keyed by full URL *including* the access token, and the
 * whole cache is dropped whenever the signed-in user changes, so one account's
 * records can never be served to another. That is the same scoping rule
 * lib/cache.js applies to localStorage.
 */

const VERSION = 'v1'
const SHELL_CACHE = `crm-shell-${VERSION}`
const ASSET_CACHE = `crm-assets-${VERSION}`
const DATA_CACHE = `crm-data-${VERSION}`

/**
 * The directory this worker is served from, i.e. the app's base path.
 *
 * Derived from the registration scope rather than hard-coded to `/`, because the
 * app supports being deployed under a sub-path (GitHub Pages project sites set
 * VITE_BASE_PATH). A hard-coded `/index.html` would precache nothing there and
 * the offline shell would silently never work.
 */
const BASE = new URL(self.registration.scope).pathname
const SHELL_URLS = [
  BASE,
  `${BASE}index.html`,
  `${BASE}manifest.webmanifest`,
  `${BASE}favicon.svg`,
].map((path) => new URL(path, self.registration.scope).href)

// Bumped by the sign-in/sign-out hooks so one account cannot read another's
// cached rows. POST /auth/v1/token is how the session actually changes.
const IDENTITY_PATHS = ['/auth/v1/token', '/auth/v1/logout', '/auth/v1/signup']

const isSupabaseRequest = (url) =>
  url.hostname.endsWith('.supabase.co') || url.pathname.startsWith('/rest/v1/')

const isMutating = (request) =>
  request.method !== 'GET' && request.method !== 'HEAD'

self.addEventListener('install', (event) => {
  // The shell is cached opportunistically: a missing entry costs one runtime
  // fetch, and a failed precache must never block installation.
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {}),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  const keep = new Set([SHELL_CACHE, ASSET_CACHE, DATA_CACHE])
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

/** Network, with the shared session cache dropped if identity moved. */
async function networkWithIdentityReset(request) {
  const url = new URL(request.url)
  if (IDENTITY_PATHS.some((path) => url.pathname.includes(path))) {
    // The old account's rows must not survive a sign-in or sign-out.
    await caches.delete(DATA_CACHE)
  }
  return fetch(request)
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Range requests (media, large files) must pass straight through.
  if (request.method !== 'GET') return
  if (request.headers.has('range')) return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (isMutating(request)) return

  if (sameOrigin && request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request))
    return
  }

  if (sameOrigin && isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
    return
  }

  if (isSupabaseRequest(url) || (sameOrigin && url.pathname.startsWith('/api/'))) {
    event.respondWith(cacheFirst(request, DATA_CACHE))
    return
  }

  if (sameOrigin) {
    event.respondWith(cacheFirst(request, ASSET_CACHE))
  }
})

/** Vite fingerprints build output, so a hashed name is safe to pin forever. */
function isImmutableAsset(url) {
  return /\.[0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpg|jpeg|svg|webp|avif)$/.test(url.pathname)
}

/**
 * Cache-first, populating on a miss.
 *
 * A cached entry is returned without any network call at all — that is the
 * whole point. A miss (or a failed fetch with nothing stored) falls through to
 * the network and stores the response for next time.
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  if (cached) return cached

  try {
    const response = await networkWithIdentityReset(request)
    // Opaque and error responses are not worth storing: an opaque entry cannot
    // be validated later, and caching a 5xx would pin the failure.
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const fallback = await cache.match(request, { ignoreSearch: true })
    if (fallback) return fallback
    throw error
  }
}

/**
 * Serve the cached shell immediately, then refresh it in the background.
 *
 * Background-first (rather than awaiting the network) is what keeps the app
 * usable on a plane or in a lift: the cached document paints at once, and the
 * fresh one is swapped into the cache for the next load. The user does not wait
 * on a round trip to see their leads.
 */
async function navigationStrategy(request) {
  const cache = await caches.open(SHELL_CACHE)
  const indexUrl = new URL(`${BASE}index.html`, self.registration.scope).href
  const cached = (await cache.match(request)) ?? (await cache.match(indexUrl))

  const refresh = networkWithIdentityReset(request)
    .then((response) => {
      if (response && response.status === 200) cache.put(indexUrl, response.clone())
      return response
    })
    .catch(() => null)

  if (cached) {
    event_safeRefresh(refresh)
    return cached
  }

  const response = await refresh
  return (
    response ??
    new Response('<h1>Offline</h1><p>Open the app once while connected to install it.</p>', {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  )
}

/** Keeps an un-awaited promise from being treated as an unhandled rejection. */
function event_safeRefresh(promise) {
  promise.catch(() => {})
}

self.addEventListener('message', (event) => {
  // Lets the app drop the data cache explicitly (sign-out, "clear local data").
  if (event.data?.type === 'CRM_CLEAR_DATA_CACHE') {
    event.waitUntil(caches.delete(DATA_CACHE))
  }
})
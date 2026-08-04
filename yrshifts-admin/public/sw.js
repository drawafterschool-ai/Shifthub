// Firebase compat scripts for FCM background push support
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js')

firebase.initializeApp({
  apiKey:            'AIzaSyASLpQohPHu0wrZhnsgo--C7-sZ9RsJ5Bg',
  authDomain:        'yrshifts.firebaseapp.com',
  projectId:         'yrshifts',
  storageBucket:     'yrshifts.firebasestorage.app',
  messagingSenderId: '1008841462318',
  appId:             '1:1008841462318:web:b5ebcdbf085e73bcba45bf',
})

const messaging = firebase.messaging()

// Handle background messages — log only to prevent duplicate background notifications
messaging.onBackgroundMessage(payload => {
  console.log('[sw.js] Received background message ', payload)
})

// When notification is clicked, focus the app or open it
self.addEventListener('notificationclick', event => {
  event.notification.close()
  
  let targetUrl = '/admin'
  if (event.notification.data) {
    targetUrl = event.notification.data.link || event.notification.data.url || targetUrl
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        const clientPath = new URL(client.url, self.location.origin).pathname
        if (clientPath.includes('/admin') && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow(targetUrl)
    })
  )
})

const CACHE = 'shifthub-admin-v12'

// Pre-cache the shell on install
self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch strategy:
// 1. Navigation & JS/CSS: Network-First to ensure fresh code and instant updates
// 2. Static media (fonts/images): Cache-First with Network fallback
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || !url.origin.includes(self.location.origin)) return

  // Navigation requests (HTML) and code bundles (JS/CSS) — Network-First
  if (request.mode === 'navigate' || url.pathname.match(/\.(js|css)$/)) {
    e.respondWith(
      fetch(request)
        .then(res => {
          const type = res.headers.get('content-type') || ''
          if (res.status === 200 && (request.mode === 'navigate' || !type.includes('text/html'))) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request).then(cached => cached || (request.mode === 'navigate' ? caches.match('/admin/') : null)))
    )
    return
  }

  // Static assets (fonts, icons, images) — Cache-First
  if (url.pathname.match(/\.(woff2?|ttf|ico|jpg|jpeg|png|gif|svg|webp)$/)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.status === 200) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
      })
    )
  }
})

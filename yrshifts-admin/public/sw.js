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

const CACHE = 'shifthub-admin-v5'

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

// Network-first strategy — always try network, fall back to cache
self.addEventListener('fetch', e => {
  const { request } = e
  const url = new URL(request.url)

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || !url.origin.includes(self.location.origin)) return

  // For navigation requests (HTML), serve from network or fallback to cached shell
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.status === 200) {
            const clone = res.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return res
        })
        .catch(() => caches.match(request) || caches.match('/admin/'))
    )
    return
  }

  // For assets (JS, CSS, fonts) — cache-first
  if (url.pathname.match(/\.(js|css|woff2?|ttf|ico|jpg|png|svg)$/)) {
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

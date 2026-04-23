// Firebase Cloud Messaging Service Worker
// This file must be at the root of the app (/app/firebase-messaging-sw.js)
// It handles background push notifications when the app is not in the foreground.

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

// Handle background messages — show a notification when app is in background
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || 'ShiftHub'
  const body  = payload.notification?.body  || 'You have a new notification'
  const icon  = '/app/favicon.svg'

  self.registration.showNotification(title, {
    body,
    icon,
    badge: icon,
    tag:   payload.data?.notifId || 'shifthub',
    data:  payload.data || {},
    vibrate: [200, 100, 200],
  })
})

// When notification is clicked, focus the app or open it
self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('/app') && 'focus' in client) {
          return client.focus()
        }
      }
      return clients.openWindow('/app')
    })
  )
})

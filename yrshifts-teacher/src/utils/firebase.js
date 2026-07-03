import { initializeApp }  from 'firebase/app'
import { initializeFirestore } from 'firebase/firestore'
import { getStorage }     from 'firebase/storage'
import { getAuth }        from 'firebase/auth'
import { getMessaging }   from 'firebase/messaging'
import { getFunctions }   from 'firebase/functions'

const app = initializeApp({
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
})

export const db        = initializeFirestore(app, {
  // Force long-polling: the streaming transport breaks behind some
  // proxies/AV/extensions (Write/Listen channel 400s -> writes hang forever)
  experimentalForceLongPolling: true,
})
export const storage   = getStorage(app)
export const auth      = getAuth(app)
export const functions = getFunctions(app)

// Messaging is optional — not supported in all browsers
export let messaging = null
try { messaging = getMessaging(app) } catch { /* Safari < 16.4 */ }

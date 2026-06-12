import { lazy, Suspense, useState, useEffect } from 'react'
import useAuthStore          from '../stores/useAuthStore'
import useNotificationsStore from '../stores/useNotificationsStore'
import useChatStore          from '../stores/useChatStore'
import ErrorBoundary from '../components/ErrorBoundary'
import ViewLoader    from '../components/ViewLoader'

const MobileDayView     = lazy(() => import('../views/schedule/MobileDayView'))
const ChatView          = lazy(() => import('../views/chat/ChatView'))
const KBView            = lazy(() => import('../views/knowledge/KBView'))
const NotificationsView = lazy(() => import('../views/notifications/NotificationsView'))
const AdminProfileView  = lazy(() => import('../views/profile/AdminProfileView'))

const notifPermission = () => {
  try { return (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported' }
  catch { return 'unsupported' }
}

const pushSupported = (() => {
  try {
    return typeof Notification !== 'undefined' &&
           'serviceWorker' in navigator &&
           'PushManager' in window
  } catch { return false }
})()

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '')
const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
                     window.navigator.standalone === true
const needsHomeScreen = isIOS && !isStandalone

function IOSInstallBanner({ onDismiss }) {
  return (
    <div className="mx-3 mb-2 bg-accent-soft border border-accent/30 rounded-xl px-4 py-3 animate-fade-in text-accent">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-bold">📲 Enable push notifications on iPhone</p>
        <button onClick={onDismiss} className="text-dim cursor-pointer bg-transparent border-none text-base flex-shrink-0">×</button>
      </div>
      <ol className="text-xs flex flex-col gap-1.5 pl-1 list-decimal list-inside">
        <li>Tap the <strong>Share button 📤</strong> at the bottom of Safari</li>
        <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
        <li>Open the app from your Home Screen</li>
        <li>Tap the <strong>Profile tab 👤</strong> at the bottom to enable push notifications</li>
      </ol>
    </div>
  )
}

function PushBanner({ userId, onDismiss }) {
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const handleEnable = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('unsupported'); return
    }
    setStatus('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus('denied'); return
      }
      const { getToken } = await import('firebase/messaging')
      const { messaging } = await import('../utils/firebase')
      if (!messaging) {
        setStatus('unsupported'); return
      }
      
      const reg = await navigator.serviceWorker.ready
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
      if (!vapidKey) {
        setStatus('error')
        setErrorMsg('Missing VAPID key')
        return
      }
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg })
      if (!token) {
        setStatus('error')
        setErrorMsg('No token returned')
        return
      }
      const { doc, updateDoc } = await import('firebase/firestore')
      const { db } = await import('../utils/firebase')
      await updateDoc(doc(db, 'users', userId), { fcmToken: token })
      setStatus('done')
      setTimeout(onDismiss, 1500)
    } catch (e) {
      console.error(e)
      setStatus('error')
      setErrorMsg(e.message || 'Error occurred')
    }
  }

  if (status === 'done') return (
    <div className="mx-3 mb-2 flex items-center gap-2 bg-ok-soft border border-ok/30 rounded-xl px-3 py-2.5">
      <span>✅</span><p className="text-xs text-ok font-semibold">Notifications enabled!</p>
    </div>
  )
  if (status === 'denied') return (
    <div className="mx-3 mb-2 flex items-center gap-2 bg-raised border border-app rounded-xl px-3 py-2.5">
      <span>🔕</span>
      <p className="text-xs text-muted flex-1">Notifications blocked. Enable in settings.</p>
      <button onClick={onDismiss} className="text-dim cursor-pointer bg-transparent border-none">×</button>
    </div>
  )
  if (status === 'unsupported') return (
    <div className="mx-3 mb-2 flex items-center gap-2 bg-raised border border-app rounded-xl px-3 py-2.5">
      <span>ℹ️</span>
      <p className="text-xs text-muted flex-1">Push not supported on this browser.</p>
      <button onClick={onDismiss} className="text-dim cursor-pointer bg-transparent border-none">×</button>
    </div>
  )
  if (status === 'error') return (
    <div className="mx-3 mb-2 flex items-center gap-2 bg-raised border border-danger/30 rounded-xl px-3 py-2.5">
      <span>⚠️</span>
      <p className="text-xs text-danger flex-1 truncate" title={errorMsg}>Failed: {errorMsg}</p>
      <button onClick={onDismiss} className="text-dim cursor-pointer bg-transparent border-none">×</button>
    </div>
  )
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 bg-accent-soft border border-accent/30 rounded-xl px-3 py-2.5 animate-fade-in">
      <span className="text-base flex-shrink-0">🔔</span>
      <p className="text-xs text-accent font-medium flex-1">Enable push notifications for admin alerts</p>
      <button onClick={handleEnable} disabled={status === 'loading'}
        className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-bold cursor-pointer border-none flex-shrink-0 disabled:opacity-60">
        {status === 'loading' ? '…' : 'Enable'}
      </button>
      <button onClick={onDismiss} className="text-dim text-base cursor-pointer bg-transparent border-none">×</button>
    </div>
  )
}

const TABS = [
  { id: 'schedule',      icon: '📅', label: 'Schedule'      },
  { id: 'chat',          icon: '💬', label: 'Chat'          },
  { id: 'knowledge',     icon: '📚', label: 'Resources'     },
  { id: 'notifications', icon: '🔔', label: 'Notifications' },
  { id: 'profile',       icon: '👤', label: 'Profile'       },
]

export default function MobileLayout() {
  const [tab, setTab] = useState('schedule')
  const { userProfile } = useAuthStore()
  const unreadNotifs = useNotificationsStore(s => s.notifications.filter(n => n.status === 'unread').length)
  const { chats, messages } = useChatStore()
  const { user } = useAuthStore()

  const [showPush,      setShowPush]      = useState(false)
  const [pushDismissed, setPushDismissed] = useState(() => {
    return localStorage.getItem('shifthub_admin_push_dismissed') === 'true'
  })

  useEffect(() => {
    if ((pushSupported || needsHomeScreen) && notifPermission() !== 'granted' && !pushDismissed) {
      setTimeout(() => setShowPush(true), 1500)
    }
  }, [user?.uid])

  const unreadChat = user ? chats.reduce((total, chat) => {
    const lastReadTs = chat.lastRead?.[user.uid]?.seconds || 0
    const msgs = messages[chat.id] || []
    return total + msgs.filter(m => m.authorId !== user.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
  }, 0) : 0

  const badges = {
    notifications: unreadNotifs,
    chat:          unreadChat,
  }

  return (
    <div className="bg-app flex flex-col overflow-hidden" style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0 }}>

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-app flex-shrink-0"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 12px))' }}>
        <div className="flex items-center gap-2.5">
          <img src="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QB0RXhpZgAATU0AKgAAAAgABAEaAAUAAAABAAAAPgEbAAUAAAABAAAARgEoAAMAAAABAAIAAIdpAAQAAAABAAAATgAAAAAAAACWAAAAAQAAAJYAAAABAAKgAgAEAAAAAQAAAtmgAwAEAAAAAQAAAtkAAAAA/+IB2ElDQ19QUk9GSUxFAAEBAAAByAAAAAAEMAAAbW50clJHQiBYWVogB+AAAQABAAAAAAAAYWNzcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAPbWAAEAAAAA0y0AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJZGVzYwAAAPAAAAAkclhZWgAAARQAAAAUZ1hZWgAAASgAAAAUYlhZWgAAATwAAAAUd3RwdAAAAVAAAAAUclRSQwAAAWQAAAAoZ1RSQwAAAWQAAAAoYlRSQwAAAWQAAAAoY3BydAAAAYwAAAA8bWx1YwAAAAAAAAABAAAADGVuVVMAAAAIAAAAHABzAFIARwBCWFlaIAAAAAAAAG+iAAA49QAAA5BYWVogAAAAAAAAYpkAALeFAAAY2lhZWiAAAAAAAAAkoAAAD4QAALbPWFlaIAAAAAAAAPbWAAEAAAAA0y1wYXJhAAAAAAAEAAAAAmZmAADypwAADVkAABPQAAAKWwAAAAAAAAAAbWx1YwAAAAAAAAABAAAADGVuVVMAAAAgAAAAHABHAG8AbwBnAGwAZQAgAEkAbgBjAC4AIAAyADAAMQA2/9sAQwABAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/9sAQwEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAEQgB9AH0AwERAAIRAQMRAf/EAB8AAQAABgMBAQAAAAAAAAAAAAABAgMJCgsEBwgGBf/EAF0QAAEDBAEDAQQFBgYKDQsFAQEAAgMEBQYRBwgSITEJE0FRChQiYXEVMoGRofAWI0KxwdEXGjM0UnOSlrLxJDlTVVdidrO20tbX4RgZJTdWY3J3gpeiJ0OTlKbE/8QAHQEBAAEEAwEAAAAAAAAAAAAAAAkBAgcIAwQGBf/EAF0RAAIBAwMCBAMFAwYFDgwEBwECAAMEEQUSIQYxBxNBUQgiYRQycYGRI6GxFUJSwdHwGDNTcpUWJDU3VGJ1krKz0tPh8SU0NkNVdIKUorTC1CZEZGVzdhdWk6PE/9oADAMBAAIRAxEAPwDP4SISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISISI2Pn6eqSmQexBkNg+hB/SmD7SuD7RsfMfrCSmR7j9RI7B9CCkZB7EGQ2PmP1hVwe+Dj3xKF1BwWGe2I2PmP1hUlcj3H6iR2PmqZHuP1Erg+0KsQmQexzEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJEJ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EiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiEiKkEERAAIVKkS3D/2Q==" alt="YR" className="w-7 h-7 rounded-full object-cover" />
          <div>
            <h1 className="text-base font-bold text-primary tracking-wide">ShiftHub Admin</h1>
          </div>
        </div>
        {(pushSupported || needsHomeScreen) && (
          <button onClick={() => { setShowPush(true); setPushDismissed(false) }}
            title="Enable notifications"
            className={`w-8 h-8 rounded-lg border flex items-center justify-center text-base cursor-pointer bg-transparent transition-colors
              ${notifPermission() === 'granted' ? 'border-ok/40 text-ok' : 'border-app text-muted'}`}>
            {needsHomeScreen ? '📲' : notifPermission() === 'granted' ? '🔔' : '🔕'}
          </button>
        )}
      </div>

      {/* Push banner */}
      {showPush && !pushDismissed && (
        needsHomeScreen
          ? <IOSInstallBanner onDismiss={() => { setShowPush(false); setPushDismissed(true); localStorage.setItem('shifthub_admin_push_dismissed', 'true') }} />
          : <PushBanner userId={user?.uid} onDismiss={() => { setShowPush(false); setPushDismissed(true); localStorage.setItem('shifthub_admin_push_dismissed', 'true') }} />
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {TABS.map(t => (
          <div key={t.id} style={{ display: tab === t.id ? 'flex' : 'none' }} className="h-full flex-col">
            <ErrorBoundary>
              <Suspense fallback={<ViewLoader />}>
                {t.id === 'schedule'      && <MobileDayView />}
                {t.id === 'chat'          && <ChatView />}
                {t.id === 'knowledge'     && <KBView />}
                {t.id === 'notifications' && <NotificationsView />}
                {t.id === 'profile'       && <AdminProfileView />}
              </Suspense>
            </ErrorBoundary>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-surface border-t border-app rounded-t-2xl"
        style={{
          paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))',
          position: 'relative', zIndex: 0,
        }}>
        <div className="flex">
          {TABS.map(t => {
            const badge    = badges[t.id] || 0
            const isActive = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center justify-center pt-2.5 pb-2 gap-1 cursor-pointer border-none transition-colors
                  ${isActive ? 'bg-accent-soft' : 'bg-transparent'}`}>
                <div className="relative">
                  <span className="text-2xl leading-none">{t.icon}</span>
                  {badge > 0 && (
                    <span className="absolute -top-1.5 -right-3 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white font-bold flex items-center justify-center px-1"
                      style={{ fontSize: 10 }}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </div>
                <span className={`text-[11px] font-semibold ${isActive ? 'text-accent' : 'text-gray-400'}`}>
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

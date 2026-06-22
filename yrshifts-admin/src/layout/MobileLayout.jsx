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
          <img src="/admin/yr_logo.jpg" alt="YR" className="w-7 h-7 rounded-full object-cover" />
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

import { lazy, Suspense, useEffect, useState } from 'react'
import useAuthStore    from './stores/useAuthStore'
import useTeacherStore from './stores/useTeacherStore'
import useChatStore    from './stores/useChatStore'

import LoginView    from './views/LoginView'
import ErrorBoundary from './components/ErrorBoundary'
import ViewLoader    from './components/ViewLoader'
import InstallBanner from './components/InstallBanner'

const ScheduleView = lazy(() => import('./views/schedule/ScheduleView'))
const OpenView     = lazy(() => import('./views/open/OpenView'))
const ChatView     = lazy(() => import('./views/chat/ChatView'))
const UpdatesView  = lazy(() => import('./views/updates/UpdatesView'))
const ProfileView  = lazy(() => import('./views/profile/ProfileView'))
const KBView       = lazy(() => import('./views/knowledge/KBView'))
const EventsView   = lazy(() => import('./views/events/EventsView'))

const TABS = [
  { id: 'schedule',  icon: '📅', label: 'Schedule'  },
  { id: 'open',      icon: '⚡', label: 'Open'      },
  { id: 'chat',      icon: '💬', label: 'Chat'      },
  { id: 'updates',   icon: '📢', label: 'Updates'   },
  { id: 'events',    icon: '🗓️', label: 'Events'    },
  { id: 'knowledge', icon: '📚', label: 'Resources' },
  { id: 'profile',   icon: '👤', label: 'Profile'   },
]

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

function LoadingScreen() {
  return (
    <div className="w-screen h-screen flex flex-col items-center justify-center bg-app gap-3">
      <div className="w-10 h-10 rounded-2xl bg-accent flex items-center justify-center text-xl">📅</div>
      <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )
}

function ProfileMissingScreen({ onSignOut }) {
  return (
    <div className="w-screen h-screen flex items-center justify-center bg-app p-6">
      <div className="max-w-sm text-center bg-card border border-app rounded-2xl p-8">
        <p className="text-4xl mb-4">🔒</p>
        <h2 className="text-lg font-bold text-primary mb-2">Account not found</h2>
        <p className="text-sm text-muted mb-6 leading-relaxed">
          Your login was recognised but no profile exists. Ask your administrator to add you.
        </p>
        <button onClick={onSignOut} className="px-6 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold cursor-pointer border-none">
          Sign out
        </button>
      </div>
    </div>
  )
}

async function enablePushNotifications(userId) {
  try {
    if (typeof Notification === 'undefined') return { ok: false, reason: 'not_supported' }
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return { ok: false, reason: 'denied' }
    const { getToken } = await import('firebase/messaging')
    const { messaging } = await import('./utils/firebase')
    if (!messaging) return { ok: false, reason: 'not_supported' }
    const reg = await navigator.serviceWorker.register('/app/firebase-messaging-sw.js', { scope: '/app/' })
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
    if (!vapidKey) return { ok: false, reason: 'no_vapid' }
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg })
    if (!token) return { ok: false, reason: 'no_token' }
    const { doc, updateDoc } = await import('firebase/firestore')
    const { db } = await import('./utils/firebase')
    await updateDoc(doc(db, 'users', userId), { fcmToken: token })
    return { ok: true, token }
  } catch (e) {
    console.error('Push setup error:', e)
    return { ok: false, reason: e.message }
  }
}

function IOSInstallBanner({ onDismiss }) {
  return (
    <div className="mx-3 mb-2 bg-accent-soft border border-accent/30 rounded-xl px-3 py-3 animate-fade-in">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-xs font-bold text-accent">Enable notifications on iPhone</p>
        <button onClick={onDismiss} className="text-dim cursor-pointer bg-transparent border-none text-base flex-shrink-0">×</button>
      </div>
      <ol className="text-xs text-accent/90 flex flex-col gap-1.5 pl-1">
        <li>1. Tap <strong>Share ⎙</strong> at the bottom of Safari</li>
        <li>2. Tap <strong>"Add to Home Screen"</strong></li>
        <li>3. Open the app from your Home Screen</li>
        <li>4. Tap the 🔕 bell to enable notifications</li>
      </ol>
    </div>
  )
}

function PushBanner({ userId, onDismiss }) {
  const [status, setStatus] = useState('idle')

  const handleEnable = async () => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('unsupported'); return
    }
    setStatus('loading')
    const result = await enablePushNotifications(userId)
    if (result.ok) {
      setStatus('done')
      setTimeout(onDismiss, 1500)
    } else if (result.reason === 'denied') {
      setStatus('denied')
    } else if (result.reason === 'no_vapid') {
      setStatus('no_vapid')
    } else {
      setStatus('unsupported')
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
      <p className="text-xs text-muted flex-1">Notifications blocked. Enable in your browser settings.</p>
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
  return (
    <div className="mx-3 mb-2 flex items-center gap-3 bg-accent-soft border border-accent/30 rounded-xl px-3 py-2.5 animate-fade-in">
      <span className="text-base flex-shrink-0">🔔</span>
      <p className="text-xs text-accent font-medium flex-1">Enable push notifications for shift alerts</p>
      <button onClick={handleEnable} disabled={status === 'loading'}
        className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-bold cursor-pointer border-none flex-shrink-0 disabled:opacity-60">
        {status === 'loading' ? '…' : 'Enable'}
      </button>
      <button onClick={onDismiss} className="text-dim text-base cursor-pointer bg-transparent border-none">×</button>
    </div>
  )
}

export default function App() {
  const { user, userProfile, loading, profileMissing, init, signOut } = useAuthStore()
  const [tab,           setTab]           = useState('schedule')
  const [showPush,      setShowPush]      = useState(false)
  const [pushDismissed, setPushDismissed] = useState(false)

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!user || !userProfile) return
    useTeacherStore.getState().init(user.uid)
    useChatStore.getState().init()
    if ((pushSupported || needsHomeScreen) && notifPermission() !== 'granted' && !pushDismissed) {
      setTimeout(() => setShowPush(true), 1500)
    }
    return () => {
      useTeacherStore.getState().cleanup()
      useChatStore.getState().cleanup()
    }
  }, [user?.uid, userProfile?.role])

  const { openShifts, notifications, buzzPosts } = useTeacherStore()
  const { chats, messages } = useChatStore()

  const unreadChatCount = user ? chats.reduce((total, chat) => {
    const lastReadTs = chat.lastRead?.[user.uid]?.seconds || 0
    const msgs = messages[chat.id] || []
    return total + msgs.filter(m => m.authorId !== user.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
  }, 0) : 0

  const unreadBuzz = user ? buzzPosts.filter(p => !(p.seenBy || []).includes(user.uid)).length : 0

  const badges = { open: openShifts.length, chat: unreadChatCount, updates: unreadBuzz }

  if (loading)        return <LoadingScreen />
  if (!user)          return <LoginView />
  if (profileMissing) return <ProfileMissingScreen onSignOut={signOut} />

  return (
    // 🚨 ChatGPT Fix: Standard w-full h-full that naturally inherits the 100dvh from #root
    <div className="bg-app flex flex-col w-full h-full overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pb-3 bg-surface border-b border-app flex-shrink-0"
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))' }}>
        <div>
          <p className="text-xs text-muted leading-none">Welcome back</p>
          <p className="text-lg font-bold text-primary leading-tight">{userProfile?.firstName || 'Teacher'}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
            style={{ background: userProfile?.color || 'var(--accent)', color: '#fff' }}>
            {(userProfile?.firstName?.[0] || '') + (userProfile?.lastName?.[0] || '')}
          </div>
          {(pushSupported || needsHomeScreen) && (
            <button onClick={() => { setShowPush(true); setPushDismissed(false) }}
              title="Enable notifications"
              className={`w-8 h-8 rounded-lg border flex items-center justify-center text-base cursor-pointer bg-transparent transition-colors
                ${notifPermission() === 'granted' ? 'border-ok/40 text-ok' : 'border-app text-muted'}`}>
              {needsHomeScreen ? '📲' : notifPermission() === 'granted' ? '🔔' : '🔕'}
            </button>
          )}
          <button onClick={signOut}
            className="px-3 py-1.5 rounded-lg border border-app text-xs text-muted cursor-pointer bg-transparent transition-colors hover:text-primary">
            Sign out
          </button>
        </div>
      </div>

      {/* Install banner */}
      <InstallBanner manifestUrl="/app/manifest.json" appName="ShiftHub" icon="/app/yr_logo.jpg" />

      {/* Push banner */}
      {showPush && !pushDismissed && (
        needsHomeScreen
          ? <IOSInstallBanner onDismiss={() => { setShowPush(false); setPushDismissed(true) }} />
          : <PushBanner userId={user?.uid} onDismiss={() => { setShowPush(false); setPushDismissed(true) }} />
      )}

      {/* Tab content (Scrollable middle section) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {TABS.map(t => (
          <div key={t.id} style={{ display: tab === t.id ? 'flex' : 'none' }} className="h-full flex-col">
            <ErrorBoundary>
              <Suspense fallback={<ViewLoader />}>
                {t.id === 'schedule'  && <ScheduleView />}
                {t.id === 'open'      && <OpenView />}
                {t.id === 'chat'      && <ChatView />}
                {t.id === 'updates'   && <UpdatesView />}
                {t.id === 'events'    && <EventsView />}
                {t.id === 'knowledge' && <KBView />}
                {t.id === 'profile'   && <ProfileView />}
              </Suspense>
            </ErrorBoundary>
          </div>
        ))}
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 bg-surface border-t border-app"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)', zIndex: 1 }}>
        <div className="flex">
          {TABS.map(t => {
            const badge    = badges[t.id] || 0
            const isActive = tab === t.id
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 cursor-pointer border-none transition-colors min-w-0
                  ${isActive ? 'bg-accent-soft' : 'bg-transparent'}`}>
                <div className="relative">
                  <span style={{ fontSize: 20, lineHeight: 1 }}>{t.icon}</span>
                  {badge > 0 && (
                    <span className="absolute -top-1 -right-2.5 min-w-[15px] h-[15px] rounded-full bg-red-500 text-white font-bold flex items-center justify-center"
                      style={{ fontSize: 9, padding: '0 2px' }}>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  )}
                </div>
                <span className={`font-semibold truncate w-full text-center px-0.5 ${isActive ? 'text-accent' : 'text-gray-400'}`}
                  style={{ fontSize: 9 }}>
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

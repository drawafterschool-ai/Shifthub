import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'

import useAuthStore          from './stores/useAuthStore'
import useScheduleStore      from './stores/useScheduleStore'
import useDirectoryStore     from './stores/useDirectoryStore'
import useNotificationsStore from './stores/useNotificationsStore'
import useSettingsStore      from './stores/useSettingsStore'
import useChatStore          from './stores/useChatStore'
import useFormsStore         from './stores/useFormsStore'

import AdminLayout  from './layout/AdminLayout'
import ErrorBoundary from './components/ErrorBoundary'
import ViewLoader   from './components/ViewLoader'

// ── Lazy-loaded views — each becomes its own chunk ────────────────────────────
// Only LoginView is eager — it's the first screen and tiny.
import LoginView from './views/LoginView'

const ScheduleView      = lazy(() => import('./views/schedule/ScheduleView'))
const DirectoryView     = lazy(() => import('./views/directory/DirectoryView'))
const ChatView          = lazy(() => import('./views/chat/ChatView'))
const KBView            = lazy(() => import('./views/knowledge/KBView'))
const WeeklyBuzzView    = lazy(() => import('./views/templates/WeeklyBuzzView'))
const EventsView        = lazy(() => import('./views/templates/EventsView'))
const NotificationsView = lazy(() => import('./views/notifications/NotificationsView'))
const SettingsView      = lazy(() => import('./views/settings/SettingsView'))
const ReportingView     = lazy(() => import('./views/reporting/ReportingView'))
const FormsView         = lazy(() => import('./views/forms/FormsView'))

// ── Auth guard ────────────────────────────────────────────────────────────────
function RequireAdmin() {
  const { user, userProfile, loading, profileMissing } = useAuthStore()
  const { raw: settings } = useSettingsStore()

  if (loading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-app">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-muted">Loading ShiftHub…</p>
        </div>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  // Check trial expiration
  const trialExpiresAt = settings?.trialExpiresAt?.seconds 
    ? settings.trialExpiresAt.seconds * 1000 
    : (settings?.trialExpiresAt ? new Date(settings.trialExpiresAt).getTime() : null);

  if (trialExpiresAt && Date.now() > trialExpiresAt) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-app">
        <div className="max-w-sm text-center bg-card border border-app rounded-2xl p-10">
          <p className="text-4xl mb-4">⏳</p>
          <h2 className="text-lg font-bold text-primary mb-2">Trial Period Expired</h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Your 30-day trial period has expired. Thank you for trying ShiftHub!
          </p>
          <p className="text-xs text-dim mb-6">
            To reactivate your account, please contact:<br />
            <span className="font-semibold text-accent font-mono">giordanofontana@gmail.com</span>
          </p>
          <button onClick={() => useAuthStore.getState().signOut()}
            className="px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold cursor-pointer border-none hover:opacity-90">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (profileMissing) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-app">
        <div className="max-w-sm text-center bg-card border border-app rounded-2xl p-10">
          <p className="text-4xl mb-4">🔒</p>
          <h2 className="text-lg font-bold text-primary mb-2">Account not found</h2>
          <p className="text-sm text-muted mb-6 leading-relaxed">
            Your login was recognised but no profile exists. Ask your administrator to add you.
          </p>
          <button onClick={() => useAuthStore.getState().signOut()}
            className="px-5 py-2.5 bg-accent text-white rounded-lg text-sm font-semibold cursor-pointer border-none hover:opacity-90">
            Sign out
          </button>
        </div>
      </div>
    )
  }

  if (userProfile?.role === 'teacher') {
    window.location.href = '/app'
    return null
  }

  return <Outlet />
}

// ── Store initialiser ─────────────────────────────────────────────────────────
function StoreInit() {
  const { user, userProfile } = useAuthStore()

  useEffect(() => {
    if (!user || !userProfile) return
    const role = userProfile.role
    if (!['owner', 'admin', 'manager'].includes(role)) return

    useScheduleStore.getState().init()
    useDirectoryStore.getState().init()
    useNotificationsStore.getState().init()
    useSettingsStore.getState().init()
    useChatStore.getState().init()
    useFormsStore.getState().init()

    return () => {
      useScheduleStore.getState().cleanup()
      useDirectoryStore.getState().cleanup()
      useNotificationsStore.getState().cleanup()
      useSettingsStore.getState().cleanup()
      useChatStore.getState().cleanup()
      useFormsStore.getState().cleanup()
    }
  }, [user?.uid, userProfile?.role])

  return null
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)
  useEffect(() => {
    useAuthStore.getState().init()
    sessionStorage.removeItem('shifthub_admin_chunk_reload')
  }, [])

  useEffect(() => {
    const handleOnline = () => setIsOffline(false)
    const handleOffline = () => setIsOffline(true)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <BrowserRouter basename="/admin">
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 bg-amber-600 dark:bg-amber-700 text-white text-center py-1.5 text-xs font-semibold tracking-wide shadow-md z-[99999] flex items-center justify-center gap-1.5 transition-all duration-300">
          <span>📴</span>
          <span>Offline Mode — Viewing Cached Data</span>
        </div>
      )}
      <StoreInit />
      <Routes>
        <Route path="/login" element={<LoginView />} />

        <Route element={<RequireAdmin />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="schedule" replace />} />

            {/* Each view wrapped in ErrorBoundary + Suspense */}
            <Route path="schedule" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><ScheduleView /></Suspense></ErrorBoundary>
            }/>
            <Route path="directory" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><DirectoryView /></Suspense></ErrorBoundary>
            }/>
            <Route path="chat" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><ChatView /></Suspense></ErrorBoundary>
            }/>
            <Route path="knowledge" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><KBView /></Suspense></ErrorBoundary>
            }/>
            <Route path="buzz" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><WeeklyBuzzView /></Suspense></ErrorBoundary>
            }/>
            <Route path="events" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><EventsView /></Suspense></ErrorBoundary>
            }/>
            <Route path="notifications" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><NotificationsView /></Suspense></ErrorBoundary>
            }/>
            <Route path="settings" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><SettingsView /></Suspense></ErrorBoundary>
            }/>
            <Route path="reporting" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><ReportingView /></Suspense></ErrorBoundary>
            }/>
            <Route path="forms" element={
              <ErrorBoundary><Suspense fallback={<ViewLoader />}><FormsView /></Suspense></ErrorBoundary>
            }/>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="schedule" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

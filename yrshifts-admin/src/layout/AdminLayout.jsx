import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import MobileLayout from './MobileLayout'
import useAuthStore          from '../stores/useAuthStore'
import useNotificationsStore from '../stores/useNotificationsStore'
import { SmsToasts }         from '../hooks/useSms'
import { useSms }            from '../hooks/useSms'
import Avatar                from '../components/Avatar'
import { collection, onSnapshot, query } from 'firebase/firestore'
import { db } from '../utils/firebase'
import { SHIFT_TYPES, BUZZ_TYPES } from '../utils/notifications'

// roles that can see each nav item (undefined = all admin roles)
const NAV = [
  { to: 'schedule',      icon: '📅', label: 'Schedule'       },
  { to: 'directory',     icon: '📇', label: 'Directory'      },
  { to: 'chat',          icon: '💬', label: 'Chat'           },
  { to: 'knowledge',     icon: '📚', label: 'Knowledge Base', roles: ['owner','admin'] },
  { to: 'buzz',          icon: '📢', label: 'Weekly Buzz',    roles: ['owner','admin'] },
  { to: 'events',        icon: '🗓️', label: 'Events',         roles: ['owner','admin'] },
  { to: 'notifications', icon: '🔔', label: 'Notifications',  badge: true },
  { to: 'reporting',     icon: '📊', label: 'Reporting',      roles: ['owner','admin'] },
  { to: 'forms',         icon: '📝', label: 'Forms',          roles: ['owner','admin'] },
  { to: 'settings',      icon: '⚙️',  label: 'Settings',      roles: ['owner','admin'] },
]

const THEMES = ['dark', 'light']

export const SmsContext = { value: null }

export default function AdminLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [theme,     setTheme]     = useState('dark')
  const sms = useSms()

  // Expose sms to child routes via context (passed as outlet context)
  SmsContext.value = sms

  const { userProfile, signOut } = useAuthStore()
  const notifications = useNotificationsStore(s => s.notifications)
  const unreadCount = notifications.filter(n => n.status === 'unread').length

  const [hasNewEvents, setHasNewEvents] = useState(false)
  const [hasNewKB, setHasNewKB] = useState(false)

  useEffect(() => {
    const q = query(collection(db, 'events'))
    const unsub = onSnapshot(q, snap => {
      const lastViewed = Number(localStorage.getItem('shifthub_admin_events_last_viewed') || 0)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const hasNew = list.some(e => {
        const created = e.createdAt?.seconds ? (e.createdAt.seconds * 1000) : (e.createdAt || 0)
        const updated = e.updatedAt?.seconds ? (e.updatedAt.seconds * 1000) : (e.updatedAt || 0)
        return created > lastViewed || updated > lastViewed
      })
      setHasNewEvents(hasNew)
    })
    return unsub
  }, [])

  useEffect(() => {
    const q = query(collection(db, 'kb_nodes'))
    const unsub = onSnapshot(q, snap => {
      const lastViewed = Number(localStorage.getItem('shifthub_admin_kb_last_viewed') || 0)
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      const hasNew = list.some(n => {
        const created = n.createdAt?.seconds ? (n.createdAt.seconds * 1000) : (n.order || 0)
        return created > lastViewed
      })
      setHasNewKB(hasNew)
    })
    return unsub
  }, [])

  const hasNewBadge = (to) => {
    if (to === 'schedule') {
      return notifications.some(n => n.status === 'unread' && SHIFT_TYPES.includes(n.type))
    }
    if (to === 'directory') {
      return notifications.some(n => n.status === 'unread' && n.type === 'first_login')
    }
    if (to === 'buzz') {
      return notifications.some(n => n.status === 'unread' && BUZZ_TYPES.includes(n.type))
    }
    if (to === 'events') {
      return hasNewEvents
    }
    if (to === 'knowledge') {
      return hasNewKB
    }
    return false
  }

  const handleNavClick = (to) => {
    if (to === 'schedule') {
      const unreadShifts = notifications.filter(n => n.status === 'unread' && SHIFT_TYPES.includes(n.type))
      unreadShifts.forEach(n => useNotificationsStore.getState().markRead(n.id))
    }
    if (to === 'directory') {
      const unreadDir = notifications.filter(n => n.status === 'unread' && n.type === 'first_login')
      unreadDir.forEach(n => useNotificationsStore.getState().markRead(n.id))
    }
    if (to === 'buzz') {
      const unreadBuzz = notifications.filter(n => n.status === 'unread' && BUZZ_TYPES.includes(n.type))
      unreadBuzz.forEach(n => useNotificationsStore.getState().markRead(n.id))
    }
    if (to === 'events') {
      localStorage.setItem('shifthub_admin_events_last_viewed', String(Date.now()))
      setHasNewEvents(false)
    }
    if (to === 'knowledge') {
      localStorage.setItem('shifthub_admin_kb_last_viewed', String(Date.now()))
      setHasNewKB(false)
    }
  }

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    document.documentElement.className = next === 'light' ? 'light' : ''
  }

  // Detect mobile — show mobile layout on small screens
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  if (isMobile) return <MobileLayout />

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-app">

      {/* ── Sidebar ── */}
      <aside className={`
        flex flex-col flex-shrink-0 h-full bg-surface border-r border-app
        transition-all duration-200
        ${collapsed ? 'w-14' : 'w-52'}
      `}>

        {/* Logo + collapse toggle */}
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-app relative">
          <img src="/admin/yr_logo.jpg" alt="YR" className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-primary leading-tight">ShiftHub</p>
              <p className="text-2xs text-dim">Admin</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="absolute top-1/2 -translate-y-1/2 -right-4 z-20 w-8 h-8 rounded-full bg-surface border border-app shadow-md text-dim hover:text-primary hover:bg-raised flex items-center justify-center transition-all cursor-pointer"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="text-xl font-bold leading-none select-none">{collapsed ? '›' : '‹'}</span>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-1.5 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.filter(item => {
            if (!item.roles) return true  // visible to all admin roles
            return item.roles.includes(userProfile?.role)
          }).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              onClick={() => handleNavClick(item.to)}
              className={({ isActive }) => `
                flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm font-medium
                transition-all duration-100 relative
                ${isActive
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted hover:bg-raised hover:text-primary'}
              `}
            >
              <span className="text-base flex-shrink-0">{item.icon}</span>
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {item.badge && unreadCount > 0 && (
                <span className={`
                  text-white bg-danger text-[10px] font-bold rounded-full px-1.5 py-px
                  ${collapsed ? 'absolute top-1 right-1' : ''}
                `}>
                  {unreadCount}
                </span>
              )}
              {hasNewBadge(item.to) && !collapsed && (
                <span className="ml-auto text-white bg-danger font-extrabold rounded-full px-1.5 py-0.5 shadow-sm text-[8px] uppercase tracking-wider leading-none animate-pulse">
                  new
                </span>
              )}
              {hasNewBadge(item.to) && collapsed && (
                <span className="absolute top-1 right-1 text-white bg-danger font-extrabold rounded-full px-1 py-0.5 shadow-sm text-[7px] uppercase tracking-wider leading-none animate-pulse">
                  new
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Theme + profile */}
        <div className="p-2 border-t border-app flex flex-col gap-1.5">
          <button
            onClick={cycleTheme}
            title="Toggle theme"
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:bg-raised hover:text-primary transition-colors"
          >
            <span className="text-sm">{theme === 'dark' ? '🌙' : '☀️'}</span>
            {!collapsed && <span className="capitalize">{theme}</span>}
          </button>

          {!collapsed && userProfile && (
            <div className="flex items-center gap-2 px-2">
              <Avatar
                firstName={userProfile.firstName}
                lastName={userProfile.lastName}
                color={userProfile.color}
                photo={userProfile.photo}
                size={24}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary truncate">{userProfile.firstName}</p>
                <p className="text-2xs font-semibold capitalize" style={{
                  color: userProfile.role === 'owner' ? '#FBBF24' :
                         userProfile.role === 'manager' ? '#A78BFA' : 'var(--accent)'
                }}>{userProfile.role || 'admin'}</p>
              </div>
            </div>
          )}

          <button
            onClick={signOut}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-danger border border-danger/30 hover:bg-danger-soft transition-colors"
          >
            <span className="text-sm">🚪</span>
            {!collapsed && 'Log out'}
          </button>
        </div>
      </aside>

      {/* ── Main content — React Router Outlet ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet context={sms} />
      </main>

      {/* ── SMS toasts ── */}
      <SmsToasts msgs={sms.msgs} onDismiss={sms.dismiss} />
    </div>
  )
}

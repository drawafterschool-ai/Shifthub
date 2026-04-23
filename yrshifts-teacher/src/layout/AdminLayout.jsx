import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import useAuthStore          from '../stores/useAuthStore'
import useNotificationsStore from '../stores/useNotificationsStore'
import { SmsToasts }         from '../hooks/useSms'
import { useSms }            from '../hooks/useSms'

const NAV = [
  { to: 'schedule',      icon: '📅', label: 'Schedule'        },
  { to: 'directory',     icon: '📇', label: 'Directory'       },
  { to: 'chat',          icon: '💬', label: 'Chat'            },
  { to: 'knowledge',     icon: '📚', label: 'Knowledge Base'  },
  { to: 'buzz',          icon: '📢', label: 'Weekly Buzz'     },
    { to: 'events',        icon: '🗓️', label: 'Events'          },
  { to: 'notifications', icon: '🔔', label: 'Notifications',  badge: true },
  { to: 'settings',      icon: '⚙️',  label: 'Settings'       },
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
  const unreadCount = useNotificationsStore(s => s.notifications.filter(n => n.status === 'unread').length)

  const cycleTheme = () => {
    const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
    setTheme(next)
    document.documentElement.className = next === 'light' ? 'light' : ''
  }

  return (
    <div className="flex w-screen h-screen overflow-hidden bg-app">

      {/* ── Sidebar ── */}
      <aside className={`
        flex flex-col flex-shrink-0 h-full bg-surface border-r border-app
        transition-all duration-200
        ${collapsed ? 'w-14' : 'w-52'}
      `}>

        {/* Logo + collapse toggle */}
        <div className="flex items-center gap-2.5 px-3 py-4 border-b border-app">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center text-white text-sm flex-shrink-0">📅</div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-primary leading-tight">ShiftHub</p>
              <p className="text-2xs text-dim">Admin</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="ml-auto text-dim hover:text-muted transition-colors text-xs"
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-1.5 flex flex-col gap-0.5 overflow-y-auto">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
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
              <div className="w-6 h-6 rounded-full bg-accent-soft flex items-center justify-center text-accent text-xs font-bold flex-shrink-0">
                {(userProfile.firstName?.[0] || '') + (userProfile.lastName?.[0] || '')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-primary truncate">{userProfile.firstName}</p>
                <p className="text-2xs text-dim capitalize">{userProfile.role}</p>
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

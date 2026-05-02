import { useState, useMemo }    from 'react'
import { useNavigate }           from 'react-router-dom'
import useNotificationsStore     from '../../stores/useNotificationsStore'
import useDirectoryStore         from '../../stores/useDirectoryStore'
import {
  notifMessage, NOTIF_ICONS, NOTIF_COLORS,
  SHIFT_TYPES, PEOPLE_TYPES, CHAT_TYPES, BUZZ_TYPES,
} from '../../utils/notifications'
import Button from '../../components/Button'

// ── Tabs ──────────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'all',     label: 'All'       },
  { id: 'shifts',  label: 'Shifts'    },
  { id: 'people',  label: 'People'    },
  { id: 'chat',    label: 'Chat'      },
  { id: 'buzz',    label: 'Buzz'      },
  { id: 'pending', label: 'Pending ⚠️' },
]

const PENDING_TYPES = ['shift_rejected', 'shift_claimed']

function fmtTime(ts) {
  if (!ts) return ''
  const d    = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  const diff = Date.now() - d
  if (diff < 60000)    return 'Just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diff < 604800000) return d.toLocaleDateString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function NotifRow({ notif, onMarkRead, onNavigate, onIgnore }) {
  const isUnread = notif.status === 'unread'
  const icon     = NOTIF_ICONS[notif.type]  || '🔔'
  const color    = NOTIF_COLORS[notif.type] || 'text-muted'

  const actionBtn = () => {
    if (notif.type === 'shift_rejected' || notif.type === 'shift_claimed') {
      return (
        <div className="flex gap-1.5">
          <Button small variant="primary" onClick={e => { e.stopPropagation(); onNavigate('schedule') }}>
            Reassign
          </Button>
          <Button small variant="ghost" onClick={e => { e.stopPropagation(); onIgnore(notif.id) }}>
            Ignore
          </Button>
        </div>
      )
    }
    if (notif.type === 'shift_confirmed') {
      return (
        <Button small variant="ghost" onClick={e => { e.stopPropagation(); onNavigate('schedule') }}>
          View
        </Button>
      )
    }
    if (notif.type === 'chat_message') {
      return (
        <Button small variant="ghost" onClick={e => { e.stopPropagation(); onNavigate('chat') }}>
          Open chat
        </Button>
      )
    }
    if (notif.type === 'buzz_like' || notif.type === 'buzz_comment' || notif.type === 'buzz_posted') {
      return (
        <Button small variant="ghost" onClick={e => { e.stopPropagation(); onNavigate('buzz') }}>
          View post
        </Button>
      )
    }
    if (notif.type === 'instructor_joined') {
      return (
        <Button small variant="ghost" onClick={e => { e.stopPropagation(); onNavigate('directory') }}>
          View profile
        </Button>
      )
    }
    return null
  }

  return (
    <div
      onClick={() => { if (isUnread) onMarkRead(notif.id) }}
      className={`flex items-start gap-4 px-5 py-4 border-b border-app/30 transition-colors cursor-pointer
        ${isUnread ? 'bg-accent-soft hover:bg-accent-soft/70' : 'bg-transparent hover:bg-raised'}`}
    >
      {/* Icon with colour + unread dot */}
      <div className="relative flex-shrink-0 mt-0.5">
        <div className={`w-10 h-10 rounded-full bg-raised border border-app flex items-center justify-center text-lg`}>
          <span>{icon}</span>
        </div>
        {isUnread && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-accent border-2 border-surface" />
        )}
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className={`text-sm leading-snug ${isUnread ? 'font-semibold text-primary' : 'text-muted'}`}>
          {notifMessage(notif)}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs font-semibold uppercase tracking-wide ${color}`}>
            {notif.type?.replace(/_/g, ' ')}
          </span>
          <span className="text-dim text-xs">·</span>
          <span className="text-xs text-dim">{fmtTime(notif.createdAt)}</span>
        </div>
      </div>

      {/* Action + mark-read */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {actionBtn()}
        {isUnread && (
          <button
            onClick={e => { e.stopPropagation(); onMarkRead(notif.id) }}
            className="text-xs text-dim hover:text-muted cursor-pointer bg-transparent border-none px-1"
            title="Mark as read"
          >
            ✓
          </button>
        )}
      </div>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, color }) {
  return (
    <div className="bg-card border border-app rounded-xl p-4 flex items-center gap-3">
      <span className="text-2xl">{icon}</span>
      <div>
        <p className={`text-xl font-bold ${color}`}>{value}</p>
        <p className="text-xs text-dim">{label}</p>
      </div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function NotificationsView() {
  const { notifications, loading, markRead, markAllRead, clearAllPending, ignoreNotif, ignoreAll } = useNotificationsStore()
  const { instructors } = useDirectoryStore()
  const navigate        = useNavigate()
  const [activeTab, setActiveTab] = useState('all')

  const unreadCount    = notifications.filter(n => n.status === 'unread').length
  const pendingCount   = notifications.filter(n => PENDING_TYPES.includes(n.type) && !n.ignored).length
  const todayCount     = notifications.filter(n => {
    const d = n.createdAt?.seconds ? n.createdAt.seconds * 1000 : n.createdAt
    return d && (Date.now() - d) < 86400000
  }).length

  const filtered = useMemo(() => {
    const visible = notifications.filter(n => !n.ignored)
    switch (activeTab) {
      case 'shifts':  return visible.filter(n => SHIFT_TYPES.includes(n.type))
      case 'people':  return visible.filter(n => PEOPLE_TYPES.includes(n.type))
      case 'chat':    return visible.filter(n => CHAT_TYPES.includes(n.type))
      case 'buzz':    return visible.filter(n => BUZZ_TYPES.includes(n.type))
      case 'pending': return visible.filter(n => PENDING_TYPES.includes(n.type))
      default:        return visible
    }
  }, [notifications, activeTab])

  // Tab badge counts
  const tabBadge = (id) => {
    const unread = (list) => list.filter(n => n.status === 'unread').length
    switch (id) {
      case 'all':     return unreadCount
      case 'shifts':  return unread(notifications.filter(n => SHIFT_TYPES.includes(n.type)))
      case 'people':  return unread(notifications.filter(n => PEOPLE_TYPES.includes(n.type)))
      case 'chat':    return unread(notifications.filter(n => CHAT_TYPES.includes(n.type)))
      case 'buzz':    return unread(notifications.filter(n => BUZZ_TYPES.includes(n.type)))
      case 'pending': return pendingCount
      default:        return 0
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">

      {/* ── Header ── */}
      <div className="px-6 pt-5 pb-0 bg-surface border-b border-app flex-shrink-0">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-primary">Notifications</h1>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full bg-danger text-white text-xs font-bold animate-pulse">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex gap-2">
            {pendingCount > 0 && (
              <Button small variant="ghost" onClick={() => ignoreAll()}>Ignore all</Button>
            )}
            {unreadCount > 0 && (
              <Button small variant="ghost" onClick={markAllRead}>Mark all read</Button>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <StatCard icon="🔔" label="Unread"  value={unreadCount}  color="text-accent" />
          <StatCard icon="⚠️" label="Pending action" value={pendingCount} color={pendingCount > 0 ? 'text-danger' : 'text-muted'} />
          <StatCard icon="📅" label="Today"   value={todayCount}   color="text-ok" />
        </div>

        {/* Tabs */}
        <div className="flex overflow-x-auto border-b border-app -mb-px scrollbar-hide gap-0">
          {TABS.map(tab => {
            const badge = tabBadge(tab.id)
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold whitespace-nowrap cursor-pointer bg-transparent border-none border-b-2 transition-colors flex-shrink-0
                  ${activeTab === tab.id ? 'border-accent text-accent' : 'border-transparent text-muted hover:text-primary'}`}>
                {tab.label}
                {badge > 0 && (
                  <span className={`min-w-[18px] h-[18px] rounded-full text-[9px] font-bold flex items-center justify-center px-1
                    ${tab.id === 'pending' ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent'}`}>
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <p className="text-4xl mb-3">🔔</p>
            <p className="text-base font-semibold text-muted mb-1">
              {activeTab === 'pending' ? 'No pending actions' : 'All caught up!'}
            </p>
            <p className="text-xs text-dim">
              {activeTab === 'pending'
                ? 'Rejections and claims will appear here'
                : 'New activity will appear here in real time'}
            </p>
          </div>
        ) : (
          filtered.map(notif => (
            <NotifRow
              key={notif.id}
              notif={notif}
              onMarkRead={markRead}
              onNavigate={(path) => navigate(`/${path}`)}
              onIgnore={ignoreNotif}
            />
          ))
        )}
      </div>
    </div>
  )
}

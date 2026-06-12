import { useState, useEffect } from 'react'
import {
  collection, onSnapshot, updateDoc, doc, query, orderBy
} from 'firebase/firestore'
import { db }          from '../../utils/firebase'
import useAuthStore    from '../../stores/useAuthStore'

const RSVP_OPTIONS = [
  { key: 'going', icon: '✅', label: "I'll be there",  cls: 'border-ok/50 bg-ok-soft text-ok'          },
  { key: 'maybe', icon: '🤔', label: 'Maybe',          cls: 'border-warn/50 bg-warn-soft text-warn'     },
  { key: 'no',    icon: '❌', label: "Can't make it",  cls: 'border-danger/50 bg-danger-soft text-danger'},
]

function fmtDate(dateStr, timeStr) {
  if (!dateStr) return ''
  const d    = new Date(dateStr + 'T12:00:00')
  if (isNaN(d.getTime())) return ''
  const date = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  if (timeStr) {
    if (timeStr.includes('-') || timeStr.includes('–')) {
      const parts = timeStr.split(/[-–]/).map(p => p.trim())
      const formattedParts = parts.map(part => {
        if (!part.includes(':')) return part
        const [h, m] = part.split(':').map(Number)
        if (isNaN(h) || isNaN(m)) return part
        const period = h >= 12 ? 'PM' : 'AM'
        const h12    = ((h % 12) || 12)
        return `${h12}:${String(m).padStart(2,'0')} ${period}`
      })
      return `${date} at ${formattedParts.join(' – ')}`
    }
    
    if (timeStr.includes(':')) {
      const [h, m] = timeStr.split(':').map(Number)
      if (!isNaN(h) && !isNaN(m)) {
        const period = h >= 12 ? 'PM' : 'AM'
        const h12    = ((h % 12) || 12)
        return `${date} at ${h12}:${String(m).padStart(2,'0')} ${period}`
      }
    }
    return `${date} at ${timeStr}`
  }
  return date
}

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0)
  const d     = new Date(dateStr + 'T12:00:00')
  if (isNaN(d.getTime())) return null
  const diff  = Math.round((d - today) / 86400000)
  if (diff < 0)  return null
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  if (diff < 7)  return `In ${diff} days`
  return null
}

function EventCard({ event, userId }) {
  const [busy, setBusy] = useState(false)
  const myRsvp = event.rsvps?.[userId]
  const mapsUrl = event.location
    ? `https://maps.google.com/?q=${encodeURIComponent(event.location)}`
    : null
  const countdown = daysUntil(event.date)

  const handleRsvp = async (key) => {
    if (busy) return
    setBusy(true)
    try {
      await updateDoc(doc(db, 'events', event.id), {
        [`rsvps.${userId}`]: key === myRsvp ? null : key,  // toggle off if same
      })
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-card border border-app rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <h2 className="text-base font-bold text-primary leading-tight">{event.title}</h2>
          {countdown && (
            <span className="px-2 py-0.5 rounded-full bg-accent-soft text-accent text-xs font-bold flex-shrink-0">
              {countdown}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-muted">📅 {fmtDate(event.date, event.time)}</p>
          {event.location && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted truncate flex-1">📍 {event.location}</p>
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-accent font-bold no-underline flex-shrink-0 px-2 py-1 rounded-lg bg-accent-soft">
                  🗺️ Map
                </a>
              )}
            </div>
          )}
          {event.notes && (
            <p className="text-xs text-dim leading-relaxed mt-1">{event.notes}</p>
          )}
        </div>
      </div>

      {/* RSVP buttons */}
      <div className="border-t border-app px-4 py-3">
        <p className="text-xs font-semibold text-muted mb-2.5">
          {myRsvp ? 'Your response:' : 'Will you be there?'}
        </p>
        <div className="flex gap-2">
          {RSVP_OPTIONS.map(opt => {
            const isSelected = myRsvp === opt.key
            return (
              <button key={opt.key}
                disabled={busy}
                onClick={() => handleRsvp(opt.key)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 rounded-xl border-2 text-xs font-bold cursor-pointer transition-all disabled:opacity-50
                  ${isSelected ? opt.cls : 'border-app bg-transparent text-muted hover:border-app/70'}`}>
                <span className="text-base">{opt.icon}</span>
                <span className="leading-tight text-center">{opt.label}</span>
              </button>
            )
          })}
        </div>

        {/* RSVP counts */}
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-dim">
          {RSVP_OPTIONS.map(opt => {
            const count = Object.values(event.rsvps || {}).filter(v => v === opt.key).length
            return count > 0 ? (
              <span key={opt.key}>{opt.icon} {count}</span>
            ) : null
          })}
        </div>
      </div>
    </div>
  )
}

export default function EventsView() {
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)
  const { user } = useAuthStore()

  useEffect(() => {
    const q = query(collection(db, 'events'), orderBy('date', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const today    = new Date().toISOString().slice(0, 10)
  const upcoming = events.filter(e => e.date >= today)
  const past     = events.filter(e => e.date <  today)
  const uid      = user?.uid

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 flex flex-col gap-4">

        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">🗓️</p>
            <p className="text-base font-semibold text-muted">No events yet</p>
            <p className="text-xs text-dim mt-1">Your admin's meetings will appear here</p>
          </div>
        )}

        {upcoming.length > 0 && (
          <section>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Upcoming · {upcoming.length}</p>
            <div className="flex flex-col gap-3">
              {upcoming.map(e => <EventCard key={e.id} event={e} userId={uid} />)}
            </div>
          </section>
        )}

        {past.length > 0 && (
          <section className="opacity-60">
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3 mt-2">Past · {past.length}</p>
            <div className="flex flex-col gap-3">
              {past.slice().reverse().slice(0, 3).map(e => (
                <div key={e.id} className="bg-card border border-app rounded-2xl p-4">
                  <p className="text-sm font-bold text-primary">{e.title}</p>
                  <p className="text-xs text-dim mt-1">{fmtDate(e.date, e.time)}</p>
                  {e.rsvps?.[uid] && (
                    <p className="text-xs text-muted mt-1">
                      Your response: {RSVP_OPTIONS.find(o => o.key === e.rsvps[uid])?.label}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

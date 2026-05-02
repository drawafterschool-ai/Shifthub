import { useState, useEffect, useRef } from 'react'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import { db }              from '../../utils/firebase'
import useDirectoryStore   from '../../stores/useDirectoryStore'
import useAuthStore        from '../../stores/useAuthStore'
import Button              from '../../components/Button'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'

const RSVP_LABELS = {
  going:   { icon: '✅', label: 'Going',        cls: 'text-ok'     },
  maybe:   { icon: '🤔', label: 'Maybe',        cls: 'text-warn'   },
  no:      { icon: '❌', label: "Can't make it", cls: 'text-danger' },
}

const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

function fmtEventDate(dateStr, timeStr) {
  if (!dateStr) return ''
  const d = new Date(dateStr + 'T12:00:00')
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  return timeStr ? `${dateLabel} at ${timeStr}` : dateLabel
}

// ── Event form modal ──────────────────────────────────────────────────────────
function EventModal({ existing, onClose, onSave }) {
  const [title,    setTitle]    = useState(existing?.title    || '')
  const [date,     setDate]     = useState(existing?.date     || '')
  const [time,     setTime]     = useState(existing?.time     || '')
  const [location,   setLocation]   = useState(existing?.location || '')
  const [locSugs,    setLocSugs]    = useState([])
  const [showLocSug, setShowLocSug] = useState(false)
  const locTimer = useRef(null)
  const [notes,    setNotes]    = useState(existing?.notes    || '')
  const [busy,     setBusy]     = useState(false)

  const handleLocationChange = (e) => {
    const val = e.target.value
    setLocation(val)
    setShowLocSug(true)
    clearTimeout(locTimer.current)
    if (val.length < 3) { setLocSugs([]); return }
    locTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val)}&limit=5&countrycodes=us`)
        const data = await res.json()
        setLocSugs(data)
      } catch { setLocSugs([]) }
    }, 400)
  }

  const handleSave = async () => {
    if (!title.trim() || !date) return
    setBusy(true)
    await onSave({ title: title.trim(), date, time, location: location.trim(), notes: notes.trim() })
    setBusy(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} width="max-w-lg">
      <ModalHeader title={existing ? 'Edit event' : 'New event'} onClose={onClose} />
      <div className="flex flex-col gap-4">
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Title *</label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus className={INPUT} placeholder="e.g. Spring Teacher Meeting" />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Date *</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={INPUT} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className={INPUT} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Location</label>
          <div className="relative">
            <input value={location} onChange={handleLocationChange}
              onBlur={() => setTimeout(() => setShowLocSug(false), 200)}
              className={INPUT} placeholder="Address or Zoom link" autoComplete="off" />
            {showLocSug && locSugs.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-app rounded-xl shadow-xl overflow-hidden">
                {locSugs.map((s, i) => (
                  <div key={i} onClick={() => { setLocation(s.display_name); setShowLocSug(false) }}
                    className="px-3 py-2.5 text-sm text-primary cursor-pointer hover:bg-raised truncate border-b border-app/40 last:border-0">
                    📍 {s.display_name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Notes</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className={`${INPUT} resize-none`} placeholder="Optional details…" />
        </div>
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || !title.trim() || !date}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Create event'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ── Event card ────────────────────────────────────────────────────────────────
function EventCard({ event, instructors, onEdit, onDelete, onRemind }) {
  const [expanded, setExpanded] = useState(false)
  const rsvps = event.rsvps || {}

  const going = instructors.filter(i => rsvps[i.id] === 'going')
  const maybe = instructors.filter(i => rsvps[i.id] === 'maybe')
  const no    = instructors.filter(i => rsvps[i.id] === 'no')
  const noReply = instructors.filter(i => !rsvps[i.id])

  const isUpcoming = event.date >= new Date().toISOString().slice(0, 10)
  const mapsUrl    = event.location
    ? `https://maps.google.com/?q=${encodeURIComponent(event.location)}`
    : null

  return (
    <div className={`bg-card border rounded-2xl overflow-hidden ${isUpcoming ? 'border-accent/40' : 'border-app'}`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isUpcoming && <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />}
              <h3 className="text-base font-bold text-primary truncate">{event.title}</h3>
            </div>
            <p className="text-xs text-muted">📅 {fmtEventDate(event.date, event.time)}</p>
            {event.location && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-xs text-dim truncate">📍 {event.location}</p>
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noreferrer"
                    className="text-xs text-accent font-semibold no-underline flex-shrink-0">↗ Map</a>
                )}
              </div>
            )}
            {event.notes && <p className="text-xs text-dim mt-1 line-clamp-2">{event.notes}</p>}
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {noReply.length > 0 && (
              <Button small variant="ghost" onClick={() => onRemind(noReply)}>
                📢 Remind ({noReply.length})
              </Button>
            )}
            <Button small variant="ghost" onClick={onEdit}>✏️</Button>
            <button onClick={onDelete} className="text-dim hover:text-danger cursor-pointer bg-transparent border-none text-base">🗑</button>
          </div>
        </div>

        {/* RSVP summary */}
        <div className="flex items-center gap-3 py-2 border-t border-app">
          {[['going', going], ['maybe', maybe], ['no', no]].map(([status, list]) => (
            <div key={status} className="flex items-center gap-1.5">
              <span>{RSVP_LABELS[status].icon}</span>
              <span className={`text-sm font-bold ${RSVP_LABELS[status].cls}`}>{list.length}</span>
              <span className="text-xs text-dim hidden sm:inline">{RSVP_LABELS[status].label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-dim">{noReply.length} no reply</span>
            <button onClick={() => setExpanded(v => !v)}
              className="text-xs text-accent font-semibold cursor-pointer bg-transparent border-none ml-1">
              {expanded ? 'Hide' : 'Details'}
            </button>
          </div>
        </div>

        {/* Expanded RSVP list */}
        {expanded && (
          <div className="mt-3 flex flex-col gap-3">
            {[['going', going], ['maybe', maybe], ['no', no], ['No reply', noReply]].map(([label, list]) => (
              list.length > 0 && (
                <div key={String(label)}>
                  <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1.5">{label} · {list.length}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map(i => (
                      <span key={i.id} className="flex items-center gap-1 px-2 py-0.5 bg-raised border border-app rounded-full text-xs text-primary">
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
                          style={{ background: i.color || 'var(--accent)' }}>
                          {i.firstName[0]}
                        </span>
                        {i.firstName} {i.lastName}
                      </span>
                    ))}
                  </div>
                </div>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function EventsView() {
  const [events,   setEvents]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [compose,  setCompose]  = useState(null)
  const [deleting, setDeleting] = useState(null)

  const { instructors } = useDirectoryStore()
  const { userProfile } = useAuthStore()

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

  const handleSave = async (data) => {
    if (compose?.id) {
      await updateDoc(doc(db, 'events', compose.id), { ...data, updatedAt: serverTimestamp() })
    } else {
      await addDoc(collection(db, 'events'), {
        ...data,
        rsvps:       {},
        seenBy:      [],
        createdAt:   serverTimestamp(),
        authorName:  userProfile?.firstName || 'Admin',
      })
    }
  }

  const handleDelete = async (id) => { await deleteDoc(doc(db, 'events', id)); setDeleting(null) }

  const handleRemind = (teachers) => {
    alert(`Reminder sent to: ${teachers.map(t => t.firstName).join(', ')}`)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">

      <div className="px-6 py-4 bg-surface border-b border-app flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-lg">🗓️</div>
          <div>
            <h1 className="text-xl font-bold text-primary">Events</h1>
            <p className="text-xs text-dim">{upcoming.length} upcoming</p>
          </div>
        </div>
        <Button variant="primary" icon="+" onClick={() => setCompose({})}>New event</Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-5xl mb-4">🗓️</p>
            <p className="text-lg font-bold text-muted mb-1">No events yet</p>
            <p className="text-sm text-dim mb-5">Schedule your next team meeting</p>
            <Button variant="primary" onClick={() => setCompose({})}>Create first event</Button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-6">
            {upcoming.length > 0 && (
              <section>
                <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Upcoming · {upcoming.length}</p>
                <div className="flex flex-col gap-3">
                  {upcoming.map(e => (
                    <EventCard key={e.id} event={e} instructors={instructors}
                      onEdit={() => setCompose(e)}
                      onDelete={() => setDeleting(e.id)}
                      onRemind={handleRemind} />
                  ))}
                </div>
              </section>
            )}
            {past.length > 0 && (
              <section className="opacity-60">
                <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">Past · {past.length}</p>
                <div className="flex flex-col gap-3">
                  {past.slice().reverse().slice(0, 5).map(e => (
                    <EventCard key={e.id} event={e} instructors={instructors}
                      onEdit={() => setCompose(e)}
                      onDelete={() => setDeleting(e.id)}
                      onRemind={handleRemind} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {compose !== null && (
        <EventModal existing={compose?.id ? compose : null} onClose={() => setCompose(null)} onSave={handleSave} />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)} width="max-w-xs">
          <ModalHeader title="Delete event?" onClose={() => setDeleting(null)} />
          <p className="text-sm text-muted mb-5">This will remove the event and all RSVPs.</p>
          <ModalFooter>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <button onClick={() => handleDelete(deleting)}
              className="px-4 py-1.5 bg-danger text-white text-sm font-semibold rounded-lg cursor-pointer border-none">Delete</button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}

import { useState } from 'react'
import useScheduleStore  from '../../stores/useScheduleStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import useSettingsStore  from '../../stores/useSettingsStore'
import { toKey, addDays, fmtDateLong } from '../../utils/date'
import { isToday } from '../../utils/date'

function fmtShortDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function MobileDayView() {
  const { rawShifts, jobs, loading } = useScheduleStore()
  const { instructors }              = useDirectoryStore()
  const [offset, setOffset]          = useState(0)

  const base = new Date(); base.setHours(0,0,0,0)
  const day  = addDays(base, offset)
  const dk   = toKey(day)
  const isT  = isToday(day)

  const dayShifts = rawShifts
    .filter(s => s.date === dk && s.status !== 'cancelled')
    .sort((a, b) => (a.start || '').localeCompare(b.start || ''))

  const getInstructor = id => instructors.find(i => String(i.id) === String(id))
  const getJob        = id => jobs?.find(j => j.id === id)

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-app overflow-hidden">

      {/* Day navigator */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-app flex-shrink-0">
        <button onClick={() => setOffset(o => o - 1)}
          className="w-9 h-9 rounded-xl bg-raised border border-app flex items-center justify-center text-muted cursor-pointer text-lg">‹</button>
        <div className="text-center">
          <p className={`text-sm font-bold ${isT ? 'text-accent' : 'text-primary'}`}>
            {isT ? 'Today' : fmtShortDate(day)}
          </p>
          {!isT && <p className="text-xs text-dim">{day.toLocaleDateString('en-US', { year: 'numeric' })}</p>}
        </div>
        <button onClick={() => setOffset(o => o + 1)}
          className="w-9 h-9 rounded-xl bg-raised border border-app flex items-center justify-center text-muted cursor-pointer text-lg">›</button>
      </div>

      {/* Shifts list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {dayShifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-4xl mb-3">📅</p>
            <p className="text-sm font-semibold text-muted">No shifts {isT ? 'today' : 'this day'}</p>
            <button onClick={() => setOffset(0)} className="mt-3 text-xs text-accent cursor-pointer bg-transparent border-none font-semibold">
              Back to today
            </button>
          </div>
        ) : dayShifts.map(s => {
          const inst = s.instructorId ? getInstructor(s.instructorId) : null
          const job  = getJob(s.job)
          const statusColor = { confirmed: '#34D399', rejected: '#F87171', pending: '#FBBF24' }[s.confirmationStatus]

          return (
            <div key={s.id} className="bg-card border border-app rounded-2xl p-4"
              style={ job?.color ? { borderLeftColor: job.color, borderLeftWidth: 3 } : {} }>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-primary truncate">{s.title || 'Shift'}</p>
                  {job?.title && (
                    <p className="text-xs font-semibold" style={{ color: job.color || 'var(--muted)' }}>{job.title}</p>
                  )}
                </div>
                {statusColor && (
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1" style={{ background: statusColor }} />
                )}
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-xs text-muted font-mono">🕐 {s.start} – {s.end}</p>
                {s.students && <p className="text-xs text-dim">👥 {s.students} students</p>}
                {s.address   && <p className="text-xs text-dim truncate">📍 {s.address}</p>}
                {inst ? (
                  <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-app/50">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ background: inst.color || 'var(--accent)' }}>
                      {inst.firstName?.[0]}{inst.lastName?.[0]}
                    </div>
                    <p className="text-xs font-semibold text-muted">{inst.firstName} {inst.lastName}</p>
                    {s.confirmationStatus === 'pending' && (
                      <span className="ml-auto text-xs text-warn font-semibold">Pending</span>
                    )}
                    {s.confirmationStatus === 'rejected' && (
                      <span className="ml-auto text-xs text-danger font-semibold">Rejected</span>
                    )}
                    {s.confirmationStatus === 'confirmed' && (
                      <span className="ml-auto text-xs text-ok font-semibold">Confirmed</span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-warn font-semibold mt-1">⚠️ Unassigned</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

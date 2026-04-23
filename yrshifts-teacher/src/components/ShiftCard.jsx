import { useState } from 'react'

const STATUS_DOT   = { confirmed: '#34D399', rejected: '#F87171', pending: '#FBBF24' }
const STATUS_LABEL = {
  confirmed: { text: '✅ Confirmed',              cls: 'bg-ok-soft border-ok/30 text-ok'       },
  rejected:  { text: '❌ Rejected',               cls: 'bg-danger-soft border-danger/30 text-danger' },
  pending:   { text: '🔔 Awaiting your response', cls: 'bg-warn-soft border-warn/30 text-warn'  },
}

function ShiftDetailModal({ shift, onClose }) {
  const d = shift.date
    ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
    : ''

  const status = STATUS_LABEL[shift.confirmationStatus]

  return (
    <div className="fixed inset-0 z-[999] flex flex-col justify-end bg-black/60"
      onClick={onClose}>
      <div className="bg-surface rounded-t-3xl overflow-hidden animate-slide-up"
        onClick={e => e.stopPropagation()}>

        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-raised" />
        </div>

        {/* Header */}
        <div className="px-5 py-3 border-b border-app flex items-center justify-between">
          <h2 className="text-base font-bold text-primary">{shift.title || 'Shift'}</h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-full bg-raised flex items-center justify-center text-muted cursor-pointer border-none text-base">
            ×
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">

          {/* Status badge */}
          {status && (
            <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-semibold ${status.cls}`}>
              {status.text}
            </div>
          )}

          {/* Key info */}
          <div className="flex flex-col gap-3">
            <Row icon="📅" label="Date"    value={d} />
            <Row icon="🕐" label="Time"    value={`${shift.start} – ${shift.end}`} mono />
            {shift.students && <Row icon="👥" label="Students" value={`${shift.students} students`} />}
            {shift.job      && <Row icon="💼" label="Type"     value={shift.job} />}
            {shift.address  && <Row icon="📍" label="Location" value={shift.address} />}
            {shift.note     && <Row icon="📝" label="Note"     value={shift.note} />}
          </div>

          {/* Map link */}
          {shift.address && (
            <a href={`https://maps.google.com/?q=${encodeURIComponent(shift.address)}`}
              target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-app bg-raised text-sm font-semibold text-primary no-underline">
              🗺️ Open in Maps
            </a>
          )}

          {/* Attachments */}
          {shift.attachments?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">📎 Attachments</p>
              <div className="flex flex-col gap-2">
                {shift.attachments.map((a, i) => (
                  <a key={a.id || i} href={a.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-raised border border-app no-underline">
                    <span className="text-xl flex-shrink-0">
                      {a.type?.startsWith('image/') ? '🖼️' :
                       a.type?.includes('pdf')      ? '📋' : '📄'}
                    </span>
                    <span className="text-sm font-semibold text-primary truncate flex-1">{a.name || 'Attachment'}</span>
                    <span className="text-xs text-accent font-semibold flex-shrink-0">Open ↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Safe area */}
        <div className="safe-bottom" />
      </div>
    </div>
  )
}

function Row({ icon, label, value, mono }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-lg flex-shrink-0 w-6 text-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-dim uppercase tracking-wide font-semibold mb-0.5">{label}</p>
        <p className={`text-sm text-primary leading-snug ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  )
}

export default function ShiftCard({ shift, children }) {
  const [showDetail, setShowDetail] = useState(false)
  const dot   = STATUS_DOT[shift.confirmationStatus]
  const label = STATUS_LABEL[shift.confirmationStatus]

  const d = shift.date
    ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      })
    : ''

  return (
    <>
      <div
        className="bg-card border border-app rounded-2xl overflow-hidden active:scale-[0.99] transition-transform cursor-pointer"
        onClick={() => setShowDetail(true)}
      >
        <div className="flex gap-3 p-4">
          {/* Date box */}
          <div className="w-12 h-12 rounded-xl bg-raised border border-app flex flex-col items-center justify-center flex-shrink-0">
            <span className="text-[10px] font-bold text-muted uppercase leading-none">{d.split(',')[0]}</span>
            <span className="text-xl font-bold text-primary leading-tight">
              {shift.date ? new Date(shift.date + 'T12:00:00').getDate() : '?'}
            </span>
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {dot && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />}
              <p className="text-sm font-bold text-primary truncate">{shift.title || 'Shift'}</p>
            </div>
            <p className="text-xs text-muted font-mono">{shift.start} – {shift.end}</p>
            {shift.students && <p className="text-xs text-dim mt-0.5">👥 {shift.students} students</p>}
            {shift.address  && <p className="text-xs text-dim mt-0.5 truncate">📍 {shift.address}</p>}
            {label && (
              <p className={`text-xs font-semibold mt-1.5 ${label.cls.split(' ').find(c => c.startsWith('text-'))}`}>
                {label.text}
              </p>
            )}
          </div>

          {/* Tap hint */}
          <span className="text-dim text-sm self-center flex-shrink-0">›</span>
        </div>

        {/* Action slot */}
        {children && (
          <div className="px-4 pb-4" onClick={e => e.stopPropagation()}>
            {children}
          </div>
        )}
      </div>

      {showDetail && (
        <ShiftDetailModal shift={shift} onClose={() => setShowDetail(false)} />
      )}
    </>
  )
}

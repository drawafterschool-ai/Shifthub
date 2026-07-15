// ── Admin mobile shift detail (read-only) ─────────────────────────
// Mirrors the teacher ShiftDetailModal structure so field rendering is
// consistent between both apps. Opens ShiftPanel on "Edit →" tap.
export default function AdminShiftDetailSheet({ shift, jobs, instructors, onClose, onEdit }) {
  const j    = jobs?.find(jb => jb.id === shift.job)
  const inst = instructors?.find(i => String(i.id) === String(shift.instructorId))
  const d    = shift.date
    ? new Date(shift.date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'short', day: 'numeric', year: 'numeric',
      })
    : ''

  const Row = ({ icon, label, value, mono }) => (
    <div className="flex items-start gap-3">
      <span className="text-base flex-shrink-0 w-5 text-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-2xs text-dim uppercase tracking-wide font-semibold mb-0.5">{label}</p>
        <p className={`text-sm text-primary leading-snug ${mono ? 'font-mono' : ''}`}>{value}</p>
      </div>
    </div>
  )

  const mapsUrl = shift.address
    ? `https://maps.google.com/?q=${encodeURIComponent(shift.address)}`
    : null

  return (
    <div className="fixed inset-0 z-[3500] flex flex-col justify-end bg-black/60 md:hidden"
      onClick={onClose}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col"
        style={{ background: 'var(--dropdown-bg)', backdropFilter: 'none', WebkitBackdropFilter: 'none' }}
        onClick={e => e.stopPropagation()}>

        {/* Handle */}
        <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0">
          <div className="w-8 h-1 rounded-full bg-raised" />
        </div>

        {/* Header */}
        <div className="px-4 py-2.5 border-b border-app flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {j?.color && (
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: j.color }} />
            )}
            <h2 className="text-sm font-bold text-primary truncate">{shift.title || 'Shift'}</h2>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-2">
            <button onClick={onEdit}
              className="px-3 py-1 rounded-lg bg-accent text-white text-xs font-bold border-none cursor-pointer">
              Edit →
            </button>
            <button onClick={onClose}
              className="w-6 h-6 rounded-full bg-raised flex items-center justify-center text-muted cursor-pointer border-none text-sm">
              ×
            </button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="px-4 py-4 flex flex-col gap-3 overflow-y-auto flex-1 min-h-0">

          <div className="flex flex-col gap-3">
            <Row icon="📅" label="Date"        value={d} />
            <Row icon="🕐" label="Time"        value={`${shift.start} – ${shift.end}`} mono />
            {inst && (
              <Row icon="👤" label="Instructor"
                value={`${inst.firstName || ''} ${inst.lastName || ''}`.trim() || 'Unassigned'} />
            )}
            {!inst && shift.claimable && (
              <Row icon="⚡" label="Instructor" value="Open shift — claimable" />
            )}
            {shift.students && <Row icon="👥" label="Students"  value={`${shift.students} students`} />}
            {j?.name        && <Row icon="💼" label="Job Type"  value={j.name} />}
            {shift.address  && <Row icon="📍" label="Location"  value={shift.address} />}
            {shift.note     && <Row icon="📝" label="Note"      value={shift.note} />}
            {shift.doorCode && <Row icon="🔑" label="Door Code" value={shift.doorCode} mono />}
          </div>

          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-app bg-raised text-xs font-semibold text-primary no-underline">
              🗺️ Open in Maps
            </a>
          )}

          {shift.attachments?.length > 0 && (
            <div>
              <p className="text-2xs font-bold text-muted uppercase tracking-wide mb-1.5">
                📎 Attachments
              </p>
              <div className="flex flex-col gap-1.5">
                {shift.attachments.map((att, i) => (
                  <a key={att.id || i} href={att.url} target="_blank" rel="noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-raised border border-app no-underline">
                    <span className="text-base flex-shrink-0">
                      {att.type?.startsWith('image/') ? '🖼️' : att.type?.includes('pdf') ? '📋' : '📄'}
                    </span>
                    <span className="text-xs font-semibold text-primary truncate flex-1">
                      {att.name || 'Attachment'}
                    </span>
                    <span className="text-2xs text-accent font-semibold flex-shrink-0">Open ↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Safe-area spacer */}
        <div style={{ height: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }} />
      </div>
    </div>
  )
}

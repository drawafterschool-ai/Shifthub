import { useState } from 'react'
import useTeacherStore from '../../stores/useTeacherStore'
import useAuthStore    from '../../stores/useAuthStore'
import ShiftCard       from '../../components/ShiftCard'

function NoteModal({ title, subtitle, placeholder, confirmLabel, confirmCls, onConfirm, onCancel }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const handleSubmit = async () => { setBusy(true); await onConfirm(note.trim()); setBusy(false) }
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 px-4 pb-8" onClick={onCancel}>
      <div className="w-full max-w-md bg-surface rounded-3xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-2"><div className="w-10 h-1 rounded-full bg-raised" /></div>
        <div className="px-5 pb-6 flex flex-col gap-4">
          <div><p className="text-base font-bold text-primary mb-0.5">{title}</p><p className="text-xs text-muted">{subtitle}</p></div>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={placeholder} rows={3} autoFocus
            className="w-full bg-raised border border-app rounded-xl px-3.5 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent resize-none" />
          <div className="flex gap-2">
            <button onClick={onCancel} disabled={busy} className="flex-1 py-3 rounded-xl border border-app text-sm font-semibold text-muted cursor-pointer bg-transparent disabled:opacity-50">Cancel</button>
            <button onClick={handleSubmit} disabled={busy} className={`flex-1 py-3 rounded-xl text-white text-sm font-bold cursor-pointer border-none disabled:opacity-50 ${confirmCls}`}>{busy ? 'Sending…' : confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Stat card matching the screenshot aesthetic ────────────────────────────────
function StatCard({ icon, label, value, sub, accent, progress }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      border: `1px solid ${accent}40`,
      borderRadius: 20,
      padding: '16px 18px',
      boxShadow: `0 0 20px ${accent}15, inset 0 1px 0 rgba(255,255,255,0.08)`,
      flex: 1,
      minWidth: 0,
    }}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: accent }}>{label}</p>
          <p className="text-2xl font-black text-white leading-none">{value}</p>
        </div>
        <span style={{ fontSize: 22 }}>{icon}</span>
      </div>
      {progress !== undefined && (
        <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden', marginTop: 10 }}>
          <div style={{ width: `${Math.min(progress * 100, 100)}%`, height: '100%', background: `linear-gradient(90deg, ${accent}, ${accent}cc)`, borderRadius: 99, transition: 'width 0.6s ease' }} />
        </div>
      )}
      {sub && <p className="text-xs mt-1.5" style={{ color: `${accent}99` }}>{sub}</p>}
    </div>
  )
}

// ── Shift row with the premium card look ──────────────────────────────────────
function ShiftRow({ shift, onConfirm, onReject, onRelease, busyState }) {
  const isToday   = shift.date === new Date().toISOString().slice(0,10)
  const isPending = shift.confirmationStatus === 'pending' || (!shift.confirmationStatus && shift.instructorId)
  const isConfirmed = shift.confirmationStatus === 'confirmed'
  const isBusy    = !!busyState

  const borderColor = isPending ? '#FBBF24' : isConfirmed ? '#34D399' : '#4EA8D6'
  const glowColor   = isPending ? '#FBBF2420' : isConfirmed ? '#34D39920' : '#4EA8D620'

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
      border: `1px solid ${borderColor}50`,
      borderRadius: 20,
      overflow: 'hidden',
      boxShadow: `0 4px 24px ${glowColor}, inset 0 1px 0 rgba(255,255,255,0.06)`,
    }}>
      {/* Top accent bar */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${borderColor}cc, transparent)` }} />

      <ShiftCard shift={shift}>

        {/* Pending confirm/reject */}
        {isPending && !isBusy && (
          <div style={{
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.2)',
            borderRadius: 14,
            padding: '12px 14px',
          }}>
            <p className="text-xs font-semibold mb-2.5" style={{ color: '#FBBF24' }}>
              ⚡ Action required — confirm or reject
            </p>
            <div className="flex gap-2">
              <button onClick={onConfirm} style={{
                flex: 1, padding: '9px 0', borderRadius: 12,
                background: 'linear-gradient(135deg, #34D399, #10B981)',
                color: 'white', fontWeight: 700, fontSize: 13,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(52,211,153,0.3)',
              }}>✓ Confirm</button>
              <button onClick={onReject} style={{
                flex: 1, padding: '9px 0', borderRadius: 12,
                background: 'transparent',
                color: '#F87171', fontWeight: 700, fontSize: 13,
                border: '1px solid rgba(248,113,113,0.4)', cursor: 'pointer',
              }}>✕ Reject</button>
            </div>
          </div>
        )}

        {/* Confirmed — release option */}
        {isConfirmed && !isBusy && (
          <button onClick={onRelease} style={{
            width: '100%', padding: '9px 0', borderRadius: 12,
            background: 'transparent',
            color: '#FBBF24', fontWeight: 600, fontSize: 12,
            border: '1px solid rgba(251,191,36,0.3)', cursor: 'pointer',
          }}>🙋 Can't teach this shift</button>
        )}

        {/* Busy */}
        {isBusy && (
          <div className="flex items-center justify-center py-3 gap-2">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#4EA8D6', borderTopColor: 'transparent' }} />
            <span className="text-xs text-muted">{{ confirming: 'Confirming…', reject: 'Rejecting…', release: 'Releasing…' }[busyState] || 'Working…'}</span>
          </div>
        )}
      </ShiftCard>
    </div>
  )
}

export default function ScheduleView() {
  const { myShifts, confirmShift, rejectShift, releaseShift, loading } = useTeacherStore()
  const { user, userProfile } = useAuthStore()

  const [busy,      setBusy]      = useState({})
  const [toast,     setToast]     = useState(null)
  const [noteModal, setNoteModal] = useState(null)

  const today    = new Date().toISOString().slice(0, 10)
  const upcoming = myShifts.filter(s => s.date >= today)
  const past     = myShifts.filter(s => s.date < today)
  const pending  = upcoming.filter(s => s.confirmationStatus === 'pending' || (!s.confirmationStatus && s.instructorId))
  const confirmed = upcoming.filter(s => s.confirmationStatus === 'confirmed')
  const uid = user?.uid

  const showToast = (msg, type = 'ok') => { setToast({ msg, type }); setTimeout(() => setToast(null), 2800) }

  const handleConfirm = async (shift) => {
    setBusy(b => ({ ...b, [shift.id]: 'confirming' }))
    try { await confirmShift(shift, uid, userProfile?.firstName); showToast('✅ Shift confirmed!') }
    catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
  }

  const handleNoteSubmit = async (note) => {
    if (!noteModal) return
    const { shift, flow } = noteModal
    setNoteModal(null)
    setBusy(b => ({ ...b, [shift.id]: flow }))
    try {
      if (flow === 'reject') { await rejectShift(shift, uid, userProfile?.firstName); showToast('Shift rejected — admin notified', 'warn') }
      else if (flow === 'release') { await releaseShift(shift, uid, userProfile?.firstName, note); showToast('Shift released — admin notified', 'warn') }
    } catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
  }

  const NOTE_CONFIG = {
    reject:  { title: 'Reject this shift?',   subtitle: 'Let your admin know why (optional)', placeholder: 'Reason for rejecting…',              confirmLabel: 'Reject shift',  confirmCls: 'bg-danger'     },
    release: { title: "Can't teach this shift?", subtitle: 'Please explain so your admin can reassign it', placeholder: "Reason you can't teach this shift…", confirmLabel: 'Release shift', confirmCls: 'bg-amber-500' },
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#4EA8D6', borderTopColor: 'transparent' }} />
    </div>
  )

  const toastColor = toast?.type === 'error' ? '#F87171' : toast?.type === 'warn' ? '#FBBF24' : '#34D399'

  return (
    <div className="h-full overflow-y-auto relative" style={{ background: 'var(--bg)' }}>
      <div className="px-4 pt-4 pb-6 flex flex-col gap-4">

        {/* ── Stats row ── */}
        {(upcoming.length > 0 || past.length > 0) && (
          <div className="flex gap-2.5">
            <StatCard icon="📅" label="Upcoming" value={upcoming.length} accent="#4EA8D6"
              sub={`${confirmed.length} confirmed`}
              progress={upcoming.length ? confirmed.length / upcoming.length : 0} />
            <StatCard icon="⚡" label="Pending" value={pending.length} accent="#FBBF24"
              sub={pending.length > 0 ? 'Action needed' : 'All clear'}
              progress={upcoming.length ? (upcoming.length - pending.length) / upcoming.length : 1} />
          </div>
        )}

        {/* Empty state */}
        {upcoming.length === 0 && past.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div style={{ fontSize: 48, marginBottom: 12 }}>📅</div>
            <p className="text-base font-semibold text-muted">No shifts yet</p>
            <p className="text-xs text-dim mt-1">Your upcoming shifts will appear here</p>
          </div>
        )}

        {/* ── Upcoming ── */}
        {upcoming.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <div style={{ width: 3, height: 14, background: '#4EA8D6', borderRadius: 99 }} />
              <p className="text-xs font-bold uppercase tracking-widest" style={{ color: '#4EA8D6' }}>
                Upcoming · {upcoming.length}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {upcoming.map(s => (
                <ShiftRow key={s.id} shift={s}
                  onConfirm={() => handleConfirm(s)}
                  onReject={() => setNoteModal({ shift: s, flow: 'reject' })}
                  onRelease={() => setNoteModal({ shift: s, flow: 'release' })}
                  busyState={busy[s.id]} />
              ))}
            </div>
          </section>
        )}

        {/* ── Past ── */}
        {past.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-3 mt-1">
              <div style={{ width: 3, height: 14, background: '#4a5168', borderRadius: 99 }} />
              <p className="text-xs font-bold uppercase tracking-widest text-dim">Past · {past.length}</p>
            </div>
            <div className="flex flex-col gap-2.5" style={{ opacity: 0.5 }}>
              {past.slice(0, 5).map(s => <ShiftCard key={s.id} shift={s} />)}
              {past.length > 5 && <p className="text-xs text-dim text-center py-2">+{past.length - 5} older shifts</p>}
            </div>
          </section>
        )}
      </div>

      {/* Note modal */}
      {noteModal && <NoteModal {...NOTE_CONFIG[noteModal.flow]} onConfirm={handleNoteSubmit} onCancel={() => setNoteModal(null)} />}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 112, left: '50%', transform: 'translateX(-50%)',
          background: toastColor, color: 'white', borderRadius: 12, padding: '10px 18px',
          fontSize: 13, fontWeight: 600, boxShadow: `0 4px 20px ${toastColor}50`,
          zIndex: 50, whiteSpace: 'nowrap',
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

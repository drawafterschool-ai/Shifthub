import { useState } from 'react'
import useTeacherStore from '../../stores/useTeacherStore'
import useAuthStore    from '../../stores/useAuthStore'
import ShiftCard       from '../../components/ShiftCard'

// ── Note modal — used for both Reject and Release flows ───────────────────────
function NoteModal({ title, subtitle, placeholder, confirmLabel, confirmCls, onConfirm, onCancel }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async () => {
    setBusy(true)
    await onConfirm(note.trim())
    setBusy(false)
  }

  return (
    <div className="absolute inset-0 z-[1000] flex items-end justify-center bg-black/60 px-4 pb-8"
      onClick={onCancel}>
      <div className="w-full max-w-md bg-surface rounded-3xl overflow-hidden animate-slide-up"
        onClick={e => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="w-10 h-1 rounded-full bg-raised" />
        </div>
        <div className="px-5 pb-6 flex flex-col gap-4">
          <div>
            <p className="text-base font-bold text-primary mb-0.5">{title}</p>
            <p className="text-xs text-muted">{subtitle}</p>
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={placeholder}
            rows={3}
            autoFocus
            className="w-full bg-raised border border-app rounded-xl px-3.5 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent resize-none"
          />
          <div className="flex gap-2">
            <button onClick={onCancel} disabled={busy}
              className="flex-1 py-3 rounded-xl border border-app text-sm font-semibold text-muted cursor-pointer bg-transparent disabled:opacity-50">
              Cancel
            </button>
            <button onClick={handleSubmit} disabled={busy}
              className={`flex-1 py-3 rounded-xl text-white text-sm font-bold cursor-pointer border-none disabled:opacity-50 ${confirmCls}`}>
              {busy ? 'Sending…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ScheduleView() {
  const {
    myShifts,
    confirmShift, rejectShift,
    releaseShift,
    loading,
  } = useTeacherStore()
  const { user, userProfile } = useAuthStore()

  const [busy,       setBusy]       = useState({})
  const [toast,      setToast]      = useState(null)
  const [noteModal,  setNoteModal]  = useState(null)  // { shift, flow: 'reject'|'release' }

  const today    = new Date().toISOString().slice(0, 10)
  const maxDate  = new Date(Date.now() + 8 * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const upcoming = myShifts.filter(s => s.date >= today && s.date <= maxDate)
  const past     = myShifts.filter(s => s.date < today)

  const uid = user?.uid

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2800)
  }

  const handleConfirm = async (shift) => {
    setBusy(b => ({ ...b, [shift.id]: 'confirming' }))
    try {
      await confirmShift(shift, uid, userProfile?.firstName)
      showToast('✅ Shift confirmed!')
    } catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
  }

  // Reject assigned shift — requires note
  const handleReject = (shift) => setNoteModal({ shift, flow: 'reject' })

  // Release assigned shift — requires note
  const handleRelease = (shift) => setNoteModal({ shift, flow: 'release' })

  const handleNoteSubmit = async (note) => {
    if (!noteModal) return
    const { shift, flow } = noteModal
    setNoteModal(null)
    setBusy(b => ({ ...b, [shift.id]: flow }))
    try {
      if (flow === 'reject') {
        await rejectShift(shift, uid, userProfile?.firstName)
        showToast('Shift rejected — admin notified', 'warn')
      } else if (flow === 'release') {
        await releaseShift(shift, uid, userProfile?.firstName, note)
        showToast('Shift released — admin notified', 'warn')
      }
    } catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
  }

  const NOTE_CONFIG = {
    reject: {
      title: 'Reject this shift?',
      subtitle: 'Let your admin know why (optional)',
      placeholder: 'Reason for rejecting…',
      confirmLabel: 'Reject shift',
      confirmCls: 'bg-danger',
    },
    release: {
      title: "Can't teach this shift?",
      subtitle: 'Please explain so your admin can reassign it',
      placeholder: "Reason you can't teach this shift… (required)",
      confirmLabel: 'Release shift',
      confirmCls: 'bg-amber-500',
    },

  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  const toastColor = toast?.type === 'error' ? 'bg-danger' :
                     toast?.type === 'warn'  ? 'bg-amber-500' : 'bg-ok'

  return (
    <div className="h-full overflow-y-auto relative">
      <div className="px-4 py-4 flex flex-col gap-4">

        {upcoming.length === 0 && past.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">📅</p>
            <p className="text-base font-semibold text-muted">No shifts yet</p>
            <p className="text-xs text-dim mt-1">Your upcoming shifts will appear here</p>
          </div>
        )}

        {/* ── Upcoming assigned shifts ── */}
        {upcoming.length > 0 && (
          <section>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
              Upcoming (Next 8 Weeks) · {upcoming.length}
            </p>
            <div className="flex flex-col gap-3">
              {upcoming.map(s => (
                <ShiftCard key={s.id} shift={s}>

                  {/* Pending — confirm or reject */}
                  {(s.confirmationStatus === 'pending' || (!s.confirmationStatus && s.instructorId)) && !busy[s.id] && (
                    <div className="bg-warn-soft border border-warn/20 rounded-xl p-3 flex flex-col gap-2.5">
                      <p className="text-xs font-semibold text-warn">Please confirm or reject this shift</p>
                      <div className="flex gap-2">
                        <button onClick={() => handleConfirm(s)}
                          className="flex-1 py-2 rounded-xl bg-ok text-white text-sm font-bold cursor-pointer border-none">
                          ✓ Confirm
                        </button>
                        <button onClick={() => handleReject(s)}
                          className="flex-1 py-2 rounded-xl border border-danger bg-transparent text-danger text-sm font-bold cursor-pointer">
                          ✕ Reject
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Confirmed — allow release */}
                  {s.confirmationStatus === 'confirmed' && !busy[s.id] && (
                    <button onClick={() => handleRelease(s)}
                      className="w-full py-2 rounded-xl border border-amber-500/40 text-amber-500 text-xs font-semibold cursor-pointer bg-transparent">
                      🙋 Can't teach this shift
                    </button>
                  )}

                  {/* Busy spinner */}
                  {busy[s.id] && (
                    <div className="flex items-center justify-center py-3 gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                      <span className="text-xs text-muted">
                        {{ confirming: 'Confirming…', reject: 'Rejecting…', release: 'Releasing…' }[busy[s.id]] || 'Working…'}
                      </span>
                    </div>
                  )}
                </ShiftCard>
              ))}
            </div>
          </section>
        )}

        {/* ── Past shifts ── */}
        {past.length > 0 && (
          <section>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3 mt-2">
              Past · {past.length}
            </p>
            <div className="flex flex-col gap-2.5 opacity-60">
              {past.slice(0, 5).map(s => <ShiftCard key={s.id} shift={s} />)}
              {past.length > 5 && (
                <p className="text-xs text-dim text-center py-2">+{past.length - 5} older shifts</p>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Note modal */}
      {noteModal && (
        <NoteModal
          {...NOTE_CONFIG[noteModal.flow]}
          onConfirm={handleNoteSubmit}
          onCancel={() => setNoteModal(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-28 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold shadow-xl z-50 whitespace-nowrap ${toastColor}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

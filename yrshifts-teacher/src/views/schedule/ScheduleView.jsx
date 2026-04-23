import { useState } from 'react'
import useTeacherStore from '../../stores/useTeacherStore'
import useAuthStore    from '../../stores/useAuthStore'
import ShiftCard       from '../../components/ShiftCard'

export default function ScheduleView() {
  const { myShifts, confirmShift, rejectShift, loading } = useTeacherStore()
  const { user, userProfile } = useAuthStore()
  const [busy,  setBusy]  = useState({})
  const [toast, setToast] = useState(null)   // { msg, type }

  const today    = new Date().toISOString().slice(0, 10)
  const upcoming = myShifts.filter(s => s.date >= today)
  const past     = myShifts.filter(s => s.date <  today)

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 2500)
  }

  const handleConfirm = async (shift) => {
    setBusy(b => ({ ...b, [shift.id]: 'confirming' }))
    try {
      await confirmShift(shift, user.uid, userProfile?.firstName)
      showToast('✅ Shift confirmed!')
    } catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
  }

  const handleReject = async (shift) => {
    setBusy(b => ({ ...b, [shift.id]: 'rejecting' }))
    try {
      await rejectShift(shift, user.uid, userProfile?.firstName)
      showToast('Shift rejected — your admin has been notified', 'warn')
    } catch { showToast('Something went wrong', 'error') }
    finally { setBusy(b => ({ ...b, [shift.id]: null })) }
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

        {upcoming.length > 0 && (
          <section>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-3">
              Upcoming · {upcoming.length}
            </p>
            <div className="flex flex-col gap-3">
              {upcoming.map(s => (
                <ShiftCard key={s.id} shift={s}>
                  {/* Pending — show confirm/reject. Also show for undefined (assigned but not yet prompted) */}
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

                  {/* Loading state */}
                  {busy[s.id] && (
                    <div className="flex items-center justify-center py-3 gap-2">
                      <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                      <span className="text-xs text-muted">
                        {busy[s.id] === 'confirming' ? 'Confirming…' : 'Rejecting…'}
                      </span>
                    </div>
                  )}
                </ShiftCard>
              ))}
            </div>
          </section>
        )}

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

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold shadow-xl z-50 whitespace-nowrap ${toastColor}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import useTeacherStore from '../../stores/useTeacherStore'
import useAuthStore    from '../../stores/useAuthStore'
import ShiftCard       from '../../components/ShiftCard'

export default function OpenView() {
  const { openShifts, claimShift } = useTeacherStore()
  const { user, userProfile }      = useAuthStore()
  const [busy,    setBusy]    = useState({})
  const [claimed, setClaimed] = useState(new Set())

  const handleClaim = async (shift) => {
    setBusy(b => ({ ...b, [shift.id]: true }))
    try {
      await claimShift(shift, user.uid, userProfile?.firstName || 'Teacher')
      setClaimed(c => new Set([...c, shift.id]))
    } finally { setBusy(b => ({ ...b, [shift.id]: false })) }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 flex flex-col gap-3">
        {openShifts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">⚡</p>
            <p className="text-base font-semibold text-muted">No open shifts right now</p>
            <p className="text-xs text-dim mt-1">Available shifts will appear here</p>
          </div>
        ) : (
          <>
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-1">
              {openShifts.length} available
            </p>
            {openShifts.map(s => {
              const isClaimed = claimed.has(s.id)
              return (
                <ShiftCard key={s.id} shift={{ ...s, confirmationStatus: undefined }}>
                  {isClaimed ? (
                    <div className="py-2.5 rounded-xl bg-ok-soft border border-ok/20 text-center text-sm font-bold text-ok">
                      ✅ You claimed this shift
                    </div>
                  ) : (
                    <button disabled={busy[s.id]} onClick={() => handleClaim(s)}
                      className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-bold cursor-pointer border-none hover:opacity-90 disabled:opacity-50 transition-opacity">
                      {busy[s.id] ? 'Claiming…' : '⚡ Claim this shift'}
                    </button>
                  )}
                </ShiftCard>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

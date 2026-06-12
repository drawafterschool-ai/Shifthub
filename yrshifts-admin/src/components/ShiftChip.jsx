import { useState, useRef, useEffect } from 'react'
import useScheduleStore from '../stores/useScheduleStore'
import useDirectoryStore from '../stores/useDirectoryStore'
import { timeTo24 } from '../utils/time'

// Convert hex to rgba
function hexToRgba(hex, alpha) {
  const h = (hex || '#888888').replace('#', '')
  const r = parseInt(h.slice(0,2), 16)
  const g = parseInt(h.slice(2,4), 16)
  const b = parseInt(h.slice(4,6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

const STATUS_DOT = { confirmed: '#34D399', rejected: '#F87171', pending: '#FBBF24' }

export default function ShiftChip({
  shift, jobs, isUnassigned,
  onClick, onDragStart, onDragEnd,
  onDuplicate, onMultiDup, onUnassign, onDeleteShift,
}) {
  const [hover,      setHover]      = useState(false)
  const [menuOpen,   setMenuOpen]   = useState(false)
  const [multiOpen,  setMultiOpen]  = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [menuUp,     setMenuUp]     = useState(false)
  const chipRef = useRef(null)

  // When menu opens, check if it would go off-screen and flip upward
  useEffect(() => {
    if (!menuOpen || !chipRef.current) return
    const rect = chipRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setMenuUp(spaceBelow < 200)
  }, [menuOpen])

  const job      = jobs?.find(j => j.id === shift.job)
  const isClaim  = shift.claimable && isUnassigned
  const dotColor = STATUS_DOT[shift.confirmationStatus]

  const { instructors } = useDirectoryStore()
  const instructor = instructors?.find(i => i.id === shift.instructorId)
  const hasConflict = (() => {
    if (!instructor || !instructor.unavailability || !instructor.unavailability.length || !shift.date) return false
    
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const d = new Date(shift.date + 'T12:00:00')
    const dayAbbrev = daysOfWeek[d.getDay()]

    const shiftStart = timeTo24(shift.start)
    let shiftEnd = timeTo24(shift.end)
    if (shiftEnd <= shiftStart) shiftEnd += 1440

    for (const slot of instructor.unavailability) {
      if (slot.day === dayAbbrev) {
        const [sh, sm] = slot.start.split(':').map(Number)
        const [eh, em] = slot.end.split(':').map(Number)
        const slotStart = sh * 60 + sm
        let slotEnd = eh * 60 + em
        if (slotEnd <= slotStart) slotEnd += 1440

        if (shiftStart < slotEnd && slotStart < shiftEnd) {
          return true
        }
      }
    }
    return false
  })()

  const hasOverlap = (() => {
    if (!instructor || !shift.date) return false
    const siblings = useScheduleStore.getState().rawShifts.filter(
      s => s.instructorId === instructor.id && s.date === shift.date && s.id !== shift.id && s.status !== 'cancelled'
    )
    const shiftStart = timeTo24(shift.start)
    let shiftEnd = timeTo24(shift.end)
    if (shiftEnd <= shiftStart) shiftEnd += 1440
    
    for (const s of siblings) {
      const sStart = timeTo24(s.start)
      let sEnd = timeTo24(s.end)
      if (sEnd <= sStart) sEnd += 1440
      if (shiftStart < sEnd && sStart < shiftEnd) {
        return true
      }
    }
    return false
  })()

  // Color logic:
  // - Open/claimable chip  → danger/pulse (no tint)
  // - Cancelled job        → grey tint
  // - Has a job with color → use that job's color from settings
  // - Unassigned row, no job → white/light tint
  // - Assigned row, no job  → default card (no tint)
  const chipColor = (() => {
    if (isClaim)                                                    return null
    if (shift.status === 'cancelled' || shift.job === 'cancelled')  return '#9ca3af'
    if (job?.color)                                                 return job.color  // job color from settings
    if (isUnassigned)                                               return '#e2e8f0'  // white for unassigned with no job
    return null
  })()

  // Build a series date-range label: "4/15–5/15" or "4/15–5/15 skip 4/22"
  const seriesLabel = (() => {
    if (!shift.date) return null
    const fmt = d => {
      const dt = new Date(d + 'T12:00:00')
      return `${dt.getMonth()+1}/${dt.getDate()}`
    }
    if (!shift.seriesId) return fmt(shift.date)
    const siblings = useScheduleStore.getState().rawShifts
      .filter(s => s.seriesId === shift.seriesId)
      .map(s => s.date)
      .filter(Boolean)
      .sort()
    if (siblings.length <= 1) return fmt(shift.date)
    const first = siblings[0]
    const last  = siblings[siblings.length - 1]
    return `${fmt(first)}–${fmt(last)}`
  })()

  const menuBtn = `flex items-center gap-2 w-full px-3 py-2 text-sm text-primary
    bg-transparent hover:bg-raised border-none cursor-pointer rounded text-left transition-colors`

  const closeMenu = () => { setMenuOpen(false); setMultiOpen(false); setConfirmDel(false) }

  return (
    <div
      ref={chipRef}
      draggable={!menuOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => { if (!menuOpen) onClick() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (!menuOpen) { setMultiOpen(false); setConfirmDel(false) } }}
      className={`relative p-2 rounded-lg border cursor-grab transition-all duration-150 select-none
        ${isClaim ? 'border-danger/50 animate-pulse-dot' : ''}`}
      style={{
        background: isClaim
          ? 'var(--bg-claim)'
          : chipColor
            ? hexToRgba(chipColor, hover ? 0.28 : 0.18)
            : hover ? 'var(--raised)' : 'var(--card)',
        borderColor: isClaim
          ? 'rgba(248,113,113,0.5)'
          : chipColor
            ? hexToRgba(chipColor, hover ? 0.65 : 0.4)
            : 'var(--border)',
        cursor: "url(\"data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAIAAgADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIyAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB//9k=\") 8 0, grab",
      }}
    >
      {/* Status dot */}
      {dotColor && (
        <span
          className="absolute top-1 left-1 w-2 h-2 rounded-full z-10 pointer-events-none ring-2 ring-card"
          style={{ background: dotColor }}
          title={shift.confirmationStatus}
        />
      )}

      {/* Three-dot trigger — top-right */}
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); setMultiOpen(false); setConfirmDel(false) }}
          className={`absolute top-0.5 right-0.5 z-20 w-5 h-5 rounded flex items-center justify-center text-xs
            transition-colors cursor-pointer border-none
            ${menuOpen ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-primary'}`}
        >⋯</button>
      )}

      {/* Dropdown */}
      {menuOpen && (
        <>
          <div onClick={e => { e.stopPropagation(); closeMenu() }} className="fixed inset-0 z-40" />
          <div
            onClick={e => e.stopPropagation()}
            className={`absolute z-50 bg-card border border-app rounded-xl shadow-xl min-w-[170px] overflow-hidden animate-fade-in ${menuUp ? 'bottom-full mb-1' : 'top-full mt-1'} left-0`}
          >
            <button onClick={() => { onDuplicate(shift); closeMenu() }} className={menuBtn}>📋 Duplicate</button>


            <div className="h-px bg-app mx-1" />
            {!isUnassigned && (
              <button onClick={() => { onUnassign(shift); closeMenu() }} className={menuBtn}>↩ Unassign</button>
            )}
            {shift.confirmationStatus === 'rejected' && (
              <button onClick={() => { onUnassign(shift); closeMenu() }} className={`${menuBtn} !text-warn`}>⚡ Mark as open</button>
            )}

            {!confirmDel ? (
              <button
                onClick={e => { e.stopPropagation(); setConfirmDel(true) }}
                className={`${menuBtn} !text-danger hover:!bg-danger-soft`}
              >🗑 Delete</button>
            ) : (
              <div className="p-3 bg-danger-soft">
                <p className="text-xs font-semibold text-danger mb-2">Delete this shift?</p>
                <div className="flex gap-1.5">
                  <button onClick={() => { onDeleteShift(shift); closeMenu() }}
                    className="flex-1 py-1.5 rounded-lg bg-danger text-white text-xs font-bold cursor-pointer border-none">Yes</button>
                  <button onClick={() => setConfirmDel(false)}
                    className="flex-1 py-1.5 rounded-lg bg-card text-muted text-xs font-semibold cursor-pointer border border-app">Cancel</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Chip content */}
      <div className={`flex items-center gap-1.5 mb-0.5 pr-5 ${dotColor ? 'pl-3' : ''}`}>
  
        <span className="text-xs font-bold text-primary truncate">
          {shift.title || `${shift.start}–${shift.end}`}
        </span>
      </div>

      {/* Session type label */}
      {job?.title && (
        <p className="text-2xs font-semibold truncate"
          style={{ color: job.color || 'var(--muted)', opacity: 0.85 }}>
          {job.title}
        </p>
      )}

      <p className="text-2xs text-muted font-mono">{shift.start} – {shift.end}</p>
      <div className="flex items-center justify-between gap-1 mt-0.5">
        {shift.students && <p className="text-2xs text-dim font-semibold">👥 {shift.students}</p>}
        {seriesLabel && <p className="text-2xs text-dim font-mono truncate">{seriesLabel}</p>}
      </div>
      {isClaim && <p className="text-2xs font-extrabold text-danger mt-0.5 uppercase tracking-wide">⚡ Open</p>}
      <div className="flex flex-wrap items-center gap-1 mt-0.5">
        {hasConflict && <p className="text-2xs font-extrabold text-danger mt-0.5 flex items-center gap-1 uppercase tracking-wide">⚠️ Unavail</p>}
        {hasOverlap && <p className="text-2xs font-extrabold text-danger mt-0.5 flex items-center gap-1 uppercase tracking-wide">⚠️ Overlap</p>}
      </div>
    </div>
  )
}

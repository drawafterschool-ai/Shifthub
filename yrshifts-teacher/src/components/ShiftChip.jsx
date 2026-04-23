import { useState } from 'react'

// Convert a hex color to rgba with given opacity
function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '')
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

  const job      = jobs?.find(j => j.id === shift.job)
  const isClaim  = shift.claimable && isUnassigned
  const dotColor = STATUS_DOT[shift.confirmationStatus]
  // Unassigned = white tint, cancelled = grey, otherwise use job color
  const jobColor = isUnassigned && !isClaim
    ? '#e2e8f0'
    : shift.status === 'cancelled' || shift.job === 'cancelled'
      ? '#9ca3af'
      : job?.color || null

  const menuBtn = `flex items-center gap-2 w-full px-3 py-2 text-sm text-primary
    bg-transparent hover:bg-raised border-none cursor-pointer rounded text-left transition-colors`

  const closeMenu = () => { setMenuOpen(false); setMultiOpen(false); setConfirmDel(false) }

  return (
    <div
      draggable={!menuOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => { if (!menuOpen) onClick() }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); if (!menuOpen) { setMultiOpen(false); setConfirmDel(false) } }}
      className={`
        relative p-2 rounded-lg border cursor-grab transition-all duration-150 select-none
        ${isClaim ? 'animate-pulse-dot' : ''}`}
      style={{
        background: isClaim
          ? 'var(--bg-claim)'
          : jobColor
            ? hexToRgba(jobColor, hover ? 0.25 : 0.15)
            : hover ? 'var(--raised)' : 'var(--card)',
        borderColor: isClaim
          ? 'rgba(248,113,113,0.5)'
          : jobColor
            ? hexToRgba(jobColor, hover ? 0.6 : 0.35)
            : 'var(--border)',
      }}
    >
      {/* Status dot */}
      {dotColor && (
        <span
          className="absolute top-1 left-1 w-2 h-2 rounded-full z-10 pointer-events-none ring-2 ring-card"
          style={{ background: dotColor }}
          title={shift.confirmationStatus === 'confirmed' ? 'Confirmed' : shift.confirmationStatus === 'rejected' ? 'Rejected' : 'Pending'}
        />
      )}

      {/* Three-dot trigger */}
      {hover && (
        <button
          onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); setMultiOpen(false); setConfirmDel(false) }}
          className={`
            absolute top-1 z-20 w-5 h-5 rounded flex items-center justify-center text-xs
            transition-colors cursor-pointer border-none
            ${dotColor ? 'left-4' : 'left-1'}
            ${menuOpen ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-primary'}
          `}
        >⋯</button>
      )}

      {/* Dropdown */}
      {menuOpen && (
        <>
          <div onClick={e => { e.stopPropagation(); closeMenu() }} className="fixed inset-0 z-40" />
          <div
            onClick={e => e.stopPropagation()}
            className="absolute top-full left-0 z-50 mt-1 bg-card border border-app rounded-xl shadow-xl min-w-[170px] overflow-hidden animate-fade-in"
          >
            <button onClick={() => { onDuplicate(shift); closeMenu() }} className={menuBtn}>📋 Duplicate</button>

            <div className="relative" onMouseEnter={() => setMultiOpen(true)} onMouseLeave={() => setMultiOpen(false)}>
              <button className={`${menuBtn} justify-between`}>
                <span>📑 Multi duplicate</span>
                <span className="text-dim text-xs">▸</span>
              </button>
              {multiOpen && (
                <div className="absolute left-full top-0 ml-1 bg-card border border-app rounded-xl shadow-xl overflow-hidden min-w-[110px]">
                  {[2, 3, 4, 5, 6].map(n => (
                    <button key={n} onClick={() => { onMultiDup(shift, n); closeMenu() }} className={menuBtn}>×{n} copies</button>
                  ))}
                </div>
              )}
            </div>

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
      <div className={`flex items-center gap-1.5 mb-1 transition-all duration-150 ${hover ? 'pl-5' : dotColor ? 'pl-3' : ''}`}>
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: job?.color || 'var(--accent)' }} />
        <span className="text-xs font-bold text-primary truncate">
          {shift.title || `${shift.start}–${shift.end}`}
        </span>
      </div>
      <p className="text-2xs text-muted font-mono">{shift.start} – {shift.end}</p>
      {shift.students && <p className="text-2xs text-dim mt-0.5 font-semibold">👥 {shift.students}</p>}
      {isClaim && <p className="text-2xs font-extrabold text-danger mt-0.5 uppercase tracking-wide">⚡ Open</p>}
    </div>
  )
}

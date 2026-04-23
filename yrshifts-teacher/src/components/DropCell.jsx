import { useState } from 'react'
import ShiftChip from './ShiftChip'

export default function DropCell({
  shifts = [], ownerId, dateKey, isUnassigned, jobs,
  onDrop, onShiftClick, onDragShift, onAddShift,
  onDuplicate, onMultiDup, onUnassign, onDeleteShift,
}) {
  const [dragOver, setDragOver] = useState(false)
  const [plusHover, setPlusHover] = useState(false)

  const handleDragOver  = e => { e.preventDefault(); setDragOver(true) }
  const handleDragLeave = ()  => setDragOver(false)
  const handleDrop      = e => {
    e.preventDefault(); setDragOver(false)
    try {
      const d = JSON.parse(e.dataTransfer.getData('text/plain'))
      onDrop(d.fromOwner, d.fromDate, d.shiftId, ownerId, dateKey)
    } catch { /* ignore */ }
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        min-h-12 rounded-lg p-0.5 flex flex-col gap-0.5 transition-all duration-150
        ${dragOver
          ? 'border-2 border-solid border-accent bg-accent-soft'
          : shifts.length
            ? 'border-2 border-transparent'
            : isUnassigned
              ? 'border-2 border-dashed border-amber-500/20 bg-warn-soft'
              : 'border-2 border-dashed border-app'}
      `}
    >
      {/* Shift chips */}
      {shifts.map(s => (
        <ShiftChip
          key={s.id}
          shift={s}
          jobs={jobs}
          isUnassigned={isUnassigned}
          onClick={() => onShiftClick(ownerId, dateKey, s)}
          onDragStart={e => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ fromOwner: ownerId, fromDate: dateKey, shiftId: s.id }))
            onDragShift(s.id)
          }}
          onDragEnd={() => onDragShift(null)}
          onDuplicate={sh  => onDuplicate(ownerId, dateKey, sh)}
          onMultiDup={(sh, n) => onMultiDup(ownerId, dateKey, sh, n)}
          onUnassign={sh => onUnassign(ownerId, dateKey, sh)}
          onDeleteShift={sh => onDeleteShift(ownerId, dateKey, sh)}
        />
      ))}

      {/* Add button — inline if shifts exist, centred if empty */}
      {shifts.length > 0 ? (
        <div
          onClick={() => onAddShift(ownerId, dateKey)}
          onMouseEnter={() => setPlusHover(true)}
          onMouseLeave={() => setPlusHover(false)}
          className={`
            flex items-center justify-center h-5 rounded cursor-pointer transition-all duration-150
            ${plusHover ? 'bg-accent-soft border border-dashed border-accent' : 'border border-transparent'}
          `}
        >
          <span className={`text-sm font-bold transition-colors ${plusHover ? 'text-accent' : 'text-dim'}`}>+</span>
        </div>
      ) : !dragOver && (
        <div
          onClick={() => onAddShift(ownerId, dateKey)}
          className="flex-1 flex items-center justify-center min-h-8 cursor-pointer group"
        >
          <span className="text-base text-dim opacity-30 group-hover:opacity-70 transition-opacity">+</span>
        </div>
      )}
    </div>
  )
}

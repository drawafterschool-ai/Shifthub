import { useState, useCallback, useMemo } from 'react'
import { useOutletContext }       from 'react-router-dom'

import useScheduleStore  from '../../stores/useScheduleStore'
import useDirectoryStore from '../../stores/useDirectoryStore'

import { DAYS, toKey, getWeekDates, getMonthDates, fmtDate, isToday } from '../../utils/date'
import { calcHours } from '../../utils/time'
import { makeShift, groupShifts, UNASSIGNED } from '../../utils/schedule'
import { exportCSV }             from '../../utils/exportCSV'

import Avatar   from '../../components/Avatar'
import Button   from '../../components/Button'
import DropCell from '../../components/DropCell'
import Modal, { ModalHeader } from '../../components/Modal'
import ShiftPanel from './ShiftPanel'
import ImportModal from '../../components/ImportModal'

// ── Export modal — month picker ───────────────────────────────────────────────
function ExportModal({ onClose, onExport }) {
  const now   = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ]
  const YEARS = Array.from({ length: 3 }, (_, i) => now.getFullYear() - 1 + i)

  return (
    <Modal onClose={onClose} zIndex="z-[3200]" width="max-w-xs">
      <ModalHeader title="📥 Export payroll" onClose={onClose} />
      <p className="text-sm text-muted mb-5 -mt-2 leading-relaxed">
        Choose a month to export. Only shifts in that period will be included.
      </p>

      <div className="flex gap-3 mb-6">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Month</label>
          <select value={month} onChange={e => setMonth(Number(e.target.value))}
            className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer">
            {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
          </select>
        </div>
        <div className="w-24">
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Year</label>
          <select value={year} onChange={e => setYear(Number(e.target.value))}
            className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer">
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-raised border border-app rounded-xl px-4 py-3 mb-5">
        <p className="text-xs text-muted">
          File will download as{' '}
          <span className="font-mono text-accent">
            payroll-{year}-{String(month).padStart(2,'0')}.csv
          </span>
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon="📥" onClick={() => onExport(year, month)}>
          Download CSV
        </Button>
      </div>
    </Modal>
  )
}



function ConfirmDropModal({ drop, instructors, onClose, onConfirm }) {
  const { shift, toOwner, toDate } = drop
  const isUna = toOwner === UNASSIGNED
  const inst  = isUna ? null : instructors.find(i => String(i.id) === String(toOwner))
  return (
    <Modal onClose={onClose} zIndex="z-[3000]">
      <ModalHeader title="Confirm assignment" onClose={onClose} />
      <p className="text-sm text-muted mb-6 leading-relaxed">
        Move <strong className="text-primary">{shift.title || 'this shift'}</strong> to{' '}
        <span className="text-accent font-semibold">{isUna ? 'Open / Unassigned' : `${inst?.firstName} ${inst?.lastName}`}</span>{' '}
        on <strong className="text-primary">{toDate}</strong>?
      </p>
      <div className="flex flex-col gap-2">
        <Button variant="primary" className="w-full justify-center py-3" onClick={() => onConfirm(true)}>
          {isUna ? 'Publish & notify everyone' : 'Publish & notify teacher'}
        </Button>
        <Button className="w-full justify-center py-3" onClick={() => onConfirm(false)}>Save silently (draft)</Button>
        <button onClick={onClose} className="text-sm text-dim py-2 hover:text-muted transition-colors cursor-pointer bg-transparent border-none">Cancel</button>
      </div>
    </Modal>
  )
}

function DeleteScopeModal({ onClose, onConfirm }) {
  const [scope, setScope] = useState('single')
  const OPTIONS = [
    ['single', 'This shift only',           'Just the one you selected'],
    ['future', 'This and following shifts',  'From this date onwards in the series'],
    ['all',    'All shifts in this series',  'Every shift with the same session & time'],
  ]
  return (
    <Modal onClose={onClose} zIndex="z-[3100]">
      <ModalHeader title="Delete shift" onClose={onClose} />
      <div className="flex flex-col gap-2 mb-5">
        {OPTIONS.map(([val, label, sub]) => (
          <label key={val} onClick={() => setScope(val)}
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all
              ${scope === val ? 'border-danger bg-danger-soft' : 'border-app bg-raised'}`}>
            <input type="radio" name="ds" checked={scope === val} onChange={() => setScope(val)} className="mt-0.5 accent-danger flex-shrink-0" />
            <div>
              <p className={`text-sm font-semibold ${scope === val ? 'text-danger' : 'text-primary'}`}>{label}</p>
              <p className="text-xs text-muted mt-0.5">{sub}</p>
            </div>
          </label>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <button onClick={() => onConfirm(scope)} className="px-4 py-1.5 bg-danger text-white text-sm font-semibold rounded-lg cursor-pointer border-none hover:opacity-90">Delete</button>
      </div>
    </Modal>
  )
}


// ── Admin mobile shift detail (read-only, Option A) ─────────────────────────
// Mirrors the teacher ShiftDetailModal structure so field rendering is
// consistent between both apps. Opens ShiftPanel on "Edit →" tap.
function AdminShiftDetailSheet({ shift, jobs, instructors, onClose, onEdit }) {
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
    ? `https://maps.apple.com/?q=${encodeURIComponent(shift.address)}`
    : null

  return (
    <div className="fixed inset-0 z-[3500] flex flex-col justify-end bg-black/60 md:hidden"
      onClick={onClose}>
      <div className="bg-surface rounded-t-3xl max-h-[85vh] flex flex-col"
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

export default function ScheduleView() {
  const sms = useOutletContext()
  const { rawShifts, jobs, loading, moveShift, duplicateShift, multiDupShift, unassignShift, deleteShift } = useScheduleStore()
  const { instructors } = useDirectoryStore()

  const schedule = useMemo(() => {
    return groupShifts(rawShifts, instructors.map(i => i.id))
  }, [rawShifts, instructors])

  const [ctx,           setCtx]           = useState(null)
  const [mobileDetail,  setMobileDetail]  = useState(null)   // read-only bottom-sheet on mobile
  const [pendingDrop,   setPendingDrop]   = useState(null)
  const [deletingShift, setDeletingShift] = useState(null)
  const [weekOffset,    setWeekOffset]    = useState(0)
  const [viewMode,      setViewMode]      = useState('week')
  const [toast,         setToast]         = useState(null)
  const [exportModal,   setExportModal]   = useState(false)
  const [importModal,   setImportModal]   = useState(false)

  const weekDates = getWeekDates(weekOffset)
  const weekKeys  = weekDates.map(toKey)
  const monthData = getMonthDates(weekOffset)
  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500) }

  const handleDrop = (fromOwner, fromDate, shiftId, toOwner, toDate) => {
    if (fromOwner === toOwner && fromDate === toDate) return
    const shift = schedule[fromOwner]?.[fromDate]?.find(s => s.id === shiftId)
    if (shift) setPendingDrop({ fromOwner, fromDate, shiftId, toOwner, toDate, shift })
  }

  const confirmDrop = async (notify) => {
    if (!pendingDrop) return
    try {
      await moveShift(pendingDrop.shiftId, pendingDrop.toOwner, pendingDrop.toDate, notify, instructors, sms)
      showToast(notify ? 'Published & notified' : 'Saved silently')
    } catch (e) { console.error(e) }
    setPendingDrop(null)
  }

  const chipDuplicate = async (_o, _d, s) => { await duplicateShift(s);      showToast('Duplicated') }
  const chipMultiDup  = async (_o, _d, s, n) => { await multiDupShift(s, n); showToast(`${n} copies created`) }
  const chipUnassign  = async (_o, _d, s) => { await unassignShift(s);       showToast('Moved to unassigned') }

  const executeGridDelete = async (scope) => {
    const count = await deleteShift(deletingShift, scope, deletingShift.date)
    setDeletingShift(null)
    showToast(`Deleted ${count} shift${count !== 1 ? 's' : ''}`)
  }

  const cellProps = useCallback((ownerId) => ({
    onDrop:        handleDrop,
    onShiftClick:  (_o, d, s) => {
      if (window.innerWidth < 768) { setMobileDetail(s) }
      else                         { setCtx({ shift: s, dateKey: d, isNew: false }) }
    },
    onDragShift:   () => {},
    onAddShift:    (_o, d)    => setCtx({ shift: makeShift({ date: d, instructorId: _o === UNASSIGNED ? null : _o }), dateKey: d, isNew: true }),
    onDuplicate:   chipDuplicate,
    onMultiDup:    chipMultiDup,
    onUnassign:    chipUnassign,
    onDeleteShift: (_o, _d, s) => setDeletingShift(s),
    jobs,
  }), [jobs, schedule]) // eslint-disable-line

  // Sum hours for assigned teachers only — exclude unassigned row and cancelled shifts
  const totalHours = (() => {
    let hours = 0
    instructors.forEach(emp => {
      const os = schedule[String(emp.id)] || {}
      weekKeys.forEach(k => {
        (os[k] || []).forEach(s => {
          if (s.status === 'cancelled' || s.job === 'cancelled') return
          hours += s.hoursWorked != null ? Number(s.hoursWorked) : (calcHours(s.start, s.end)?.decimal || 0)
        })
      })
    })
    return hours
  })()

  const monthLabel = new Date(monthData.year, monthData.month)
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <p className="text-sm text-muted">Loading schedule…</p>
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3.5 border-b border-app bg-surface flex-shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-primary">Schedule</h1>
          <span className="text-sm text-muted">{viewMode === 'week' ? `${fmtDate(weekDates[0])} – ${fmtDate(weekDates[6])}` : monthLabel}</span>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-muted">
            <span className="text-primary font-bold">{totalHours % 1 === 0 ? totalHours : totalHours.toFixed(1)}</span>
            <span>hrs assigned</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-app overflow-hidden">
            {['week', 'month'].map(m => (
              <button key={m} onClick={() => { setViewMode(m); setWeekOffset(0) }}
                className={`px-3.5 py-1.5 text-sm font-semibold capitalize transition-colors cursor-pointer border-none
                  ${viewMode === m ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}>{m}</button>
            ))}
          </div>
          <div className="w-px h-5 bg-app mx-1" />
          <Button small variant="ghost" onClick={() => setWeekOffset(o => o - 1)}>←</Button>
          <Button small onClick={() => setWeekOffset(0)}>Today</Button>
          <Button small variant="ghost" onClick={() => setWeekOffset(o => o + 1)}>→</Button>
          <div className="w-px h-5 bg-app mx-1" />
          <Button small icon="📤" onClick={() => setImportModal(true)}>Import</Button>
          <Button small icon="📥" onClick={() => setExportModal(true)}>Export</Button>
        </div>
      </div>

      {/* Week view */}
      {viewMode === 'week' && (
        <div className="flex-1 overflow-auto">
          <div className="min-w-[960px] px-4">

            {/* Day headers */}
            <div className="grid grid-cols-schedule gap-1 py-3.5 sticky top-0 bg-app z-10">
              <div />
              {DAYS.map((day, i) => {
                const d = weekDates[i]; const td = isToday(d)
                return (
                  <div key={day} className={`text-center py-1.5 px-1 rounded-lg ${td ? 'bg-accent-soft' : ''}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wide ${td ? 'text-accent' : 'text-dim'}`}>{day}</p>
                    <p className={`text-base font-extrabold mt-0.5 ${td ? 'text-accent' : 'text-primary'}`}>{d.getDate()}</p>
                  </div>
                )
              })}
            </div>

            {/* Unassigned row — sticky below the day headers */}
            <div className="grid grid-cols-schedule gap-1 py-0.5 mb-0.5 bg-surface rounded-lg border-b border-app"
              style={{ position: 'sticky', top: 68, zIndex: 9 }}>
              <div className="flex items-center gap-1 px-1.5">
                <span className="text-xs flex-shrink-0">📋</span>
                <p className="text-[11px] font-bold text-muted leading-tight truncate">Unassigned</p>
              </div>
              {weekDates.map(d => { const dk = toKey(d); return <DropCell key={dk} shifts={schedule[UNASSIGNED]?.[dk] || []} ownerId={UNASSIGNED} dateKey={dk} isUnassigned {...cellProps(UNASSIGNED)} /> })}
            </div>

            {/* Instructor rows */}
            {instructors.map((emp, index) => {
              const eid = String(emp.id); const es = schedule[eid] || {}
              const wc  = weekKeys.reduce((s, k) => s + (es[k]?.length || 0), 0)
              return (
                <div key={eid} className={`grid grid-cols-schedule gap-1 py-1 border-t border-app/30 ${index % 2 === 0 ? 'bg-surface' : ''}`}>
                  <div className="flex items-center gap-1.5 px-1.5 py-0.5">
                    <Avatar firstName={emp.firstName} lastName={emp.lastName} color={emp.color} photo={emp.photo} size={26} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-primary truncate">{emp.firstName} {emp.lastName?.[0] || ''}</p>
                      <p className="text-[10px] text-dim">{wc}s</p>
                    </div>
                  </div>
                  {weekDates.map(d => { const dk = toKey(d); return <DropCell key={dk} shifts={es[dk] || []} ownerId={eid} dateKey={dk} {...cellProps(eid)} /> })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Month view */}
      {viewMode === 'month' && (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-7 gap-1">
            {DAYS.map(d => <div key={d} className="text-center py-2 text-xs font-bold text-dim uppercase tracking-wide">{d}</div>)}
            {monthData.cells.map((d, i) => {
              const dk = toKey(d); const inMonth = d.getMonth() === monthData.month; const td = isToday(d)
              const all = [...(schedule[UNASSIGNED]?.[dk] || []), ...instructors.flatMap(inst => schedule[String(inst.id)]?.[dk] || [])]
              return (
                <div key={i} onClick={() => { if (!all.length) setCtx({ shift: makeShift({ date: dk }), dateKey: dk, isNew: true }) }}
                  className={`min-h-[80px] p-1.5 rounded-lg border cursor-pointer transition-colors ${td ? 'border-accent bg-accent-soft' : 'border-app'} ${inMonth ? td ? '' : 'bg-card' : 'bg-app opacity-40'}`}>
                  <p className={`text-sm font-bold mb-1 ${td ? 'text-accent' : 'text-primary'}`}>{d.getDate()}</p>
                  {all.slice(0, 3).map(s => { const j = jobs.find(jb => jb.id === s.job); return (
                    <div key={s.id} onClick={e => { e.stopPropagation(); if (window.innerWidth < 768) { setMobileDetail(s) } else { setCtx({ shift: s, dateKey: dk, isNew: false }) } }}
                      className="text-xs px-1.5 py-0.5 rounded mb-0.5 font-semibold truncate cursor-pointer"
                      style={{ background: (j?.color || '#4EA8D6') + '22', color: j?.color || 'var(--accent)' }}>{s.start}</div>
                  )})}
                  {all.length > 3 && <p className="text-2xs text-dim font-semibold">+{all.length - 3} more</p>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {exportModal && (
        <ExportModal
          onClose={() => setExportModal(false)}
          onExport={(y, m) => {
            exportCSV(schedule, instructors, jobs, y, m)
            setExportModal(false)
          }}
        />
      )}
      {importModal && (
        <ImportModal
          onClose={() => setImportModal(false)}
          onImported={(msg) => {
            showToast(msg)
            setImportModal(false)
          }}
          existingInstructors={instructors}
          jobs={jobs}
        />
      )}
      {pendingDrop && <ConfirmDropModal drop={pendingDrop} instructors={instructors} onClose={() => setPendingDrop(null)} onConfirm={confirmDrop} />}
      {deletingShift && <DeleteScopeModal onClose={() => setDeletingShift(null)} onConfirm={executeGridDelete} />}
      {ctx && <ShiftPanel shift={ctx.shift} dateKey={ctx.dateKey} isNew={ctx.isNew} onClose={() => setCtx(null)} onSaved={(msg) => { showToast(msg); setCtx(null) }} sms={sms} />}
      {mobileDetail && (
        <AdminShiftDetailSheet
          shift={mobileDetail}
          jobs={jobs}
          instructors={instructors}
          onClose={() => setMobileDetail(null)}
          onEdit={() => {
            const s = mobileDetail
            setMobileDetail(null)
            setCtx({ shift: s, dateKey: s.date, isNew: false })
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-card border border-app text-primary text-sm font-semibold rounded-xl shadow-xl z-[9999] animate-fade-in whitespace-nowrap">
          {toast}
        </div>
      )}
    </div>
  )
}

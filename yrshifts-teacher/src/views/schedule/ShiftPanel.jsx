import { useState, useMemo, useRef } from 'react'

import useScheduleStore  from '../../stores/useScheduleStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import useSettingsStore  from '../../stores/useSettingsStore'

import { uid, STUDENTS_OPTS }  from '../../utils/helpers'
import { TIME_OPTS, calcHours } from '../../utils/time'
import { toKey, addDays, isToday, fmtDateLong } from '../../utils/date'

import Button from '../../components/Button'
import Modal, { ModalHeader } from '../../components/Modal'

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../utils/firebase'

const DEFAULT_JOBS = [
  { id: 'teach',     title: 'Teach',     color: '#4ade80' },  // light green
  { id: 'workshop',  title: 'Workshop',  color: '#7dd3fc' },  // light blue
  { id: 'assist',    title: 'Assist',    color: '#f9a8d4' },  // pink
  { id: 'sub',       title: 'Sub',       color: '#fca5a5' },  // red
  { id: 'cancelled', title: 'Cancelled', color: '#9ca3af' },  // grey
]

const DEFAULT_TIERS = [
  { maxStudents: 9,  ratePerHour: 30 },
  { maxStudents: 14, ratePerHour: 40 },
  { maxStudents: 99, ratePerHour: 45 },
]

// ── Edit scope modal ──────────────────────────────────────────────────────────
function EditScopeModal({ shiftDate, action, onChoose, onCancel }) {
  const verb = action === 'publish' ? 'Publish' : 'Save draft'
  return (
    <Modal onClose={onCancel} zIndex="z-[2000]" width="max-w-sm">
      <ModalHeader title={`${verb} — which shifts?`} onClose={onCancel} />
      <p className="text-sm text-muted mb-4 -mt-2">Choose how far your changes should reach.</p>
      <div className="flex flex-col gap-2.5">
        {[
          ['single', '✏️  This shift only',           `Only the shift on ${shiftDate}`],
          ['future', '📅  This and following shifts',  'From this date onward in the series'],
          ['all',    '📋  All shifts in this series',  'Every shift with the same session & time'],
        ].map(([scope, label, sub]) => (
          <button key={scope} onClick={() => onChoose(scope)}
            className="w-full text-left p-3.5 rounded-xl border border-app bg-raised hover:border-accent transition-colors cursor-pointer">
            <p className="text-sm font-bold text-primary">{label}</p>
            <p className="text-xs text-muted mt-1">{sub}</p>
          </button>
        ))}
      </div>
      <button onClick={onCancel} className="w-full mt-3 text-sm text-dim py-2 hover:text-muted transition-colors cursor-pointer bg-transparent border-none">Cancel</button>
    </Modal>
  )
}

// ── Delete scope modal (panel path) ──────────────────────────────────────────
function DeleteScopeModal({ onClose, onConfirm }) {
  const [scope, setScope] = useState('single')
  return (
    <Modal onClose={onClose} zIndex="z-[2000]">
      <ModalHeader title="Delete shift" onClose={onClose} />
      <div className="flex flex-col gap-2 mb-5">
        {[['single','This shift only'],['future','This and following'],['all','All in series']].map(([val, label]) => (
          <label key={val} onClick={() => setScope(val)}
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all
              ${scope === val ? 'border-danger bg-danger-soft' : 'border-app bg-raised'}`}>
            <input type="radio" checked={scope === val} onChange={() => setScope(val)} className="accent-danger flex-shrink-0" />
            <span className={`text-sm font-semibold ${scope === val ? 'text-danger' : 'text-primary'}`}>{label}</span>
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

// ── Field wrapper ─────────────────────────────────────────────────────────────
function Field({ label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-sm text-muted w-28 flex-shrink-0 pt-2.5">{label}</span>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"
const SELECT = `${INPUT} appearance-none cursor-pointer`

// ── Main ShiftPanel ───────────────────────────────────────────────────────────
export default function ShiftPanel({ shift, dateKey, isNew, onClose, onSaved, sms }) {
  const { jobs: rawJobs, saveShift, deleteShift } = useScheduleStore()
  const jobs = rawJobs?.length ? rawJobs : DEFAULT_JOBS
  const { instructors }                  = useDirectoryStore()
  const { payrollTiers }                 = useSettingsStore()

  const tiers = payrollTiers?.length ? payrollTiers : DEFAULT_TIERS

  // ── Form state ──────────────────────────────────────────────────────────────
  const [selectedDates, setSelectedDates] = useState(() => {
    const d = shift.date || dateKey; return d ? new Set([d]) : new Set()
  })
  const [skipDates,    setSkipDates]    = useState(new Set(shift.skipDates || []))
  const [calMonth,     setCalMonth]     = useState(() => {
    const d = shift.date || dateKey || toKey(new Date())
    return { year: parseInt(d.slice(0, 4)), month: parseInt(d.slice(5, 7)) - 1 }
  })
  const [start,        setStart]        = useState(shift.start        || '2:00 PM')
  const [end,          setEnd]          = useState(shift.end          || '3:00 PM')
  const [title,        setTitle]        = useState(shift.title        || '')
  const [job,          setJob]          = useState(shift.job          || '')
  const [note,         setNote]         = useState(shift.note         || '')
  const [instructorId, setInstructorId] = useState(shift.instructorId || 'UNASSIGNED')
  const [claimable,    setClaimable]    = useState(shift.claimable    ?? false)
  const [students,     setStudents]     = useState(shift.students     || '')
  const [address,      setAddress]      = useState(shift.address      || '')
  const [attachments,  setAttachments]  = useState(shift.attachments  || [])
  const [suggestions,  setSuggestions]  = useState([])
  const [showSug,      setShowSug]      = useState(false)
  const [isUploading,  setIsUploading]  = useState(false)
  const [editScopeFor, setEditScopeFor] = useState(null)   // null | 'publish' | 'draft'
  const [confirmDel,   setConfirmDel]   = useState(false)
  const [err,          setErr]          = useState('')
  const fileRef    = useRef(null)
  const searchTimer = useRef(null)

  // ── Computed ────────────────────────────────────────────────────────────────
  const hours        = calcHours(start, end)
  const sortedDates  = useMemo(() => [...selectedDates].sort(), [selectedDates])
  const startDate    = sortedDates[0] || ''
  const effectiveDates = sortedDates.filter(d => !skipDates.has(d))
  const previewRate  = students > 0 ? (tiers.find(t => Number(students) <= t.maxStudents)?.ratePerHour || 0) : 0
  const previewTotal = previewRate * hours.decimal

  const calDays = useMemo(() => {
    const first = new Date(calMonth.year, calMonth.month, 1)
    const start = addDays(first, 1 - (first.getDay() || 7))
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [calMonth])

  const toggleDate = (dk) => {
    const next = new Set(selectedDates)
    if (next.has(dk)) { next.delete(dk); const ns = new Set(skipDates); ns.delete(dk); setSkipDates(ns) }
    else next.add(dk)
    setSelectedDates(next)
  }
  const toggleSkip = (dk) => {
    const next = new Set(skipDates)
    if (next.has(dk)) next.delete(dk); else next.add(dk)
    setSkipDates(next)
  }

  // ── Address autocomplete ────────────────────────────────────────────────────
  const handleAddressChange = (e) => {
    const val = e.target.value; setAddress(val); setShowSug(true)
    clearTimeout(searchTimer.current)
    if (val.length < 3) { setSuggestions([]); return }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val + ', Minnesota')}&limit=5&countrycodes=us&viewbox=-97.239,49.384,-89.489,43.499&bounded=1`)
        setSuggestions(await res.json())
      } catch { /* ignore */ }
    }, 350)
  }

  // ── File upload ──────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files); if (!files.length) return
    setIsUploading(true)
    try {
      const added = []
      for (const f of files) {
        const snap = await uploadBytes(ref(storage, `shift_attachments/${uid()}_${f.name}`), f)
        const url  = await getDownloadURL(snap.ref)
        added.push({ id: uid(), name: f.name, url, type: f.type })
      }
      setAttachments(prev => [...prev, ...added])
    } catch { setErr('Upload failed — check your connection.') }
    finally { setIsUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  // ── Build shift data ─────────────────────────────────────────────────────────
  const build = (status) => ({
    ...shift,
    title, job, address, note, start, end,
    date:         startDate,
    instructorId: instructorId === 'UNASSIGNED' ? null : instructorId,
    claimable, attachments, skipDates: [...skipDates],
    students:     students ? Number(students) : null,
    hoursWorked:  hours.decimal, appliedRate: previewRate,
    totalPay:     previewTotal, payrollStatus: shift.payrollStatus || 'unpaid',
    seriesId:     shift.seriesId || uid(),
    status,
  })

  const validate = (action) => {
    setErr('')
    if (action === 'publish' && instructorId === 'UNASSIGNED' && !claimable) {
      setErr("To publish an unassigned shift, tick 'Open shift' first."); return false
    }
    if (effectiveDates.length === 0) { setErr('Select at least one date.'); return false }
    return true
  }

  const handlePublish = () => {
    if (!validate('publish')) return
    if (!isNew) { setEditScopeFor('publish'); return }
    doSave('publish', 'single')
  }

  const handleDraft = () => {
    if (!validate('draft')) return
    if (!isNew) { setEditScopeFor('draft'); return }
    doSave('draft', 'single')
  }

  const doSave = async (action, scope) => {
    setEditScopeFor(null)
    try {
      await saveShift(
        build(action === 'publish' ? 'published' : 'draft'),
        effectiveDates, action, scope,
        isNew ? null : shift, isNew ? null : dateKey, isNew,
        instructors, sms,
      )
      onSaved(action === 'publish' ? '✅ Published' : '📝 Draft saved')
    } catch (e) { console.error(e); setErr('Error saving shift.') }
  }

  const handleDelete = async (scope) => {
    try {
      const count = await deleteShift(shift, scope, dateKey)
      onSaved(`🗑 Deleted ${count} shift${count !== 1 ? 's' : ''}`)
    } catch (e) { console.error(e) }
  }

  const mLabel   = new Date(calMonth.year, calMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const dayHdrs  = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[1000] bg-black/50 flex justify-end" onClick={onClose}>
        {/* Panel */}
        <div className="relative w-[540px] max-w-[95vw] h-full bg-surface flex flex-col shadow-2xl animate-slide-in"
          onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-app flex-shrink-0">
            <h2 className="text-base font-bold text-primary">{isNew ? 'New Shift' : 'Edit Shift'}</h2>
            <button onClick={onClose} className="text-dim hover:text-muted text-xl leading-none cursor-pointer bg-transparent border-none">×</button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

            {/* Calendar */}
            <div className="bg-card border border-app rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-primary">📅 Select date{isNew ? 's' : ''}</span>
                <span className="text-xs text-dim">{isNew ? '(click to toggle)' : '(click to change)'}</span>
              </div>

              <div className="flex items-center justify-between">
                <button onClick={() => setCalMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 })}
                  className="w-7 h-7 rounded-lg border border-app bg-transparent text-muted hover:text-primary cursor-pointer flex items-center justify-center text-sm">◂</button>
                <span className="text-sm font-bold text-primary">{mLabel}</span>
                <button onClick={() => setCalMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 })}
                  className="w-7 h-7 rounded-lg border border-app bg-transparent text-muted hover:text-primary cursor-pointer flex items-center justify-center text-sm">▸</button>
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {dayHdrs.map(d => <div key={d} className="text-center text-2xs font-bold text-dim uppercase py-1">{d}</div>)}
                {calDays.map((d, i) => {
                  const dk = toKey(d); const inMonth = d.getMonth() === calMonth.month
                  const td = isToday(d); const sel = selectedDates.has(dk); const skip = skipDates.has(dk)
                  return (
                    <div key={i} onClick={() => { if (inMonth) toggleDate(dk) }}
                      className={`
                        text-center py-1.5 rounded-lg text-xs transition-all duration-100 relative
                        ${inMonth ? 'cursor-pointer' : 'cursor-default opacity-20'}
                        ${skip  ? 'bg-danger-soft text-danger line-through' : ''}
                        ${sel && !skip ? 'bg-accent text-white font-extrabold' : ''}
                        ${!sel && !skip && td ? 'bg-accent-soft text-accent font-bold' : ''}
                        ${!sel && !skip && !td ? 'text-primary hover:bg-raised' : ''}
                      `}
                    >{d.getDate()}</div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">{effectiveDates.length} date{effectiveDates.length !== 1 ? 's' : ''} selected{skipDates.size > 0 ? `, ${skipDates.size} skipped` : ''}</span>
                {selectedDates.size > 0 && (
                  <button onClick={() => { setSelectedDates(new Set()); setSkipDates(new Set()) }}
                    className="text-accent font-semibold cursor-pointer bg-transparent border-none">Clear all</button>
                )}
              </div>
            </div>

            {/* Time */}
            <div className="bg-card border border-app rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted w-28 flex-shrink-0">🕐 Time</span>
                <div className="flex items-center gap-2 flex-1">
                  <select value={start} onChange={e => setStart(e.target.value)} className={SELECT + ' flex-1'}>
                    {TIME_OPTS.map(t => <option key={'s'+t} value={t}>{t}</option>)}
                  </select>
                  <span className="text-sm text-dim font-semibold">to</span>
                  <select value={end} onChange={e => setEnd(e.target.value)} className={SELECT + ' flex-1'}>
                    {TIME_OPTS.map(t => <option key={'e'+t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="pl-[124px]">
                <span className="px-3 py-1 rounded-lg bg-accent-soft text-accent text-sm font-extrabold font-mono">⏱ {hours.text}</span>
              </div>
            </div>

            {/* Session name */}
            <Field label="Session name">
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Woodcrest Spring" className={INPUT} />
            </Field>

            {/* Skip dates */}
            {sortedDates.length > 1 && (
              <Field label="🚫 Skip">
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {sortedDates.map(dk => {
                    const skipped = skipDates.has(dk)
                    return (
                      <button key={dk} onClick={() => toggleSkip(dk)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer border transition-all
                          ${skipped ? 'border-danger text-danger bg-danger-soft line-through' : 'border-app text-primary bg-transparent'}`}>
                        {new Date(dk + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                      </button>
                    )
                  })}
                </div>
                <p className="text-xs text-dim">Click a date to skip it</p>
              </Field>
            )}

            {/* Students & payroll */}
            <Field label="👥 Students">
              <select value={students} onChange={e => setStudents(e.target.value ? Number(e.target.value) : '')}
                className={`${SELECT} ${students ? 'text-primary' : 'text-dim'}`}>
                <option value="">Select count…</option>
                {STUDENTS_OPTS.map(n => <option key={n} value={n}>{n} students</option>)}
              </select>
              {students > 0 && previewRate > 0 && (
                <div className="mt-2 inline-flex gap-2 px-3 py-1.5 rounded-lg bg-ok-soft border border-ok/20">
                  <span className="text-xs font-bold text-ok">${previewRate}/hr</span>
                  <span className="text-xs text-ok">× {hours.decimal}h =</span>
                  <span className="text-xs font-extrabold text-ok">${previewTotal.toFixed(2)}</span>
                </div>
              )}
            </Field>

            {/* Session type */}
            <Field label="Session type">
              <select value={job} onChange={e => setJob(e.target.value)} className={SELECT}>
                <option value="" disabled>Select a type…</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.title || j.name || 'Unnamed'}</option>)}
              </select>
            </Field>

            {/* Instructor */}
            <Field label="Instructor">
              <div>
                <select value={instructorId}
                  onChange={e => { setInstructorId(e.target.value); if (e.target.value !== 'UNASSIGNED') setClaimable(false) }}
                  className={`${SELECT} ${instructorId !== 'UNASSIGNED' ? 'text-primary' : 'text-dim'}`}>
                  <option value="UNASSIGNED">⚡ Open shift (unassigned)</option>
                  {instructors.map(i => <option key={i.id} value={i.id}>{i.firstName} {i.lastName}</option>)}
                </select>
                <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
                  <input type="checkbox" checked={claimable}
                    onChange={e => { setClaimable(e.target.checked); if (e.target.checked) setInstructorId('UNASSIGNED') }}
                    className="accent-danger w-4 h-4 cursor-pointer" />
                  <span className="text-sm text-primary">Open shift — notify all teachers</span>
                </label>
              </div>
            </Field>

            {/* Address */}
            <Field label="Address">
              <div className="relative">
                <input value={address} onChange={handleAddressChange}
                  onFocus={() => { if (suggestions.length) setShowSug(true) }}
                  onBlur={() => setTimeout(() => setShowSug(false), 200)}
                  placeholder="Start typing to search…" className={INPUT} />
                {showSug && suggestions.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-app rounded-xl shadow-xl z-10 overflow-hidden">
                    {suggestions.map((s, i) => (
                      <div key={i} onClick={() => { setAddress(s.display_name); setShowSug(false) }}
                        className="px-3 py-2.5 text-xs text-primary cursor-pointer hover:bg-raised transition-colors border-b border-app/30 last:border-0">
                        {s.display_name}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Field>

            {/* Notes & files */}
            <Field label="Notes & files">
              <div>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                  placeholder="Additional instructions…"
                  className={`${INPUT} resize-y min-h-[64px] mb-2`} />
                <input type="file" ref={fileRef} onChange={handleFileUpload} multiple accept="image/*,.pdf" className="hidden" />
                <button onClick={() => fileRef.current?.click()} disabled={isUploading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-raised border border-app text-sm text-muted hover:text-primary disabled:opacity-50 cursor-pointer transition-colors">
                  {isUploading ? '⏳ Uploading…' : '📎 Attach file'}
                </button>
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {attachments.map(a => (
                      <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-card border border-app rounded-lg text-xs">
                        <a href={a.url} target="_blank" rel="noreferrer" className="text-accent no-underline max-w-[160px] truncate">
                          {a.type?.includes('image') ? '🖼️' : '📄'} {a.name}
                        </a>
                        <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                          className="text-dim hover:text-muted cursor-pointer bg-transparent border-none">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Field>

          </div>

          {/* Error */}
          {err && <div className="px-6 py-2.5 bg-danger-soft text-danger text-sm font-semibold flex-shrink-0">⚠️ {err}</div>}

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-app flex items-center gap-2 flex-shrink-0">
            <Button variant="publish" onClick={handlePublish} disabled={isUploading}>
              🔔 Publish{effectiveDates.length > 1 ? ` (${effectiveDates.length})` : ''}
            </Button>
            <Button onClick={handleDraft} disabled={isUploading}>Draft</Button>
            <Button variant="danger" onClick={() => setConfirmDel(true)}>🗑</Button>
            <div className="flex-1" />
            <Button onClick={() => { /* save template */ onClose() }} disabled={isUploading}>⏱ Template</Button>
          </div>
        </div>
      </div>

      {/* Scope modals — rendered outside the panel div so z-index is always above */}
      {editScopeFor && (
        <EditScopeModal
          shiftDate={shift.date || dateKey}
          action={editScopeFor}
          onChoose={scope => doSave(editScopeFor, scope)}
          onCancel={() => setEditScopeFor(null)}
        />
      )}

      {confirmDel && (
        <DeleteScopeModal
          onClose={() => setConfirmDel(false)}
          onConfirm={scope => { handleDelete(scope); setConfirmDel(false) }}
        />
      )}
    </>
  )
}

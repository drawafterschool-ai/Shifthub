import { useState, useRef } from 'react'
import { writeBatch, doc, collection } from 'firebase/firestore'
import { db } from '../utils/firebase'
import { uid } from '../utils/helpers'
import useScheduleStore from '../stores/useScheduleStore'
import Button from './Button'
import Modal, { ModalHeader } from './Modal'

const COLOURS = [
  '#6366F1', '#0EA5E9', '#10B981', '#EC4899', '#F59E0B',
  '#EF4444', '#8B5CF6', '#14B8A6', '#F97316', '#06B6D4'
]

export default function ImportModal({ existingInstructors, jobs: existingJobs, onClose, onImported }) {
  const fileRef = useRef(null)
  const [preview, setPreview] = useState(null) // { shifts, newTeachers, newJobs, skipped }
  const [error, setError] = useState('')
  const [step, setStep] = useState('idle') // idle | preview | importing | done
  const [progress, setProgress] = useState('')

  const parseDate = (d) => {
    if (!d) return ''
    const clean = d.trim()
    const parts = clean.split('/')
    if (parts.length === 3) {
      const m = parts[0].padStart(2, '0')
      const day = parts[1].padStart(2, '0')
      const y = parts[2]
      return `${y}-${m}-${day}`
    }
    if (clean.match(/^\d{4}-\d{2}-\d{2}$/)) return clean
    return d
  }

  const parseTime = (t) => {
    if (!t) return ''
    const clean = t.trim().toLowerCase()
    const m = clean.match(/^(\d+):(\d+)\s*(am|pm)$/)
    if (!m) {
      const m2 = clean.match(/^(\d+)\s*(am|pm)$/)
      if (m2) {
        const h = parseInt(m2[1], 10)
        const ampm = m2[2].toUpperCase()
        return `${h}:00 ${ampm}`
      }
      return t
    }
    const h = parseInt(m[1], 10)
    const min = m[2]
    const ampm = m[3].toUpperCase()
    return `${h}:${min} ${ampm}`
  }

  const splitName = (name) => {
    const parts = name.trim().split(/\s+/)
    const first = parts[0]
    const last = parts.slice(1).join(' ')
    const cap = (s) => s && s === s.toLowerCase() ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : s
    return { first: cap(first), last: cap(last) }
  }

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError('')
    setPreview(null)
    setStep('idle')

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const text = ev.target.result
        parse(text)
      } catch (err) {
        setError(`Parse error: ${err.message}`)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const parse = (text) => {
    const clean = text.replace(/^\uFEFF/, '')
    const lines = clean.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) {
      setError('File appears empty.')
      return
    }

    const parseRow = (line) => {
      const result = []
      let cur = ''
      let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
          inQ = !inQ
        } else if (ch === ',' && !inQ) {
          result.push(cur.trim().replace(/^"|"$/g, ''))
          cur = ''
        } else {
          cur += ch
        }
      }
      result.push(cur.trim().replace(/^"|"$/g, ''))
      return result
    }

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g, ''))
    const idx = {
      date: headers.findIndex(h => h === 'date'),
      start: headers.findIndex(h => h === 'start'),
      end: headers.findIndex(h => h === 'end'),
      title: headers.findIndex(h => h.includes('shift') || h === 'shifttitle'),
      job: headers.findIndex(h => h === 'job'),
      users: headers.findIndex(h => h === 'users'),
      addr: headers.findIndex(h => h === 'address'),
      note: headers.findIndex(h => h === 'note'),
    }

    if (idx.date < 0 || idx.start < 0 || idx.users < 0) {
      setError('Could not find required columns (Date, Start, Users). Make sure this is a schedule export.')
      return
    }

    const teacherMap = {}
    const jobMap = {} // name -> newJobObject
    const shifts = []
    const skipped = []

    lines.slice(1).forEach((line, i) => {
      const row = parseRow(line)
      if (row.length < 3) return

      const jobVal = idx.job >= 0 ? row[idx.job]?.trim() : 'Teach'
      const userVal = idx.users >= 0 ? row[idx.users]?.trim() : ''
      const dateVal = idx.date >= 0 ? row[idx.date]?.trim() : ''
      const startVal = idx.start >= 0 ? row[idx.start]?.trim() : ''
      const endVal = idx.end >= 0 ? row[idx.end]?.trim() : ''
      const titleVal = idx.title >= 0 ? row[idx.title]?.trim() : ''
      const addrVal = idx.addr >= 0 ? row[idx.addr]?.trim() : ''
      const noteVal = idx.note >= 0 ? row[idx.note]?.trim() : ''

      if (!dateVal || !startVal) return

      if (jobVal?.toUpperCase() === 'CANCELLED') {
        skipped.push(`Row ${i + 2}: CANCELLED — ${titleVal}`)
        return
      }

      const isOpen = (userVal === 'Open Shift' || !userVal)
      let parsedDate = ''
      try {
        parsedDate = parseDate(dateVal)
      } catch {
        return
      }

      // 1. Staging teachers
      if (!isOpen && userVal && !teacherMap[userVal]) {
        const { first, last } = splitName(userVal)
        teacherMap[userVal] = {
          id: uid(),
          firstName: first,
          lastName: last,
          color: COLOURS[Object.keys(teacherMap).length % COLOURS.length],
          role: 'teacher',
          email: '',
          phone: '',
          photo: null,
          _rawName: userVal,
        }
      }

      // 2. Staging unknown jobs
      if (jobVal && jobVal.toUpperCase() !== 'CANCELLED') {
        const matchedJob = existingJobs.find(j => j.title.toLowerCase() === jobVal.toLowerCase() || j.id === jobVal.toLowerCase())
        if (!matchedJob && !jobMap[jobVal.toLowerCase()]) {
          const tempJobId = jobVal.toLowerCase().replace(/[^a-z0-9]/g, '') || uid()
          jobMap[jobVal.toLowerCase()] = {
            id: tempJobId,
            title: jobVal,
            color: COLOURS[(existingJobs.length + Object.keys(jobMap).length) % COLOURS.length]
          }
        }
      }

      shifts.push({
        id: uid(),
        seriesId: uid(),
        date: parsedDate,
        start: parseTime(startVal),
        end: parseTime(endVal),
        title: titleVal,
        job: jobVal || 'Teach',
        address: addrVal,
        note: noteVal,
        claimable: isOpen,
        instructorId: null,
        _instructorName: isOpen ? null : userVal,
        status: 'published',
        attachments: [],
        skipDates: [],
        confirmationStatus: null,
        students: null,
      })
    })

    // Filter staging list for teachers already present in Directory
    const existingTeachers = new Set(existingInstructors.map(i => `${i.firstName} ${i.lastName}`.toLowerCase()))
    const newTeachers = Object.values(teacherMap).filter(t =>
      !existingTeachers.has(`${t.firstName} ${t.lastName}`.toLowerCase())
    )

    setPreview({
      shifts,
      newTeachers,
      newJobs: Object.values(jobMap),
      allTeachers: teacherMap,
      skipped
    })
    setStep('preview')
  }

  const doImport = async () => {
    if (!preview) return
    setStep('importing')

    const { shifts, newTeachers, newJobs, allTeachers } = preview

    try {
      // 1. Write new Job types to company settings first if any
      if (newJobs.length > 0) {
        setProgress(`Creating ${newJobs.length} new Session Types…`)
        const updatedJobs = [...existingJobs, ...newJobs]
        await useScheduleStore.getState().saveJobs(updatedJobs)
      }

      // 2. Write new Teacher profiles to Firestore
      setProgress(`Creating ${newTeachers.length} teacher profiles…`)
      const teacherBatch = writeBatch(db)
      newTeachers.forEach(t => {
        const docRef = doc(db, 'users', t.id)
        teacherBatch.set(docRef, t)
      })
      if (newTeachers.length > 0) {
        await teacherBatch.commit()
      }

      // 3. Build lookup maps
      const teacherLookup = {}
      existingInstructors.forEach(i => {
        teacherLookup[`${i.firstName} ${i.lastName}`.toLowerCase()] = String(i.id)
      })
      newTeachers.forEach(t => {
        teacherLookup[`${t.firstName} ${t.lastName}`.toLowerCase()] = t.id
        teacherLookup[t._rawName.toLowerCase()] = t.id
      })
      Object.values(allTeachers).forEach(t => {
        if (t._rawName) {
          teacherLookup[t._rawName.toLowerCase()] = teacherLookup[`${t.firstName} ${t.lastName}`.toLowerCase()] || t.id
        }
      })

      const jobLookup = {}
      existingJobs.forEach(j => {
        jobLookup[j.title.toLowerCase()] = j.id
        jobLookup[j.id] = j.id
      })
      newJobs.forEach(j => {
        jobLookup[j.title.toLowerCase()] = j.id
        jobLookup[j.id] = j.id
      })

      // 4. Resolve IDs on shifts
      const resolvedShifts = shifts.map(s => {
        const copy = { ...s }
        delete copy._instructorName

        // Resolve Instructor
        if (s._instructorName) {
          const rid = teacherLookup[s._instructorName.toLowerCase()]
          if (rid) copy.instructorId = rid
        }

        // Resolve Job ID
        const rawJob = s.job?.toLowerCase() || 'teach'
        const jid = jobLookup[rawJob]
        copy.job = jid || 'teach' // Default to teach if not resolved

        return copy
      })

      // 5. Commit shifts in chunks of 400
      const CHUNK = 400
      let written = 0
      for (let i = 0; i < resolvedShifts.length; i += CHUNK) {
        setProgress(`Importing shifts ${i + 1}–${Math.min(i + CHUNK, resolvedShifts.length)} of ${resolvedShifts.length}…`)
        const batch = writeBatch(db)
        resolvedShifts.slice(i, i + CHUNK).forEach(s => {
          batch.set(doc(collection(db, 'shifts'), s.id), s)
        })
        await batch.commit()
        written += resolvedShifts.slice(i, i + CHUNK).length
      }

      onImported(`✅ Implemented successfully — ${newTeachers.length} teachers and ${written} shifts imported.`)
    } catch (err) {
      console.error(err)
      setError(`Import failed: ${err.message}`)
      setStep('idle')
    }
  }

  return (
    <Modal onClose={onClose} zIndex="z-[3200]" width={step === 'preview' ? 'max-w-xl' : 'max-w-md'}>
      <ModalHeader title="📤 Import Schedule" onClose={onClose} />

      {step === 'idle' && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted -mt-2 leading-relaxed">
            Drag and drop a schedule export CSV sheet (or click below to browse). Schedulers can import dates, times, session types, and addresses in bulk.
          </p>

          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-app rounded-xl py-12 flex flex-col items-center gap-3 bg-transparent hover:border-accent hover:bg-accent-soft transition-all cursor-pointer group"
          >
            <span className="text-4xl transition-transform group-hover:scale-110 duration-200">📊</span>
            <span className="text-sm font-semibold text-muted group-hover:text-primary transition-colors">Drop spreadsheet CSV or click to browse</span>
            <span className="text-xs text-dim">Expected Headers: Date, Start, End, Shift title, Job, Users, Address, Note</span>
          </button>

          {error && (
            <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-4 py-3 text-xs font-semibold leading-relaxed animate-fade-in">
              ⚠️ {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      )}

      {step === 'importing' && (
        <div className="text-center py-10 flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <p className="text-sm text-primary font-semibold">{progress}</p>
        </div>
      )}

      {step === 'preview' && preview && (
        <div className="flex flex-col gap-4 max-h-[75vh] overflow-y-auto pr-1">
          <p className="text-xs text-muted -mt-2">
            Inspect the staged changes below before committing to Firestore.
          </p>

          {/* Quick Metrics */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Staged Shifts', value: preview.shifts.length, color: 'text-accent', bg: 'bg-accent-soft border border-accent/20' },
              { label: 'New Teachers', value: preview.newTeachers.length, color: 'text-ok', bg: 'bg-ok-soft border border-ok/20' },
              { label: 'Session Types', value: preview.newJobs.length, color: 'text-warn', bg: 'bg-warn-soft border border-warn/20' },
            ].map(metric => (
              <div key={metric.label} className={`${metric.bg} rounded-xl p-3 text-center shadow-sm`}>
                <p className={`text-xl font-extrabold ${metric.color}`}>{metric.value}</p>
                <p className="text-[10px] text-muted font-semibold mt-0.5 uppercase tracking-wider">{metric.label}</p>
              </div>
            ))}
          </div>

          {/* New session types indicator */}
          {preview.newJobs.length > 0 && (
            <div className="bg-warn-soft border border-warn/20 rounded-xl p-3 flex gap-2">
              <span className="text-base">⚙️</span>
              <div className="flex-1 text-xs text-warn leading-relaxed">
                <strong>New Session Types Detected:</strong> {preview.newJobs.map(j => `"${j.title}"`).join(', ')}. These will be automatically registered in settings.
              </div>
            </div>
          )}

          {/* Staging Teachers list */}
          {preview.newTeachers.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Staged profiles to create</p>
              <div className="bg-raised border border-app rounded-xl max-h-32 overflow-y-auto divide-y divide-app/30">
                {preview.newTeachers.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold text-white flex-shrink-0"
                      style={{ background: t.color }}>
                      {t.firstName[0]}{t.lastName[0]}
                    </div>
                    <span className="text-xs text-primary font-semibold">{t.firstName} {t.lastName}</span>
                    <span className="ml-auto text-[10px] text-dim font-mono">{t._rawName}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-dim mt-2 leading-relaxed">
                ⚠️ Teacher logins are not created automatically. Remember to send welcome invitations via the **Directory** tab after importing.
              </p>
            </div>
          )}

          {/* Staged Shifts Data Table */}
          <div>
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Shift Preview (First 8 Rows)</p>
            <div className="overflow-x-auto rounded-xl border border-app">
              <table className="w-full border-collapse text-2xs font-mono">
                <thead>
                  <tr className="border-b border-app bg-raised">
                    {['Date', 'Start', 'End', 'Title', 'Instructor'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-muted font-bold uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-app/20 bg-card">
                  {preview.shifts.slice(0, 8).map((s, idx) => (
                    <tr key={idx} className="hover:bg-raised/40 transition-colors">
                      <td className="px-3 py-1.5 text-primary">{s.date}</td>
                      <td className="px-3 py-1.5 text-primary">{s.start}</td>
                      <td className="px-3 py-1.5 text-primary">{s.end}</td>
                      <td className="px-3 py-1.5 text-muted truncate max-w-[140px]" title={s.title}>{s.title}</td>
                      <td className="px-3 py-1.5">
                        {s.claimable ? (
                          <span className="text-warn font-extrabold text-[9px] uppercase tracking-wide">⚡ Open</span>
                        ) : (
                          <span className="text-accent font-semibold">{s._instructorName}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {preview.shifts.length > 8 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-2 text-dim text-center italic bg-raised/20">
                        + {preview.shifts.length - 8} more shifts staged in this CSV file...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <div className="bg-danger-soft border border-danger/30 text-danger rounded-xl px-4 py-3 text-xs font-semibold leading-relaxed">
              ⚠️ {error}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2 pt-2 border-t border-app">
            <Button onClick={() => { setStep('idle'); setPreview(null); setError('') }}>Cancel</Button>
            <Button variant="primary" icon="📥" onClick={doImport}>
              Import {preview.shifts.length} Shifts
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

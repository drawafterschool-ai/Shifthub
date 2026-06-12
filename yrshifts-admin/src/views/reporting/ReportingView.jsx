import { useState, useMemo, useRef } from 'react'
import useScheduleStore  from '../../stores/useScheduleStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import { calcHours }     from '../../utils/time'
import { exportPeriodCSV, exportQuickBooksCSV } from '../../utils/exportCSV'
import Avatar            from '../../components/Avatar'
import Button            from '../../components/Button'
import { writeBatch, doc, collection } from 'firebase/firestore'
import { db }              from '../../utils/firebase'
import { uid }             from '../../utils/helpers'
import Modal, { ModalHeader } from '../../components/Modal'

const YEARS = [2025, 2026, 2027]
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

// Generates biweekly periods of a given year
function getBiweeklyPeriods(year) {
  // Anchor on Sunday, Dec 28, 2025 to align alternating biweekly cycles
  const anchor = new Date(2025, 11, 28)
  const periods = []
  let current = new Date(anchor)

  while (current.getFullYear() <= year) {
    const end = new Date(current)
    end.setDate(end.getDate() + 13) // 14 days duration (start to end inclusive)

    if (current.getFullYear() === year || end.getFullYear() === year) {
      const startKey = current.toISOString().split('T')[0]
      const endKey = end.toISOString().split('T')[0]
      const label = `${current.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
      periods.push({ startKey, endKey, label })
    }
    current.setDate(current.getDate() + 14)
  }
  return periods
}

// ── ImportShiftsModal ────────────────────────────────────────────────────────
function ImportShiftsModal({ existingInstructors, onClose }) {
  const fileRef  = useRef(null)
  const [preview, setPreview] = useState(null)
  const [error,   setError]   = useState('')
  const [step,    setStep]    = useState('idle') // idle | preview | importing | done
  const [progress,setProgress]= useState('')

  const parseDate = (d) => {
    const [m, day, y] = d.trim().split('/')
    return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
  }

  const parseTime = (t) => {
    if (!t) return ''
    const m = t.trim().toLowerCase().match(/^(\d+):(\d+)\s*(am|pm)?$/)
    if (!m) return t
    let h = parseInt(m[1])
    const min = m[2]
    const period = (m[3] || '').toUpperCase()
    if (period === 'PM' && h !== 12) h += 12
    if (period === 'AM' && h === 12) h = 0
    
    const displayPeriod = h >= 12 ? 'PM' : 'AM'
    const displayHour = h % 12 || 12
    return `${displayHour}:${min.padStart(2, '0')} ${displayPeriod}`
  }

  const splitName = (name) => {
    const parts = name.trim().split(' ')
    const first = parts[0]
    const last  = parts.slice(1).join(' ')
    const cap = (s) => s && s === s.toLowerCase() ? s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : s
    return { first: cap(first), last: cap(last) }
  }

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError(''); setPreview(null); setStep('idle')
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
    const lines  = clean.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { setError('File appears empty.'); return }

    const parseRow = (line) => {
      const result = []; let cur = ''; let inQ = false
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') { inQ = !inQ }
        else if (ch === ',' && !inQ) { result.push(cur.trim().replace(/^"|"$/g,'')); cur = '' }
        else cur += ch
      }
      result.push(cur.trim().replace(/^"|"$/g,''))
      return result
    }

    const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[^a-z]/g,''))
    const idx = {
      date:  headers.findIndex(h => h === 'date'),
      start: headers.findIndex(h => h === 'start'),
      end:   headers.findIndex(h => h === 'end'),
      title: headers.findIndex(h => h.includes('shift') || h === 'shifttitle'),
      job:   headers.findIndex(h => h === 'job'),
      users: headers.findIndex(h => h === 'users'),
      addr:  headers.findIndex(h => h === 'address'),
      note:  headers.findIndex(h => h === 'note'),
    }

    if (idx.date < 0 || idx.start < 0 || idx.users < 0) {
      setError('Could not find required columns (Date, Start, Users). Make sure this is a schedule export.')
      return
    }

    const teacherMap  = {}
    const shifts      = []
    const skipped     = []

    lines.slice(1).forEach((line, i) => {
      const row = parseRow(line)
      if (row.length < 3) return

      const job    = idx.job  >= 0 ? row[idx.job]?.trim()   : 'Teach'
      const user   = idx.users >= 0 ? row[idx.users]?.trim() : ''
      const date   = idx.date >= 0  ? row[idx.date]?.trim()  : ''
      const startR = idx.start >= 0 ? row[idx.start]?.trim() : ''
      const endR   = idx.end >= 0   ? row[idx.end]?.trim()   : ''
      const title  = idx.title >= 0 ? row[idx.title]?.trim() : ''
      const addr   = idx.addr >= 0  ? row[idx.addr]?.trim()  : ''
      const note   = idx.note >= 0  ? row[idx.note]?.trim()  : ''

      if (!date || !startR) return

      if (job?.toUpperCase() === 'CANCELLED') {
        skipped.push(`Row ${i+2}: CANCELLED — ${title}`)
        return
      }

      const isOpen = (user === 'Open Shift' || !user)
      let parsedDate = ''
      try { parsedDate = parseDate(date) } catch { return }

      if (!isOpen && user && !teacherMap[user]) {
        const { first, last } = splitName(user)
        teacherMap[user] = {
          id:        uid(),
          firstName: first,
          lastName:  last,
          color:     COLOURS[Object.keys(teacherMap).length % COLOURS.length],
          role:      'teacher',
          email:     '',
          phone:     '',
          photo:     null,
          _rawName:  user,
        }
      }

      shifts.push({
        id:          uid(),
        seriesId:    uid(),
        date:        parsedDate,
        start:       parseTime(startR),
        end:         parseTime(endR),
        title,
        job:         job || 'Teach',
        address:     addr,
        note,
        claimable:   isOpen,
        instructorId: null,
        _instructorName: isOpen ? null : user,
        status:      'published',
        attachments: [],
        skipDates:   [],
        confirmationStatus: 'confirmed',
        students:    null,
      })
    })

    const existing = new Set(existingInstructors.map(i => `${i.firstName} ${i.lastName}`.toLowerCase()))
    const newTeachers = Object.values(teacherMap).filter(t =>
      !existing.has(`${t.firstName} ${t.lastName}`.toLowerCase())
    )

    setPreview({ shifts, newTeachers, allTeachers: teacherMap, skipped })
    setStep('preview')
  }

  const doImport = async () => {
    if (!preview) return
    setStep('importing')

    const { shifts, newTeachers, allTeachers } = preview

    setProgress(`Creating ${newTeachers.length} teacher profiles…`)
    const teacherBatch = writeBatch(db)
    newTeachers.forEach(t => {
      teacherBatch.set(doc(db, 'users', t.id), t)
    })
    if (newTeachers.length) await teacherBatch.commit()

    const nameToId = {}
    existingInstructors.forEach(i => {
      nameToId[`${i.firstName} ${i.lastName}`.toLowerCase()] = String(i.id)
    })
    newTeachers.forEach(t => {
      nameToId[`${t.firstName} ${t.lastName}`.toLowerCase()] = t.id
      nameToId[t._rawName.toLowerCase()] = t.id
    })
    Object.values(allTeachers).forEach(t => {
      if (t._rawName) nameToId[t._rawName.toLowerCase()] = nameToId[`${t.firstName} ${t.lastName}`.toLowerCase()] || t.id
    })

    const resolved = shifts.map(s => {
      const copy = { ...s }
      delete copy._instructorName
      if (s._instructorName) {
        const rid = nameToId[s._instructorName.toLowerCase()]
        if (rid) copy.instructorId = rid
      }
      return copy
    })

    const CHUNK = 400
    let written = 0
    for (let i = 0; i < resolved.length; i += CHUNK) {
      setProgress(`Importing shifts ${i+1}–${Math.min(i+CHUNK, resolved.length)} of ${resolved.length}…`)
      const batch = writeBatch(db)
      resolved.slice(i, i + CHUNK).forEach(s => {
        batch.set(doc(collection(db, 'shifts'), s.id), s)
      })
      await batch.commit()
      written += resolved.slice(i, i + CHUNK).length
    }

    setStep('done')
    setProgress(`✅ Done — ${newTeachers.length} teachers and ${written} shifts imported.`)
  }

  const COLOURS = ['#6366F1','#0EA5E9','#10B981','#EC4899','#F59E0B',
                   '#EF4444','#8B5CF6','#14B8A6','#F97316','#06B6D4']

  return (
    <Modal onClose={onClose} width="max-w-xl">
      <ModalHeader title="📊 Import Past Shifts from CSV" onClose={onClose} />
      <div className="p-1 space-y-4">
        {step === 'idle' && (
          <div className="space-y-4">
            <p className="text-xs text-muted leading-relaxed">
              Upload a schedule CSV file to import past shifts directly into ShiftHub. The importer automatically parses shift details, maps teacher assignments, and flags new teacher profiles.
            </p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full border-2 border-dashed border-app rounded-xl py-10 flex flex-col items-center gap-2 cursor-pointer bg-transparent hover:border-accent hover:bg-accent-soft transition-all text-center">
              <span className="text-3xl">📥</span>
              <span className="text-sm font-semibold text-primary">Drop CSV file or click to browse</span>
              <span className="text-xs text-muted">Supports columns: Date, Start, End, Shift title, Job, Users, Address, Note</span>
              <span className="text-2xs text-dim font-mono">Example time formats: 02:00pm, 2:15 pm, 14:00</span>
            </button>
            {error && <p className="text-xs text-danger font-semibold">⚠️ {error}</p>}
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Shifts',         value: preview.shifts.length,     color: 'text-accent',  bg: 'bg-accent-soft' },
                { label: 'New teachers',   value: preview.newTeachers.length, color: 'text-ok',     bg: 'bg-ok-soft'     },
                { label: 'Cancelled Rows', value: preview.skipped.length, color: 'text-dim',  bg: 'bg-raised'      },
              ].map(s => (
                <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
                  <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {preview.newTeachers.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted uppercase tracking-wide">New teacher profiles to create</p>
                <div className="bg-raised border border-app rounded-xl overflow-hidden max-h-36 overflow-y-auto">
                  {preview.newTeachers.map((t, i) => (
                    <div key={t.id} className={`flex items-center gap-3 px-3 py-2 ${i < preview.newTeachers.length-1 ? 'border-b border-app/30' : ''}`}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-3xs font-bold text-white flex-shrink-0"
                        style={{ background: t.color }}>
                        {t.firstName[0]}{t.lastName[0]}
                      </div>
                      <span className="text-xs text-primary font-medium">{t.firstName} {t.lastName}</span>
                      <span className="ml-auto text-xs text-dim">{t._rawName}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-bold text-muted uppercase tracking-wide">Shifts Preview (first 5)</p>
              <div className="overflow-auto rounded-xl border border-app text-[11px] font-mono">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b border-app bg-raised text-left">
                      {['Date','Start','End','Session','Instructor'].map(h => (
                        <th key={h} className="px-3 py-2 text-muted font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.shifts.slice(0, 5).map((s, i) => (
                      <tr key={i} className="border-b border-app/30 last:border-0">
                        <td className="px-3 py-1.5 text-primary">{s.date}</td>
                        <td className="px-3 py-1.5 text-primary">{s.start}</td>
                        <td className="px-3 py-1.5 text-primary">{s.end}</td>
                        <td className="px-3 py-1.5 text-muted truncate max-w-[150px]">{s.title}</td>
                        <td className="px-3 py-1.5">
                          {s.claimable
                            ? <span className="text-warn font-bold">⚡ Open</span>
                            : <span className="text-accent">{s._instructorName}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button onClick={() => { setStep('idle'); setPreview(null) }}>Cancel</Button>
              <Button variant="publish" onClick={doImport} icon="📥">
                Import {preview.shifts.length} shifts
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="text-center py-8 space-y-4">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto" />
            <p className="text-sm text-primary font-medium">{progress}</p>
          </div>
        )}

        {step === 'done' && (
          <div className="text-center py-6 space-y-4">
            <p className="text-4xl">🎉</p>
            <p className="text-sm font-semibold text-primary">{progress}</p>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default function ReportingView() {
  const { schedule, jobs, loading: scheduleLoading } = useScheduleStore()
  const { instructors, loading: dirLoading } = useDirectoryStore()

  const [reportMode, setReportMode] = useState('monthly') // 'monthly' | 'biweekly'
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [selectedBiweeklyIndex, setSelectedBiweeklyIndex] = useState(0)
  const [showImportModal, setShowImportModal] = useState(false)

  const loading = scheduleLoading || dirLoading

  // Compute biweekly list for selected year
  const biweeklyPeriods = useMemo(() => {
    return getBiweeklyPeriods(selectedYear)
  }, [selectedYear])

  // Get active period boundaries
  const period = useMemo(() => {
    if (reportMode === 'monthly') {
      const monthStr = String(selectedMonth).padStart(2, '0')
      const startKey = `${selectedYear}-${monthStr}-01`
      const lastDay = new Date(selectedYear, selectedMonth, 0).getDate()
      const endKey = `${selectedYear}-${monthStr}-${String(lastDay).padStart(2, '0')}`
      const monthLabel = `${MONTHS[selectedMonth - 1]} ${selectedYear}`
      return { startKey, endKey, label: monthLabel }
    } else {
      const activePeriod = biweeklyPeriods[selectedBiweeklyIndex] || biweeklyPeriods[0]
      return activePeriod ? { ...activePeriod } : { startKey: '', endKey: '', label: '' }
    }
  }, [reportMode, selectedYear, selectedMonth, selectedBiweeklyIndex, biweeklyPeriods])

  // Compile calculations for teachers payroll
  const payrollBreakdown = useMemo(() => {
    if (loading || !period.startKey || !period.endKey) return []

    const breakdown = []
    instructors.forEach(inst => {
      const ownerShifts = schedule[String(inst.id)] || {}
      let instHours = 0
      let instPay = 0
      let hasShifts = false

      Object.entries(ownerShifts).forEach(([dateKey, arr]) => {
        if (dateKey >= period.startKey && dateKey <= period.endKey) {
          arr.forEach(s => {
            if (s.status === 'cancelled' || s.job === 'cancelled') return
            if (s.confirmationStatus !== 'confirmed') return

            const calc = calcHours(s.start, s.end)
            const hours = s.hoursWorked != null ? Number(s.hoursWorked) : (calc?.decimal || 0)
            const total = Number(s.totalPay || 0)

            instHours += hours
            instPay += total
            hasShifts = true
          })
        }
      });

      if (hasShifts) {
        breakdown.push({
          instructor: inst,
          hours: instHours,
          pay: instPay,
          avgRate: instHours > 0 ? instPay / instHours : 0
        })
      }
    })

    return breakdown.sort((a, b) => b.pay - a.pay)
  }, [loading, schedule, instructors, period])

  // Calculate summary metrics
  const summary = useMemo(() => {
    let totalHours = 0
    let totalPay = 0
    payrollBreakdown.forEach(item => {
      totalHours += item.hours
      totalPay += item.pay
    })
    return {
      totalHours,
      totalPay,
      activeInstructors: payrollBreakdown.length
    }
  }, [payrollBreakdown])

  const handleExport = () => {
    if (!period.startKey || !period.endKey) return
    exportPeriodCSV(schedule, instructors, jobs, period.startKey, period.endKey, period.label)
  }

  const handleExportQuickBooks = () => {
    if (!period.startKey || !period.endKey) return
    exportQuickBooksCSV(schedule, instructors, jobs, period.startKey, period.endKey, period.label)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <p className="text-sm text-muted">Loading payroll data…</p>
      </div>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">
      
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-app bg-surface flex-shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-primary">Payroll Reporting</h1>
          <p className="text-xs text-muted mt-0.5">Calculate wages and export payroll registers</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowImportModal(true)} icon="📊">
            Import Past Shifts
          </Button>
          <Button variant="primary" icon="📥" onClick={handleExport} disabled={payrollBreakdown.length === 0}>
            Export to CSV
          </Button>
          <Button variant="publish" icon="💼" onClick={handleExportQuickBooks} disabled={payrollBreakdown.length === 0}>
            Export to QuickBooks
          </Button>
        </div>
      </div>

      {/* Main View Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* Configuration Card */}
        <div className="bg-card border border-app rounded-2xl p-6">
          <h2 className="text-sm font-bold text-primary mb-4 uppercase tracking-wider text-dim">
            Reporting Period Configuration
          </h2>
          
          <div className="flex flex-wrap gap-6 items-end">
            
            {/* Mode Select */}
            <div className="w-48">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Pay Schedule Mode
              </label>
              <select 
                value={reportMode} 
                onChange={e => {
                  setReportMode(e.target.value)
                  setSelectedBiweeklyIndex(0)
                }}
                className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
              >
                <option value="monthly">Monthly</option>
                <option value="biweekly">Biweekly (Every 2 weeks)</option>
              </select>
            </div>

            {/* Year Select */}
            <div className="w-28">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                Year
              </label>
              <select 
                value={selectedYear} 
                onChange={e => {
                  setSelectedYear(Number(e.target.value))
                  setSelectedBiweeklyIndex(0)
                }}
                className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
              >
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            {/* Dynamic Period selector */}
            {reportMode === 'monthly' ? (
              <div className="w-48">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Month
                </label>
                <select 
                  value={selectedMonth} 
                  onChange={e => setSelectedMonth(Number(e.target.value))}
                  className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                >
                  {MONTHS.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                </select>
              </div>
            ) : (
              <div className="flex-1 min-w-[280px]">
                <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
                  Biweekly Pay Period Interval
                </label>
                <select 
                  value={selectedBiweeklyIndex} 
                  onChange={e => setSelectedBiweeklyIndex(Number(e.target.value))}
                  className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors appearance-none cursor-pointer"
                >
                  {biweeklyPeriods.map((bp, i) => (
                    <option key={i} value={i}>{bp.label}</option>
                  ))}
                </select>
              </div>
            )}

          </div>
        </div>

        {/* Payroll Metric Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <div className="bg-card border border-app rounded-2xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent-soft text-accent text-2xl flex items-center justify-center flex-shrink-0">
              🕐
            </div>
            <div>
              <p className="text-xs font-bold text-muted uppercase tracking-wider">Total hours worked</p>
              <p className="text-2xl font-extrabold text-primary mt-1">
                {summary.totalHours.toFixed(2)} <span className="text-sm font-semibold text-muted">hrs</span>
              </p>
            </div>
          </div>

          <div className="bg-card border border-app rounded-2xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-ok-soft text-ok text-2xl flex items-center justify-center flex-shrink-0">
              💵
            </div>
            <div>
              <p className="text-xs font-bold text-muted uppercase tracking-wider">Total gross payroll</p>
              <p className="text-2xl font-extrabold text-accent mt-1">
                ${summary.totalPay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
          </div>

          <div className="bg-card border border-app rounded-2xl p-6 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 text-purple-400 text-2xl flex items-center justify-center flex-shrink-0">
              👥
            </div>
            <div>
              <p className="text-xs font-bold text-muted uppercase tracking-wider">Scheduled instructors</p>
              <p className="text-2xl font-extrabold text-primary mt-1">
                {summary.activeInstructors} <span className="text-sm font-semibold text-muted">teachers</span>
              </p>
            </div>
          </div>

        </div>

        {/* Detailed Breakdown Grid */}
        <div className="bg-card border border-app rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-app flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary uppercase tracking-wider text-dim">
              Payroll Register Breakdown
            </h3>
            <span className="text-2xs bg-raised border border-app rounded-md px-2.5 py-1 text-muted font-mono uppercase font-bold tracking-wider">
              {period.label}
            </span>
          </div>

          {payrollBreakdown.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-3xl mb-2">📊</p>
              <p className="text-sm font-semibold text-muted">No shifts or pay records found for this period.</p>
              <p className="text-xs text-dim mt-1">Try selecting a different year, month, or pay period bracket.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-raised border-b border-app text-2xs uppercase tracking-wider text-muted font-bold">
                    <th className="px-6 py-3">Instructor</th>
                    <th className="px-6 py-3 text-center">Hours Worked</th>
                    <th className="px-6 py-3 text-right">Avg Rate/hr</th>
                    <th className="px-6 py-3 text-right">Gross Salary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-app/40">
                  {payrollBreakdown.map(item => (
                    <tr key={item.instructor.id} className="hover:bg-raised/40 transition-colors text-sm">
                      <td className="px-6 py-3.5 flex items-center gap-2.5">
                        <Avatar 
                          firstName={item.instructor.firstName} 
                          lastName={item.instructor.lastName} 
                          color={item.instructor.color} 
                          photo={item.instructor.photo} 
                          size={28} 
                        />
                        <div className="min-w-0">
                          <p className="font-bold text-primary leading-tight truncate">
                            {item.instructor.firstName} {item.instructor.lastName}
                          </p>
                          <p className="text-3xs text-dim font-semibold tracking-wide uppercase mt-0.5">
                            {item.instructor.role || 'Teacher'}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-3.5 text-center font-mono">
                        <span className="bg-raised border border-app rounded-lg px-2.5 py-1 font-bold text-primary">
                          {item.hours.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-6 py-3.5 text-right font-mono text-muted">
                        ${item.avgRate.toFixed(2)}
                      </td>
                      <td className="px-6 py-3.5 text-right font-mono font-extrabold text-accent">
                        ${item.pay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>

      {showImportModal && (
        <ImportShiftsModal
          existingInstructors={instructors}
          onClose={() => setShowImportModal(false)}
        />
      )}
    </div>
  )
}

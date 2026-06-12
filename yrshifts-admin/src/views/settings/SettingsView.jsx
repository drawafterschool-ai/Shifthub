import { useState, useRef, useEffect } from 'react'
import { writeBatch, doc, collection, setDoc } from 'firebase/firestore'
import { db }              from '../../utils/firebase'
import useSettingsStore    from '../../stores/useSettingsStore'
import useScheduleStore    from '../../stores/useScheduleStore'
import useAuthStore        from '../../stores/useAuthStore'
import useDirectoryStore   from '../../stores/useDirectoryStore'
import { uid }             from '../../utils/helpers'
import Button              from '../../components/Button'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'
import { isBiometricsSupported, registerBiometrics, disableBiometrics, isBiometricsEnabled } from '../../utils/biometric'

const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"
const COLOURS = ['#6366F1','#0EA5E9','#10B981','#EC4899','#F59E0B',
                 '#EF4444','#8B5CF6','#14B8A6','#F97316','#06B6D4']

function Section({ icon, title, description, children }) {
  return (
    <div className="bg-card border border-app rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-accent-soft border border-accent/20 flex items-center justify-center text-xl flex-shrink-0">{icon}</div>
        <div>
          <h3 className="text-base font-bold text-primary">{title}</h3>
          {description && <p className="text-xs text-dim mt-0.5">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

function TierRow({ tier, onChange, onDelete }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 flex-1">
        <span className="text-xs text-muted w-12 text-right flex-shrink-0">≤</span>
        <input type="number" value={tier.maxStudents} min={1} max={99}
          onChange={e => onChange({ ...tier, maxStudents: Number(e.target.value) })}
          className={`${INPUT} w-20 text-center`} />
        <span className="text-xs text-muted flex-shrink-0">students</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-accent font-bold text-sm">$</span>
        <input type="number" value={tier.ratePerHour} min={0} step={0.5}
          onChange={e => onChange({ ...tier, ratePerHour: Number(e.target.value) })}
          className={`${INPUT} w-24 text-center`} />
        <span className="text-xs text-muted">/hr</span>
      </div>
      <button onClick={onDelete} className="text-dim hover:text-danger cursor-pointer bg-transparent border-none text-base flex-shrink-0">🗑</button>
    </div>
  )
}

// ── Connecteam importer ───────────────────────────────────────────────────────
function ConnecteamImporter({ existingInstructors }) {
  const fileRef  = useRef(null)
  const [preview, setPreview] = useState(null)  // { shifts, teachers, skipped }
  const [error,   setError]   = useState('')
  const [step,    setStep]    = useState('idle') // idle | preview | importing | done
  const [progress,setProgress]= useState('')

  const parseDate = (d) => {
    const [m, day, y] = d.trim().split('/')
    return `${y}-${m.padStart(2,'0')}-${day.padStart(2,'0')}`
  }

  const parseTime = (t) => {
    const m = t.trim().toLowerCase().match(/^(\d+):(\d+)(am|pm)$/)
    if (!m) return t
    return `${parseInt(m[1])}:${m[2]} ${m[3].toUpperCase()}`
  }

  const splitName = (name) => {
    const parts = name.trim().split(' ')
    const first = parts[0]
    const last  = parts.slice(1).join(' ')
    // Capitalise if fully lowercase
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
    // Remove BOM if present
    const clean = text.replace(/^\uFEFF/, '')
    const lines  = clean.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { setError('File appears empty.'); return }

    // Parse CSV properly (handle quoted fields with commas)
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
    // Expected: date, start, end, shifttitle, job, users, address, note
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
      setError('Could not find required columns (Date, Start, Users). Make sure this is a Connecteam schedule export.')
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

      // Skip cancelled
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
        instructorId: null,  // resolved after directory import
        _instructorName: isOpen ? null : user,
        status:      'published',
        attachments: [],
        skipDates:   [],
        confirmationStatus: null,
        students:    null,
      })
    })

    // Filter out teachers already in directory
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

    // 1. Write new teacher profiles to Firestore
    setProgress(`Creating ${newTeachers.length} teacher profiles…`)
    const teacherBatch = writeBatch(db)
    newTeachers.forEach(t => {
      teacherBatch.set(doc(db, 'users', t.id), t)
    })
    if (newTeachers.length) await teacherBatch.commit()

    // 2. Build name→id map (new + existing)
    const nameToId = {}
    existingInstructors.forEach(i => {
      nameToId[`${i.firstName} ${i.lastName}`.toLowerCase()] = String(i.id)
    })
    newTeachers.forEach(t => {
      nameToId[`${t.firstName} ${t.lastName}`.toLowerCase()] = t.id
      nameToId[t._rawName.toLowerCase()] = t.id
    })
    // Also map raw Connecteam names for all teachers
    Object.values(allTeachers).forEach(t => {
      if (t._rawName) nameToId[t._rawName.toLowerCase()] = nameToId[`${t.firstName} ${t.lastName}`.toLowerCase()] || t.id
    })

    // 3. Resolve instructorId on each shift
    const resolved = shifts.map(s => {
      const copy = { ...s }
      delete copy._instructorName
      if (s._instructorName) {
        const rid = nameToId[s._instructorName.toLowerCase()]
        if (rid) copy.instructorId = rid
      }
      return copy
    })

    // 4. Write shifts in batches of 400
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

  if (step === 'done') return (
    <div className="text-center py-6">
      <p className="text-3xl mb-3">✅</p>
      <p className="text-sm font-semibold text-primary">{progress}</p>
      <button onClick={() => { setStep('idle'); setPreview(null) }}
        className="mt-4 text-xs text-accent font-semibold cursor-pointer bg-transparent border-none">Import another file</button>
    </div>
  )

  if (step === 'importing') return (
    <div className="text-center py-6">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin mx-auto mb-4" />
      <p className="text-sm text-muted">{progress}</p>
    </div>
  )

  if (step === 'preview' && preview) return (
    <div>
      {/* Summary banner */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        {[
          { label: 'Shifts',         value: preview.shifts.length,     color: 'text-accent',  bg: 'bg-accent-soft' },
          { label: 'New teachers',   value: preview.newTeachers.length, color: 'text-ok',     bg: 'bg-ok-soft'     },
          { label: 'Skipped (CANCELLED)', value: preview.skipped.length, color: 'text-dim',  bg: 'bg-raised'      },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-3 text-center`}>
            <p className={`text-2xl font-extrabold ${s.color}`}>{s.value}</p>
            <p className="text-xs text-muted mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* New teachers list */}
      {preview.newTeachers.length > 0 && (
        <div className="mb-5">
          <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">New teacher profiles to create</p>
          <div className="bg-raised border border-app rounded-xl overflow-hidden">
            {preview.newTeachers.map((t, i) => (
              <div key={t.id} className={`flex items-center gap-3 px-3 py-2 ${i < preview.newTeachers.length-1 ? 'border-b border-app/30' : ''}`}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: t.color }}>
                  {t.firstName[0]}{t.lastName[0]}
                </div>
                <span className="text-sm text-primary font-medium">{t.firstName} {t.lastName}</span>
                <span className="ml-auto text-xs text-dim">{t._rawName}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-dim mt-2">
            ⚠️ You'll still need to create their Firebase login — use the 📧 Invite button in the Directory after importing.
          </p>
        </div>
      )}

      {/* Shift preview table */}
      <div className="mb-5">
        <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Shift preview (first 8)</p>
        <div className="overflow-auto rounded-xl border border-app text-xs font-mono">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-app bg-raised">
                {['Date','Start','End','Session','Instructor'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-muted font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.shifts.slice(0, 8).map((s, i) => (
                <tr key={i} className="border-b border-app/30">
                  <td className="px-3 py-1.5 text-primary">{s.date}</td>
                  <td className="px-3 py-1.5 text-primary">{s.start}</td>
                  <td className="px-3 py-1.5 text-primary">{s.end}</td>
                  <td className="px-3 py-1.5 text-muted truncate max-w-[180px]">{s.title}</td>
                  <td className="px-3 py-1.5">
                    {s.claimable
                      ? <span className="text-warn font-bold">⚡ Open</span>
                      : <span className="text-accent">{s._instructorName}</span>}
                  </td>
                </tr>
              ))}
              {preview.shifts.length > 8 && (
                <tr><td colSpan={5} className="px-3 py-2 text-dim">+{preview.shifts.length - 8} more shifts…</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => { setStep('idle'); setPreview(null) }}>Cancel</Button>
        <Button variant="primary" onClick={doImport} icon="📥">
          Import {preview.shifts.length} shifts + {preview.newTeachers.length} teachers
        </Button>
      </div>
    </div>
  )

  // Idle state — dropzone
  return (
    <div>
      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
      <button onClick={() => fileRef.current?.click()}
        className="w-full border-2 border-dashed border-app rounded-xl py-10 flex flex-col items-center gap-2 cursor-pointer bg-transparent hover:border-accent hover:bg-accent-soft transition-all">
        <span className="text-3xl">📊</span>
        <span className="text-sm font-semibold text-muted">Drop Connecteam CSV or click to browse</span>
        <span className="text-xs text-dim">Schedule Export → CSV from Connecteam</span>
        <span className="text-xs font-mono text-dim">Columns: Date, Start, End, Shift title, Job, Users, Address, Note</span>
      </button>
      {error && <p className="mt-3 text-sm text-danger font-semibold">⚠️ {error}</p>}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsView() {
  const { companyName, payrollTiers, save, loading } = useSettingsStore()
  const { signOut }      = useAuthStore()
  const { instructors }  = useDirectoryStore()

  const [name,   setName]   = useState('')
  const [tiers,  setTiers]  = useState([])
  const [jobs,   setJobs]   = useState([])
  const [saved,  setSaved]  = useState(false)
  const [saving, setSaving] = useState(false)
  const [danger, setDanger] = useState(false)

  const [bioSupported, setBioSupported] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [bioError, setBioError] = useState('')

  useEffect(() => {
    async function checkBio() {
      const supported = await isBiometricsSupported()
      setBioSupported(supported)
      setBioEnabled(isBiometricsEnabled())
    }
    checkBio()
  }, [])

  const handleDisableBio = () => {
    disableBiometrics()
    setBioEnabled(false)
    setConfirmPassword('')
    setBioError('')
  }

  const handleEnableBio = async () => {
    setBioError('')
    try {
      const email = useAuthStore.getState().user?.email
      if (!email) throw new Error('You must be signed in to configure biometrics')
      await registerBiometrics(email, confirmPassword)
      setBioEnabled(true)
      setConfirmPassword('')
    } catch (err) {
      console.warn(err)
      setBioError(err.message || 'Verification or sensor prompt failed.')
    }
  }

  // Sync from store once loaded
  const { jobs: storeJobs } = useScheduleStore()

  useEffect(() => {
    if (!loading) {
      setName(companyName || '')
      setTiers(payrollTiers || [])
    }
  }, [loading, companyName, payrollTiers])

  useEffect(() => {
    if (storeJobs?.length) setJobs(storeJobs)
    else setJobs([
      { id: 'teach',     title: 'Teach',     color: '#4ade80' },
      { id: 'workshop',  title: 'Workshop',  color: '#7dd3fc' },
      { id: 'assist',    title: 'Assist',    color: '#f9a8d4' },
      { id: 'sub',       title: 'Sub',       color: '#fca5a5' },
      { id: 'cancelled', title: 'Cancelled', color: '#9ca3af' },
    ])
  }, [storeJobs])

  const handleSaveGeneral = async () => {
    setSaving(true)
    await save({ companyName: name })
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  const handleSaveJobs = async () => {
    setSaving(true)
    await save({ jobs })
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  const handleSavePayroll = async () => {
    setSaving(true)
    await save({ payrollTiers: tiers })
    setSaved(true); setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  const updateTier = (idx, updated) => setTiers(t => t.map((x,i) => i===idx ? updated : x))
  const deleteTier = (idx)          => setTiers(t => t.filter((_,i) => i!==idx))
  const addTier    = ()             => setTiers(t => [...t, { id: uid(), maxStudents: 20, ratePerHour: 45 }])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 overflow-auto bg-app">
      <div className="max-w-2xl mx-auto px-6 py-8 flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">Settings</h1>
          <p className="text-sm text-dim mt-1">Configure your ShiftHub workspace</p>
        </div>

        {saved && (
          <div className="bg-ok-soft border border-ok/30 text-ok rounded-xl px-4 py-3 text-sm font-semibold">
            ✅ Saved successfully
          </div>
        )}

        <Section icon="🏢" title="Company profile" description="Name shown across the app">
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Company name</label>
              <input value={name} onChange={e => setName(e.target.value)} className={INPUT} placeholder="Young Rembrandts" />
            </div>
            <Button variant="primary" onClick={handleSaveGeneral} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Section>

        <Section icon="📋" title="Session types" description="Job types shown in the shift panel dropdown">
          <div className="flex flex-col gap-3 mb-4">
            {jobs.map((job, idx) => (
              <div key={job.id} className="flex items-center gap-3">
                <input type="color" value={job.color || '#4EA8D6'}
                  onChange={e => setJobs(j => j.map((x,i) => i===idx ? {...x, color: e.target.value} : x))}
                  className="w-9 h-9 rounded-lg border border-app cursor-pointer flex-shrink-0 p-0.5 bg-raised" />
                <input value={job.title} onChange={e => setJobs(j => j.map((x,i) => i===idx ? {...x, title: e.target.value} : x))}
                  className={`${INPUT} flex-1`} placeholder="e.g. Teach" />
                <button onClick={() => setJobs(j => j.filter((_,i) => i!==idx))}
                  className="text-dim hover:text-danger cursor-pointer bg-transparent border-none text-base flex-shrink-0">🗑</button>
              </div>
            ))}
            {jobs.length === 0 && <p className="text-sm text-dim">No session types yet</p>}
          </div>
          <div className="flex gap-2">
            <Button small onClick={() => setJobs(j => [...j, { id: uid(), title: '', color: '#4EA8D6' }])} icon="+">Add type</Button>
            <Button small variant="primary" onClick={handleSaveJobs} disabled={saving}>
              {saving ? 'Saving…' : 'Save types'}
            </Button>
          </div>
        </Section>

        <Section icon="💵" title="Payroll tiers" description="Hourly rate per student count bracket">
          <div className="flex flex-col gap-3 mb-4">
            {tiers.map((tier, idx) => (
              <TierRow key={tier.id||idx} tier={tier}
                onChange={updated => updateTier(idx, updated)}
                onDelete={() => deleteTier(idx)} />
            ))}
            {tiers.length === 0 && <p className="text-sm text-dim text-center py-3">No tiers yet</p>}
          </div>
          <div className="flex gap-2">
            <Button small onClick={addTier} icon="+">Add tier</Button>
            <Button small variant="primary" onClick={handleSavePayroll} disabled={saving}>
              {saving ? 'Saving…' : 'Save tiers'}
            </Button>
          </div>
        </Section>

        <Section icon="📊" title="Import from Connecteam"
          description="Import your schedule CSV — auto-creates teacher profiles and links shifts to them">
          <ConnecteamImporter existingInstructors={instructors} />
        </Section>

        <Section icon="📆" title="Calendar sync" description="Teachers receive calendar invites with every shift email">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-ok-soft border border-ok/30 rounded-xl">
              <span>✅</span>
              <p className="text-xs text-ok font-semibold">.ics calendar files attached to every shift assignment email</p>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              When you assign a shift, the teacher receives an email with a <strong>calendar invite (.ics)</strong> attached.
              Tapping it adds the shift directly to Google Calendar, Apple Calendar, or Outlook — no login required.
            </p>
            <div className="bg-raised border border-app rounded-xl p-4">
              <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Add all shifts to your calendar</p>
              <p className="text-xs text-dim mb-3">Copy this URL into Google Calendar → Other calendars → From URL:</p>
              <div className="flex gap-2">
                <code className="flex-1 bg-app border border-app rounded-lg px-3 py-2 text-xs text-accent overflow-hidden truncate">
                  webcal://yrshifts.web.app/app/shifts.ics
                </code>
                <button onClick={() => navigator.clipboard.writeText('webcal://yrshifts.web.app/app/shifts.ics').then(() => alert('Copied!'))}
                  className="px-3 py-2 rounded-lg bg-accent text-white text-xs font-bold cursor-pointer border-none flex-shrink-0">
                  Copy
                </button>
              </div>
            </div>
          </div>
        </Section>

        <Section icon="🔒" title="Biometric Quick Login" description="Use device biometrics (Face ID / Touch ID / fingerprint) for instant sign-in on this browser.">
          {!bioSupported ? (
            <div className="text-xs text-muted leading-relaxed">
              ⚠️ Biometric quick login is not supported by this device or browser.
            </div>
          ) : bioEnabled ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ok font-semibold">🧬 Biometrics active on this device</p>
                <p className="text-2xs text-dim">You will be logged in automatically using Face ID / fingerprint.</p>
              </div>
              <Button variant="danger" onClick={handleDisableBio}>Disable Biometrics</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-muted leading-relaxed">
                To enable quick login, please confirm your current login password. This is securely saved in your local sandbox to perform background Firebase authentication.
              </p>
              {bioError && (
                <p className="text-xs text-danger font-semibold">⚠️ {bioError}</p>
              )}
              <div className="flex gap-2">
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className={`${INPUT} flex-1`}
                />
                <Button variant="primary" onClick={handleEnableBio} disabled={!confirmPassword}>
                  Enable Biometrics
                </Button>
              </div>
            </div>
          )}
        </Section>

        <Section icon="⚙️" title="Account">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between py-3 border-b border-app/50">
              <div>
                <p className="text-sm font-semibold text-primary">Sign out</p>
                <p className="text-xs text-dim">Sign out of this device</p>
              </div>
              <Button variant="ghost" onClick={signOut}>Sign out</Button>
            </div>
            <div className="flex items-center justify-between py-3">
              <div>
                <p className="text-sm font-semibold text-danger">Danger zone</p>
                <p className="text-xs text-dim">Irreversible actions</p>
              </div>
              <Button variant="danger" onClick={() => setDanger(true)}>View options</Button>
            </div>
          </div>
        </Section>
      </div>

      {danger && (
        <Modal onClose={() => setDanger(false)} width="max-w-sm">
          <ModalHeader title="⚠️ Danger zone" onClose={() => setDanger(false)} />
          <div className="flex flex-col gap-3">
            {[
              { label: 'Clear all shifts',        desc: 'Permanently delete every shift' },
              { label: 'Reset all notifications', desc: 'Delete all notification records' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between gap-3 p-3 bg-danger-soft border border-danger/20 rounded-xl">
                <div>
                  <p className="text-sm font-bold text-danger">{item.label}</p>
                  <p className="text-xs text-muted mt-0.5">{item.desc}</p>
                </div>
                <button onClick={() => alert('Not implemented in this build')}
                  className="px-3 py-1.5 bg-danger text-white text-xs font-bold rounded-lg cursor-pointer border-none hover:opacity-90 flex-shrink-0">Run</button>
              </div>
            ))}
          </div>
          <ModalFooter><Button onClick={() => setDanger(false)}>Close</Button></ModalFooter>
        </Modal>
      )}
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { useOutletContext }   from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions }     from '../../utils/firebase'
import useDirectoryStore from '../../stores/useDirectoryStore'
import useAuthStore      from '../../stores/useAuthStore'
import { uid, formatPhone } from '../../utils/helpers'
import Avatar  from '../../components/Avatar'
import Button  from '../../components/Button'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'

const COLOURS = ['#6366F1','#0EA5E9','#10B981','#EC4899','#F59E0B',
                 '#EF4444','#8B5CF6','#14B8A6','#F97316','#06B6D4']

function ColourPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mt-1.5">
      {COLOURS.map(c => (
        <button key={c} onClick={() => onChange(c)}
          className="w-6 h-6 rounded-full border-2 cursor-pointer transition-transform hover:scale-110 flex-shrink-0"
          style={{ background: c, borderColor: value === c ? '#fff' : 'transparent' }} />
      ))}

    </div>
  )
}

// ── Add instructor modal ───────────────────────────────────────────────────────
function AddModal({ onClose }) {
  const { addInstructor } = useDirectoryStore()
  const [fn,  setFn]  = useState('')
  const [ln,  setLn]  = useState('')
  const [em,  setEm]  = useState('')
  const [ph,  setPh]  = useState('')
  const [col, setCol] = useState(COLOURS[Math.floor(Math.random() * COLOURS.length)])
  const [saving, setSaving] = useState(false)
  const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

  const handleAdd = async () => {
    if (!fn.trim()) return
    setSaving(true)
    try {
      if (em.trim()) {
        // Has email — use Cloud Function so Auth UID = Firestore doc ID
        const callFn = httpsCallable(functions, 'createTeacherAccount')
        await callFn({ firstName: fn.trim(), lastName: ln.trim(), email: em.trim(), phone: ph.trim(), color: col })
      } else {
        // No email yet — add profile only, invite later
        await addInstructor({
          id: uid(), firstName: fn.trim(), lastName: ln.trim(),
          email: '', phone: ph.trim(), role: 'teacher', color: col, photo: null,
        })
      }
      onClose()
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add instructor" onClose={onClose} />
      <div className="flex flex-col gap-3.5">
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">First name *</label>
            <input value={fn} onChange={e => setFn(e.target.value)} autoFocus className={INPUT} />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Last name</label>
            <input value={ln} onChange={e => setLn(e.target.value)} className={INPUT} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Email</label>
          <input type="email" value={em} onChange={e => setEm(e.target.value)} className={INPUT} placeholder="teacher@example.com" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Phone</label>
          <input value={ph} onChange={e => setPh(e.target.value)} className={INPUT} placeholder="6125550100" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Colour</label>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: col }} />
            <ColourPicker value={col} onChange={setCol} />
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleAdd} disabled={!fn.trim() || saving}>
          {saving ? 'Adding…' : 'Add instructor'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ── Invite modal ───────────────────────────────────────────────────────────────
// ── Invite modal ───────────────────────────────────────────────────────────────
function InviteModal({ instructor, onClose }) {
  const isNew = !instructor?.firstName  // opened from toolbar with no instructor
  const { instructors } = useDirectoryStore()

  const latestInst = useMemo(() => {
    if (!instructor?.id) return instructor
    return instructors.find(i => i.id === instructor.id) || instructor
  }, [instructor, instructors])

  const [status,    setStatus]    = useState('idle')
  const [email,     setEmail]     = useState(latestInst?.email     || '')
  const [firstName, setFirstName] = useState(latestInst?.firstName || '')
  const [lastName,  setLastName]  = useState(latestInst?.lastName  || '')
  const [copyMsg,   setCopyMsg]   = useState('')
  const [inviteLink,setInviteLink]= useState('')
  const [sentName,  setSentName]  = useState('')

  const [isEmailDirty, setIsEmailDirty] = useState(false)
  const [isFirstDirty, setIsFirstDirty] = useState(false)
  const [isLastDirty,  setIsLastDirty]  = useState(false)

  useEffect(() => {
    if (!isEmailDirty && latestInst?.email !== undefined) {
      setEmail(latestInst.email || '')
    }
  }, [latestInst?.email, isEmailDirty])

  useEffect(() => {
    if (!isFirstDirty && latestInst?.firstName !== undefined) {
      setFirstName(latestInst.firstName || '')
    }
  }, [latestInst?.firstName, isFirstDirty])

  useEffect(() => {
    if (!isLastDirty && latestInst?.lastName !== undefined) {
      setLastName(latestInst.lastName || '')
    }
  }, [latestInst?.lastName, isLastDirty])

  const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

  const handleSend = async () => {
    const addr = email.trim()
    const fn1  = firstName.trim()
    if (!addr) { setStatus('no-email'); return }
    if (!fn1)  { setStatus('no-name');  return }
    setStatus('sending')
    try {
      const callFn = httpsCallable(functions, 'createTeacherAccount')
      const result = await callFn({
        firstName: fn1,
        lastName:  lastName.trim(),
        email:     addr,
        phone:     latestInst?.phone || '',
        color:     latestInst?.color || '#6366F1',
        oldId:     latestInst?.id   || null,
      })
      setSentName(fn1)
      setInviteLink(result.data.link || '')
      setStatus('sent')
    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }

  const copyLink = () => {
    if (!inviteLink) return
    navigator.clipboard.writeText(inviteLink)
    setCopyMsg('Copied!')
    setTimeout(() => setCopyMsg(''), 2000)
  }

  return (
    <Modal onClose={onClose} width="max-w-sm">
      <ModalHeader title={isNew ? "Invite teacher" : "Reset password"} onClose={onClose} />

      {status === 'sent' ? (
        <div className="flex flex-col gap-4">
          <div className="text-center py-2">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-base font-bold text-primary mb-1">
              {isNew ? 'Invite sent!' : 'Reset link sent!'}
            </p>
            <p className="text-sm text-muted leading-relaxed">
              An email with a {isNew ? 'sign-in' : 'reset'} link has been sent to <strong>{email}</strong>.
              They can also use the link below if the email doesn't arrive.
            </p>
          </div>
          {inviteLink && (
            <div className="bg-raised border border-app rounded-xl p-3">
              <p className="text-xs text-muted mb-2 font-semibold uppercase tracking-wide">Backup link (share if needed)</p>
              <p className="text-xs font-mono text-accent break-all mb-3 leading-relaxed">{inviteLink}</p>
              <button onClick={copyLink}
                className="w-full py-2 rounded-lg bg-accent text-white text-sm font-semibold cursor-pointer border-none">
                {copyMsg || '📋 Copy link'}
              </button>
            </div>
          )}
          <p className="text-xs text-dim text-center">
            Link expires in 1 hour. They sign in at{' '}
            <span className="font-mono text-accent">yrshifts.web.app/app</span>
          </p>
          <Button className="w-full justify-center" onClick={onClose}>Done</Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-5 p-3 bg-raised rounded-xl">
            <Avatar firstName={latestInst?.firstName} lastName={latestInst?.lastName}
              color={latestInst?.color} photo={latestInst?.photo} size={40} />
            <div>
              <p className="text-sm font-bold text-primary">{latestInst?.firstName} {latestInst?.lastName}</p>
              <p className="text-xs text-dim">{latestInst?.role || 'teacher'}</p>
            </div>
          </div>

          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">First name *</label>
              <input value={firstName} onChange={e => { setFirstName(e.target.value); setIsFirstDirty(true); }} placeholder="e.g. Sarah"
                className={INPUT} autoFocus={isNew} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Last name</label>
              <input value={lastName} onChange={e => { setLastName(e.target.value); setIsLastDirty(true); }} placeholder="e.g. Nicholas"
                className={INPUT} />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Email address *</label>
            <input value={email} onChange={e => { setEmail(e.target.value); setIsEmailDirty(true); }} placeholder="teacher@example.com"
              type="email" className={INPUT} autoFocus={!isNew} />
          </div>

          <div className="bg-accent-soft border border-accent/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-xs text-accent leading-relaxed">
              {isNew
                ? "Creates their login account and sends a set-password link. Once signed in they'll see their schedule at "
                : "Sends a reset-password link. Once signed in they'll see their schedule at "}
              <span className="font-mono font-bold">yrshifts.web.app/app</span>
            </p>
          </div>

          {status === 'no-email' && (
            <p className="text-sm text-danger font-semibold mb-3">⚠️ Please enter an email address.</p>
          )}
          {status === 'no-name' && (
            <p className="text-sm text-danger font-semibold mb-3">⚠️ Please enter the teacher's first name.</p>
          )}
          {status === 'error' && (
            <p className="text-sm text-danger font-semibold mb-3">
              ⚠️ Something went wrong — check the browser console for details.
            </p>
          )}

          <ModalFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSend} disabled={status === 'sending'} icon="📧">
              {status === 'sending' ? 'Sending reset link…' : 'Reset password'}
            </Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}

// ── Message modal ──────────────────────────────────────────────────────────────
function MessageModal({ recipients, onClose, onSend }) {
  const [msg, setMsg]   = useState('')
  const [sent, setSent] = useState(false)

  const handleSend = () => {
    if (!msg.trim()) return
    onSend(recipients, msg)
    setSent(true)
    setTimeout(onClose, 1400)
  }

  return (
    <Modal onClose={onClose} width="max-w-md">
      <ModalHeader title="📤 Send message" onClose={onClose} />
      {sent ? (
        <div className="text-center py-8">
          <p className="text-4xl mb-3">✅</p>
          <p className="text-base font-bold text-primary">Sent!</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {recipients.map(r => (
              <span key={r.id} className="flex items-center gap-1.5 px-2 py-0.5 bg-raised border border-app rounded-full text-xs text-primary">
                <Avatar firstName={r.firstName} lastName={r.lastName} color={r.color} photo={r.photo} size={18} />
                {r.firstName}
              </span>
            ))}
          </div>
          <textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Type your message…"
            rows={4} autoFocus
            className="w-full bg-raised border border-app rounded-xl px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors resize-none mb-4" />
          <ModalFooter>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSend} disabled={!msg.trim()} icon="📤">Send</Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────
const COLS = [
  { key: 'firstName', label: 'First name' },
  { key: 'lastName',  label: 'Last name'  },
  { key: 'role',      label: 'Role'       },
  { key: 'email',     label: 'Email'      },
  { key: 'phone',     label: 'Phone', align: 'right' },
]

export default function DirectoryView() {
  const sms = useOutletContext()
  const { instructors, loading, updateInstructor, deleteInstructor } = useDirectoryStore()
  const { userProfile: myProfile } = useAuthStore()
  const canManageRoles = myProfile?.role === 'owner'
  const [promoting, setPromoting] = useState(null)

  const [search,    setSearch]    = useState('')
  const [sel,       setSel]       = useState(new Set())
  const [sortCol,   setSortCol]   = useState(null)
  const [sortDir,   setSortDir]   = useState('asc')
  const [editCell,  setEditCell]  = useState(null)
  const [showAdd,   setShowAdd]   = useState(false)
  const [inviting,  setInviting]  = useState(null)   // instructor object
  const [msgModal,  setMsgModal]  = useState(null)
  const [actOpen,   setActOpen]   = useState(false)
  const [confirmDel,setConfirmDel]= useState(null)

  const filtered = useMemo(() => {
    let list = instructors || []
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(i =>
        [i.firstName, i.lastName, i.email, i.phone, i.role].some(v => (v || '').toLowerCase().includes(q))
      )
    }
    if (sortCol) {
      list = [...list].sort((a, b) => {
        const av = (a[sortCol] || '').toLowerCase()
        const bv = (b[sortCol] || '').toLowerCase()
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    }
    return list
  }, [instructors, search, sortCol, sortDir])

  const allSel  = filtered.length > 0 && filtered.every(i => sel.has(i.id))
  const someSel = sel.size > 0

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const handleCellSave = async (id, field, value) => {
    try { await updateInstructor(id, { [field]: value }) } catch (e) { console.error(e) }
    setEditCell(null)
  }

  const handleDelete = async (id) => {
    try { await deleteInstructor(id); setSel(s => { const n = new Set(s); n.delete(id); return n }) } catch (e) { console.error(e) }
    setConfirmDel(null)
  }

  const handleSendMessage = (recipients, msg) => {
    sms.send(recipients.map(r => ({ to: `${r.firstName} ${r.lastName}`, text: msg.length > 60 ? msg.slice(0,60)+'…' : msg })))
    setMsgModal(null)
  }

  const selectedInstructors = instructors.filter(i => sel.has(i.id))
  const TH = "px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide cursor-pointer select-none bg-surface sticky top-0 border-b border-app"

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">

      {/* Header */}
      <div className="px-7 pt-6 pb-0 bg-surface flex-shrink-0">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-accent-soft border border-accent/20 flex items-center justify-center text-lg">📇</div>
          <h1 className="text-2xl font-bold text-primary">Directory</h1>
          <span className="px-2.5 py-0.5 rounded-md bg-raised text-muted text-sm font-semibold">{instructors.length}</span>
        </div>
        <div className="flex border-b border-app">
          <button className="px-5 py-2.5 text-sm font-bold text-accent border-b-2 border-accent -mb-px">All users</button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-7 py-3 bg-surface border-b border-app flex items-center gap-3 flex-shrink-0 flex-wrap">
        <div className="relative w-56">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-sm pointer-events-none">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users…"
            className="w-full bg-raised border border-app rounded-lg pl-8 pr-3 py-2 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors" />
        </div>

        {someSel && (
          <div className="relative flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setActOpen(v => !v)}
                className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm font-bold rounded-full cursor-pointer border-none">
                Actions <span className="text-xs">{actOpen ? '▲' : '▼'}</span>
              </button>
              {actOpen && (
                <>
                  <div onClick={() => setActOpen(false)} className="fixed inset-0 z-40" />
                  <div className="absolute top-full left-0 mt-1.5 z-50 bg-card border border-app rounded-xl shadow-xl overflow-hidden min-w-[200px]">
                    <button onClick={() => { setMsgModal(selectedInstructors); setActOpen(false) }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm text-primary bg-transparent hover:bg-raised cursor-pointer border-none text-left">
                      <span className="text-lg">💬</span> Send SMS
                    </button>
                  </div>
                </>
              )}
            </div>
            <span className="text-sm text-muted">{sel.size} selected</span>
            <button onClick={() => setSel(new Set())} className="text-dim hover:text-muted text-lg cursor-pointer bg-transparent border-none">×</button>
          </div>
        )}

        <div className="flex-1" />
        <Button small icon="📧" onClick={() => setInviting({})}>Invite teacher</Button>
        <Button variant="primary" small icon="+" onClick={() => setShowAdd(true)}>Add instructor</Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm min-w-[700px]">
          <thead>
            <tr>
              <th className={`${TH} w-11 text-center px-0`}>
                <input type="checkbox" checked={allSel}
                  ref={el => { if (el) el.indeterminate = someSel && !allSel }}
                  onChange={() => setSel(allSel ? new Set() : new Set(filtered.map(i => i.id)))}
                  className="w-4 h-4 accent-accent cursor-pointer" />
              </th>
              <th className={`${TH} w-12`} />
              {COLS.map(col => (
                <th key={col.key} className={`${TH} ${col.align === 'right' ? 'text-right' : ''}`}
                  onClick={() => toggleSort(col.key)}>
                  {col.label}
                  <span className={`ml-1 text-xs ${sortCol === col.key ? 'text-accent' : 'text-dim'}`}>
                    {sortCol === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                  </span>
                </th>
              ))}
              <th className={`${TH} w-32 text-right pr-7`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((inst, idx) => {
              const isSel   = sel.has(inst.id)
              const isAdmin = ['owner','admin'].includes(inst.role)
              const rowBg   = isSel ? 'bg-accent-soft' : idx % 2 === 0 ? 'bg-surface' : 'bg-app'
              return (
                <tr key={inst.id} className={`${rowBg} border-b border-app/20 hover:bg-raised/50 transition-colors`}>
                  <td className="text-center px-0 py-2.5">
                    <input type="checkbox" checked={isSel}
                      onChange={() => { const n = new Set(sel); isSel ? n.delete(inst.id) : n.add(inst.id); setSel(n) }}
                      className="w-4 h-4 accent-accent cursor-pointer" />
                  </td>
                  <td className="py-2 px-2">
                    <Avatar firstName={inst.firstName} lastName={inst.lastName}
                      color={inst.color} photo={inst.photo} size={36}
                      onUpload={url => updateInstructor(inst.id, { photo: url })} />
                  </td>
                  {COLS.map(col => {
                    const editable  = col.key !== 'role'
                    const isEditing = editCell?.id === inst.id && editCell?.field === col.key
                    let display = inst[col.key]
                    if (col.key === 'phone') display = formatPhone(display)
                    if (col.key === 'role')  display = display || 'teacher'
                    return (
                      <td key={col.key}
                        className={`px-4 py-2.5 ${col.align === 'right' ? 'text-right font-mono' : ''} ${col.key === 'email' ? 'text-muted' : 'text-primary'}`}
                        onDoubleClick={() => { if (editable) setEditCell({ id: inst.id, field: col.key }) }}>
                        {isEditing ? (
                          <input defaultValue={inst[col.key]} autoFocus
                            onBlur={e => handleCellSave(inst.id, col.key, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleCellSave(inst.id, col.key, e.target.value); if (e.key === 'Escape') setEditCell(null) }}
                            className="w-full bg-card border border-accent rounded-lg px-2.5 py-1.5 text-sm text-primary outline-none" />
                        ) : col.key === 'role' ? (
                          isAdmin
                            ? <span className="px-2 py-0.5 bg-accent-soft text-accent text-xs font-bold rounded-md uppercase">Admin</span>
                            : <span className="text-muted text-xs uppercase tracking-wide">{display}</span>
                        ) : (
                          <span className="cursor-text" title={editable ? 'Double-click to edit' : ''}>{display}</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-2.5 text-right pr-5">
                    <div className="flex items-center justify-end gap-2">
                      {!isAdmin && (
                        <button onClick={() => setInviting(inst)} title="Reset password"
                          className="text-dim hover:text-accent transition-colors cursor-pointer bg-transparent border-none text-base">📧</button>
                      )}
                      {canManageRoles && (
                        <button onClick={() => setPromoting(inst)}
                          title="Change role"
                          className="text-dim hover:text-accent transition-colors cursor-pointer bg-transparent border-none text-base">
                          🔑
                        </button>
                      )}
                      <button onClick={() => setConfirmDel(inst.id)}
                        className="text-dim hover:text-danger transition-colors cursor-pointer bg-transparent border-none text-base">🗑</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">🔍</p>
            <p className="text-base font-semibold text-muted">No results for "{search}"</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-7 py-2.5 bg-surface border-t border-app flex justify-between text-xs text-dim flex-shrink-0">
        <span>{filtered.length} user{filtered.length !== 1 ? 's' : ''}</span>
        <span>Double-click a cell to edit · Click avatar to upload photo · 📧 to reset password</span>
      </div>

      {/* Modals */}
      {showAdd    && <AddModal onClose={() => setShowAdd(false)} />}
      {inviting   && <InviteModal instructor={inviting} onClose={() => setInviting(null)} />}
      {msgModal   && <MessageModal recipients={msgModal} onClose={() => setMsgModal(null)} onSend={handleSendMessage} />}
      {confirmDel && (
        <Modal onClose={() => setConfirmDel(null)} width="max-w-xs">
          <ModalHeader title="Delete user?" onClose={() => setConfirmDel(null)} />
          <p className="text-sm text-muted mb-5 leading-relaxed">
            This removes their profile. Their shifts remain but become unassigned. Their login account must be removed separately in Firebase Console.
          </p>
          <ModalFooter>
            <Button onClick={() => setConfirmDel(null)}>Cancel</Button>
            <button onClick={() => handleDelete(confirmDel)}
              className="px-4 py-1.5 bg-danger text-white text-sm font-semibold rounded-lg cursor-pointer border-none hover:opacity-90">Delete</button>
          </ModalFooter>
        </Modal>
      )}

      {/* Role management modal — owners only */}
      {promoting && canManageRoles && (
        <Modal onClose={() => setPromoting(null)} width="max-w-sm" zIndex="z-[3500]">
          <ModalHeader title="Change role" onClose={() => setPromoting(null)} />
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 p-3 bg-raised rounded-xl border border-app">
              <Avatar firstName={promoting.firstName} lastName={promoting.lastName}
                color={promoting.color} photo={promoting.photo} size={40} />
              <div>
                <p className="text-sm font-bold text-primary">{promoting.firstName} {promoting.lastName}</p>
                <p className="text-xs text-muted">{promoting.email}</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {[
                { role: 'owner',   icon: '👑', label: 'Owner',   desc: 'Full access + can manage roles' },
                { role: 'admin',   icon: '🛡️', label: 'Admin',   desc: 'Full access, cannot manage roles' },
                { role: 'manager', icon: '📋', label: 'Manager', desc: 'Schedule + Directory + Chat only' },
                { role: 'teacher', icon: '👤', label: 'Teacher', desc: 'Teacher app only' },
              ].map(opt => (
                <button key={opt.role}
                  onClick={async () => {
                    await updateInstructor(promoting.id, { role: opt.role })
                    setPromoting(null)
                  }}
                  className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer text-left w-full transition-colors
                    ${promoting.role === opt.role
                      ? 'bg-accent-soft border-accent/40'
                      : 'bg-card border-app hover:bg-raised'}`}>
                  <span className="text-xl">{opt.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-primary">{opt.label}
                      {promoting.role === opt.role && <span className="ml-2 text-xs text-accent font-normal">(current)</span>}
                    </p>
                    <p className="text-xs text-muted">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
          <ModalFooter>
            <Button onClick={() => setPromoting(null)}>Cancel</Button>
          </ModalFooter>
        </Modal>
      )}

    </div>
  )
}

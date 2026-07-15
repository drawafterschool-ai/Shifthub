import { useState, useRef, useEffect } from 'react'
import { doc, updateDoc }   from 'firebase/firestore'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, storage, auth } from '../../utils/firebase'
import useAuthStore from '../../stores/useAuthStore'
import { isBiometricsSupported, registerBiometrics, disableBiometrics, isBiometricsEnabled } from '../../utils/biometric'

const INPUT = "w-full bg-raised border border-app rounded-xl px-4 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

// ── Calendar popup for picking specific unavailable dates ────────────────────
function DateCalendarModal({ selected, onClose, onSave }) {
  const todayStr = (() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
  })()
  const [cursor, setCursor] = useState(() => { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() } })
  const [picked, setPicked] = useState(new Set(selected))

  const monthName = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const firstDow  = new Date(cursor.y, cursor.m, 1).getDay()
  const daysInMon = new Date(cursor.y, cursor.m + 1, 0).getDate()
  const dateStr   = (d) => `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const toggle = (ds) => {
    if (ds < todayStr) return               // past days are not selectable
    setPicked(prev => { const n = new Set(prev); n.has(ds) ? n.delete(ds) : n.add(ds); return n })
  }
  const shiftMonth = (delta) => setCursor(c => {
    const d = new Date(c.y, c.m + delta, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })

  return (
    <div className="fixed inset-0 z-[3000] bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-card border border-app rounded-3xl p-4 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <button onClick={() => shiftMonth(-1)} className="w-9 h-9 rounded-xl bg-raised border border-app text-primary cursor-pointer">‹</button>
          <p className="text-sm font-bold text-primary">{monthName}</p>
          <button onClick={() => shiftMonth(1)} className="w-9 h-9 rounded-xl bg-raised border border-app text-primary cursor-pointer">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <span key={i} className="text-2xs font-bold text-dim py-1">{d}</span>
          ))}
          {Array.from({ length: firstDow }).map((_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: daysInMon }).map((_, i) => {
            const d = i + 1
            const ds = dateStr(d)
            const isPast = ds < todayStr
            const isSel  = picked.has(ds)
            return (
              <button key={ds} onClick={() => toggle(ds)} disabled={isPast}
                className={`aspect-square rounded-lg text-xs font-semibold cursor-pointer border transition-colors
                  ${isSel ? 'bg-danger text-white border-danger'
                          : isPast ? 'bg-transparent text-dim border-transparent cursor-default'
                                   : 'bg-raised text-primary border-app hover:border-accent'}`}>
                {d}
              </button>
            )
          })}
        </div>
        <p className="text-2xs text-dim text-center">Tap dates you are <strong>unavailable</strong> · red = off</p>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl bg-raised border border-app text-xs font-bold text-primary cursor-pointer">Cancel</button>
          <button onClick={() => onSave([...picked].sort())}
            className="flex-1 py-2.5 rounded-xl bg-accent text-white text-xs font-bold border-none cursor-pointer">Apply dates</button>
        </div>
      </div>
    </div>
  )
}

export default function ProfileView() {
  const { user, userProfile } = useAuthStore()

  const [firstName, setFirstName] = useState(userProfile?.firstName || '')
  const [lastName,  setLastName]  = useState(userProfile?.lastName  || '')
  const [phone,     setPhone]     = useState(userProfile?.phone     || '')
  const [newEmail,  setNewEmail]  = useState(userProfile?.email     || '')
  const [newPass,   setNewPass]   = useState('')
  const [curPass,   setCurPass]   = useState('')
  const [photo,     setPhoto]     = useState(userProfile?.photo     || null)
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(null)

  const fileRef = useRef(null)

  const [bioSupported, setBioSupported] = useState(false)
  const [bioEnabled, setBioEnabled] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState('')
  const [bioError, setBioError] = useState('')
  const [notifSound, setNotifSound] = useState(() => localStorage.getItem('shifthub_notif_sound') || 'default')

  const handleSoundChange = (val) => {
    setNotifSound(val)
    localStorage.setItem('shifthub_notif_sound', val)
    import('../../utils/sound').then(({ playNotificationSound }) => playNotificationSound(val))
  }

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
    showToast('Biometrics disabled!')
  }

  const handleEnableBio = async () => {
    setBioError('')
    try {
      const email = useAuthStore.getState().user?.email
      if (!email) throw new Error('You must be signed in to configure biometrics')
      await registerBiometrics(email, confirmPassword)
      setBioEnabled(true)
      setConfirmPassword('')
      showToast('Biometrics registered successfully!')
    } catch (err) {
      console.warn(err)
      setBioError(err.message || 'Verification or sensor prompt failed.')
    }
  }

  const [unavailability, setUnavailability] = useState(userProfile?.unavailability || [])
  const [unavailableDates, setUnavailableDates] = useState(userProfile?.unavailableDates || [])
  const [showDateCal, setShowDateCal] = useState(false)
  // Late-arriving profile: initialise dates once when the profile first loads
  useEffect(() => {
    if (userProfile) setUnavailableDates(userProfile.unavailableDates || [])
  }, [!!userProfile])
  const [addDay, setAddDay] = useState('Mon')
  const [addStart, setAddStart] = useState('09:00')
  const [addEnd, setAddEnd] = useState('17:00')
  const [savingAvail, setSavingAvail] = useState(false)

  const handleAddSlot = () => {
    if (!addStart || !addEnd) { showToast('Please select start and end times', false); return }
    if (addStart >= addEnd) { showToast('End time must be after start time', false); return }
    
    // Check duplicate
    const duplicate = unavailability.some(s => s.day === addDay && s.start === addStart && s.end === addEnd)
    if (duplicate) { showToast('This slot has already been added', false); return }

    setUnavailability(prev => [...prev, { day: addDay, start: addStart, end: addEnd }].sort((a,b) => {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      if (a.day !== b.day) return days.indexOf(a.day) - days.indexOf(b.day)
      return a.start.localeCompare(b.start)
    }))
    showToast('Slot added locally! Tap "Save settings" below.')
  }

  const handleRemoveSlot = (idx) => {
    setUnavailability(prev => prev.filter((_, i) => i !== idx))
    showToast('Slot removed locally! Tap "Save settings" below.')
  }

  const handleSaveAvailability = async () => {
    setSavingAvail(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), { unavailability, unavailableDates })
      showToast('Availability settings saved!')
    } catch (e) {
      showToast('Failed to save availability', false)
    } finally {
      setSavingAvail(false)
    }
  }

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 2800)
  }

  const handlePhotoUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    try {
      const snap = await uploadBytes(stRef(storage, `profile_photos/${user.uid}`), file)
      const url  = await getDownloadURL(snap.ref)
      setPhoto(url)
      await updateDoc(doc(db, 'users', user.uid), { photo: url })
      showToast('Photo updated!')
    } catch { showToast('Photo upload failed', false) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const handleSaveProfile = async () => {
    if (!firstName.trim()) { showToast('First name is required', false); return }
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        firstName: firstName.trim(),
        lastName:  lastName.trim(),
        phone:     phone.trim(),
      })
      showToast('Profile saved!')
    } catch { showToast('Save failed', false) }
    finally { setSaving(false) }
  }

  const handleUpdateEmail = async () => {
    if (!newEmail.trim() || !curPass) { showToast('Enter your current password to change email', false); return }
    setSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, curPass)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updateEmail(auth.currentUser, newEmail.trim())
      await updateDoc(doc(db, 'users', user.uid), { email: newEmail.trim() })
      setCurPass('')
      showToast('Email updated!')
    } catch (e) {
      showToast(e.code === 'auth/wrong-password' ? 'Incorrect password' : 'Email update failed', false)
    } finally { setSaving(false) }
  }

  const handleUpdatePassword = async () => {
    if (!newPass || !curPass) { showToast('Enter your current and new password', false); return }
    if (newPass.length < 6)   { showToast('New password must be at least 6 characters', false); return }
    setSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, curPass)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPass)
      setNewPass(''); setCurPass('')
      showToast('Password updated!')
    } catch (e) {
      showToast(e.code === 'auth/wrong-password' ? 'Incorrect current password' : 'Password update failed', false)
    } finally { setSaving(false) }
  }

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">

        {/* Avatar */}
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {photo ? (
              <img src={photo} alt="Profile" className="w-24 h-24 rounded-full object-cover border-2 border-accent" />
            ) : (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white border-2 border-accent"
                style={{ background: userProfile?.color || 'var(--accent)' }}>
                {(firstName[0] || '') + (lastName[0] || '')}
              </div>
            )}
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent border-2 border-surface text-white text-sm flex items-center justify-center cursor-pointer border-accent">
              {uploading ? '…' : '📷'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="text-xs text-accent font-semibold cursor-pointer bg-transparent border-none">
            {uploading ? 'Uploading…' : 'Change photo'}
          </button>
        </div>

        {/* Basic info */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Basic info</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted mb-1.5">First name</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} className={INPUT} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted mb-1.5">Last name</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} className={INPUT} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Phone</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="6125550100" className={INPUT} />
          </div>
          <button onClick={handleSaveProfile} disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold cursor-pointer border-none disabled:opacity-50">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button onClick={() => window.dispatchEvent(new CustomEvent('shifthub_replay_onboarding'))}
            className="w-full py-3 rounded-xl bg-raised border border-app text-sm font-bold text-primary hover:text-accent hover:border-accent transition-colors cursor-pointer mt-2">
            📖 Replay App Guide
          </button>
        </div>

        {/* Availability Settings */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Weekly Availability Settings</p>
          <p className="text-xs text-muted leading-relaxed">
            Mark recurring times when you are <strong>UNAVAILABLE</strong> to teach. Administrators will see conflicts highlighted on the roster calendar.
          </p>

          {/* Current Slots List */}
          {unavailability.length > 0 ? (
            <div className="flex flex-col gap-2">
              {unavailability.map((slot, idx) => {
                const formatTime = (timeStr) => {
                  const [h, m] = timeStr.split(':').map(Number)
                  const ampm = h >= 12 ? 'PM' : 'AM'
                  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ampm}`
                }
                return (
                  <div key={idx} className="flex items-center justify-between bg-raised border border-app px-4 py-3 rounded-xl">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-2xs font-bold bg-accent/25 text-accent">{slot.day}</span>
                      <span className="text-xs font-semibold text-primary">{formatTime(slot.start)} – {formatTime(slot.end)}</span>
                    </div>
                    <button onClick={() => handleRemoveSlot(idx)}
                      className="w-7 h-7 rounded-lg bg-red-500/10 hover:bg-red-500/25 border-none flex items-center justify-center cursor-pointer text-red-400 transition-colors">
                      🗑
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-dim text-center py-4 bg-raised rounded-xl border border-app border-dashed">
              You are fully available! No unavailability slots added.
            </p>
          )}

          {/* Specific unavailable dates */}
          <div className="border-t border-app pt-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-muted uppercase tracking-wide">Specific Dates Off</p>
            <p className="text-xs text-muted leading-relaxed">
              Away on certain days (vacation, appointments)? Pick them on the calendar — schedulers see those days flagged too.
            </p>
            {unavailableDates.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {[...unavailableDates].sort().map(d => (
                  <span key={d} className="inline-flex items-center gap-1.5 bg-raised border border-app rounded-lg px-2.5 py-1.5 text-xs text-primary">
                    {new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    <button onClick={() => setUnavailableDates(prev => prev.filter(x => x !== d))}
                      className="text-danger bg-transparent border-none cursor-pointer text-sm leading-none">✕</button>
                  </span>
                ))}
              </div>
            )}
            <button onClick={() => setShowDateCal(true)}
              className="w-full py-2.5 rounded-xl bg-raised border border-app text-xs font-bold text-primary hover:text-accent hover:border-accent transition-colors cursor-pointer">
              📅 Pick dates on calendar
            </button>
          </div>

          {showDateCal && (
            <DateCalendarModal
              selected={unavailableDates}
              onClose={() => setShowDateCal(false)}
              onSave={(dates) => { setUnavailableDates(dates); setShowDateCal(false) }}
            />
          )}

          {/* Add Form */}
          <div className="border-t border-app pt-4 flex flex-col gap-3">
            <p className="text-xs font-bold text-muted uppercase tracking-wide">Add Unavailability Slot</p>
            <div className="flex gap-2">
              <div className="flex-1 flex flex-col">
                <label className="block text-2xs font-semibold text-dim mb-1">Day</label>
                <select value={addDay} onChange={e => setAddDay(e.target.value)}
                  className="w-full bg-raised border border-app rounded-xl px-2.5 py-2.5 text-xs text-primary outline-none focus:border-accent">
                  <option value="Mon">Monday</option>
                  <option value="Tue">Tuesday</option>
                  <option value="Wed">Wednesday</option>
                  <option value="Thu">Thursday</option>
                  <option value="Fri">Friday</option>
                  <option value="Sat">Saturday</option>
                  <option value="Sun">Sunday</option>
                </select>
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-2xs font-semibold text-dim mb-1">Start Time</label>
                <input type="time" value={addStart} onChange={e => setAddStart(e.target.value)}
                  className="w-full bg-raised border border-app rounded-xl px-2.5 py-2 text-xs text-primary outline-none focus:border-accent" />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-2xs font-semibold text-dim mb-1">End Time</label>
                <input type="time" value={addEnd} onChange={e => setAddEnd(e.target.value)}
                  className="w-full bg-raised border border-app rounded-xl px-2.5 py-2 text-xs text-primary outline-none focus:border-accent" />
              </div>
            </div>
            <button onClick={handleAddSlot}
              className="w-full py-2.5 rounded-xl bg-raised border border-app text-xs font-bold text-primary hover:text-accent hover:border-accent transition-colors cursor-pointer">
              + Add Slot locally
            </button>
          </div>

          <button onClick={handleSaveAvailability} disabled={savingAvail}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold cursor-pointer border-none disabled:opacity-50 mt-2">
            {savingAvail ? 'Saving settings…' : 'Save availability settings'}
          </button>
        </div>

        {/* Calendar Subscription Feed (iCal) */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Calendar Subscription Feed (iCal)</p>
          <p className="text-xs text-muted leading-relaxed">
            Subscribe to your confirmed ShiftHub schedule inside your phone's native calendar client (Apple Calendar, Google Calendar, Outlook, etc.). Your calendar will sync automatically in the background.
          </p>
          <div className="bg-raised border border-app rounded-xl p-3.5 flex flex-col gap-2">
            <span className="text-[10px] font-bold text-muted uppercase tracking-wider">Subscription Link</span>
            <code className="text-xs text-accent break-all font-mono">
              {`${window.location.origin}/calendar/${user?.uid}.ics`}
            </code>
          </div>
          <button
            onClick={() => {
              const url = `${window.location.origin}/calendar/${user?.uid}.ics`
              navigator.clipboard.writeText(url)
                .then(() => showToast('Subscription link copied!'))
                .catch(() => showToast('Failed to copy', false))
            }}
            className="w-full py-3 rounded-xl bg-raised border border-app text-sm font-bold text-primary hover:text-accent hover:border-accent transition-colors cursor-pointer"
          >
            📋 Copy Subscription Link
          </button>
        </div>

        {/* Notification Sound */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Notification Sound</p>
          <p className="text-xs text-muted leading-relaxed">
            Choose a custom sound for in-app and chat notifications on this browser.
          </p>
          <div className="flex gap-2 items-center">
            <div className="flex-1">
              <select
                value={notifSound}
                onChange={e => handleSoundChange(e.target.value)}
                className="w-full bg-raised border border-app rounded-xl px-2.5 py-2.5 text-xs text-primary outline-none focus:border-accent"
              >
                <option value="none">🔇 None (Silent)</option>
                <option value="default">🔔 Default (Ping)</option>
                <option value="chime">🎵 Chime (Two-Tone)</option>
                <option value="tink">✨ Tink (Metallic)</option>
                <option value="glass">🍷 Glass (Resonant)</option>
              </select>
            </div>
            <button
              onClick={() => import('../../utils/sound').then(({ playNotificationSound }) => playNotificationSound(notifSound))}
              className="px-4 py-2.5 bg-raised border border-app hover:border-accent text-primary rounded-xl text-xs font-bold cursor-pointer transition-colors"
            >
              🔊 Test
            </button>
          </div>
        </div>

        {/* Biometric Quick Login */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Biometric Quick Login</p>
          <p className="text-xs text-muted leading-relaxed">
            Use device biometrics (Face ID / Touch ID / fingerprint) for instant sign-in on this browser.
          </p>
          {!bioSupported ? (
            <div className="text-xs text-muted leading-relaxed">
              ⚠️ Biometric quick login is not supported by this device or browser.
            </div>
          ) : bioEnabled ? (
            <div className="flex items-center justify-between bg-raised border border-app px-4 py-3 rounded-xl">
              <div>
                <p className="text-xs text-ok font-semibold">🧬 Biometrics active on this device</p>
                <p className="text-[10px] text-dim">You will be logged in automatically using Face ID / fingerprint.</p>
              </div>
              <button onClick={handleDisableBio}
                className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg cursor-pointer border-none transition-colors">
                Disable
              </button>
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
                <button onClick={handleEnableBio} disabled={!confirmPassword}
                  className="px-4 py-2.5 bg-accent hover:opacity-90 disabled:opacity-50 text-white text-xs font-bold rounded-xl cursor-pointer border-none">
                  Enable
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Email */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Change email</p>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">New email</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Current password</label>
            <input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} placeholder="Required to change email" className={INPUT} />
          </div>
          <button onClick={handleUpdateEmail} disabled={saving}
            className="w-full py-3 rounded-xl bg-raised border border-app text-sm font-bold text-primary cursor-pointer disabled:opacity-50">
            Update email
          </button>
        </div>

        {/* Password */}
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Change password</p>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Current password</label>
            <input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} placeholder="••••••••" className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">New password</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="At least 6 characters" className={INPUT} />
          </div>
          <button onClick={handleUpdatePassword} disabled={saving}
            className="w-full py-3 rounded-xl bg-raised border border-app text-sm font-bold text-primary cursor-pointer disabled:opacity-50">
            Update password
          </button>
        </div>

      </div>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold shadow-xl z-50 whitespace-nowrap
          ${toast.ok ? 'bg-ok' : 'bg-danger'}`}>
          {toast.ok ? '✅' : '⚠️'} {toast.msg}
        </div>
      )}
    </div>
  )
}

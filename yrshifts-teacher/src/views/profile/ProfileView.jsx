import { useState, useRef } from 'react'
import { doc, updateDoc }   from 'firebase/firestore'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, storage, auth } from '../../utils/firebase'
import useAuthStore from '../../stores/useAuthStore'

const INPUT = "w-full bg-raised border border-app rounded-xl px-4 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

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

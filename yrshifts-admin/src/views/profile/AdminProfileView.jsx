import { useState, useRef } from 'react'
import { doc, updateDoc }   from 'firebase/firestore'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { db, storage, auth } from '../../utils/firebase'
import useAuthStore from '../../stores/useAuthStore'

const INPUT = "w-full bg-raised border border-app rounded-xl px-4 py-3 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

export default function AdminProfileView() {
  const { user, userProfile, signOut } = useAuthStore()
  const [firstName, setFirstName] = useState(userProfile?.firstName || '')
  const [lastName,  setLastName]  = useState(userProfile?.lastName  || '')
  const [photo,     setPhoto]     = useState(userProfile?.photo     || null)
  const [curPass,   setCurPass]   = useState('')
  const [newPass,   setNewPass]   = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [toast,     setToast]     = useState(null)
  const fileRef = useRef(null)

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 2800) }

  const handlePhoto = async (e) => {
    const file = e.target.files[0]; if (!file) return
    setUploading(true)
    try {
      const snap = await uploadBytes(stRef(storage, `profile_photos/${user.uid}`), file)
      const url  = await getDownloadURL(snap.ref)
      setPhoto(url)
      await updateDoc(doc(db, 'users', user.uid), { photo: url })
      showToast('Photo updated!')
    } catch { showToast('Upload failed', false) }
    finally { setUploading(false) }
  }

  const handleSaveProfile = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), { firstName: firstName.trim(), lastName: lastName.trim() })
      showToast('Saved!')
    } catch { showToast('Save failed', false) }
    finally { setSaving(false) }
  }

  const handleChangePassword = async () => {
    if (!curPass || !newPass) { showToast('Enter both passwords', false); return }
    if (newPass.length < 6)   { showToast('New password must be 6+ characters', false); return }
    setSaving(true)
    try {
      const cred = EmailAuthProvider.credential(user.email, curPass)
      await reauthenticateWithCredential(auth.currentUser, cred)
      await updatePassword(auth.currentUser, newPass)
      setCurPass(''); setNewPass('')
      showToast('Password updated!')
    } catch (e) {
      showToast(e.code === 'auth/wrong-password' ? 'Wrong password' : 'Update failed', false)
    } finally { setSaving(false) }
  }

  const [pushStatus, setPushStatus] = useState(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') return 'denied'
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && userProfile?.fcmToken) return 'done'
    return 'idle'
  })
  const [pushError, setPushError] = useState('')

  const handleEnablePush = async () => {
    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator)) {
      setPushStatus('unsupported')
      return
    }
    setPushStatus('loading')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setPushStatus('denied')
        return
      }
      const { getToken } = await import('firebase/messaging')
      const { messaging } = await import('../../utils/firebase')
      if (!messaging) {
        setPushStatus('unsupported')
        return
      }
      
      // Wait until the unified admin sw.js is fully active and ready
      const reg = await navigator.serviceWorker.ready
      
      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY
      if (!vapidKey) {
        setPushStatus('error')
        setPushError('Missing VAPID key configuration.')
        return
      }
      const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg })
      if (!token) {
        setPushStatus('error')
        setPushError('FCM returned no token.')
        return
      }
      await updateDoc(doc(db, 'users', user.uid), { fcmToken: token })
      setPushStatus('done')
      showToast('Notifications active!')
    } catch (e) {
      console.error(e)
      setPushStatus('error')
      setPushError(e.message || 'An unknown error occurred')
      showToast('Failed to enable', false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-app">
      <div className="px-4 py-6 flex flex-col gap-5 max-w-lg mx-auto">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {photo ? (
              <img src={photo} alt="" className="w-24 h-24 rounded-full object-cover border-2 border-accent" />
            ) : (
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white border-2 border-accent"
                style={{ background: userProfile?.color || 'var(--accent)' }}>
                {(firstName[0] || '') + (lastName[0] || '')}
              </div>
            )}
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-accent border-2 border-surface text-white text-sm flex items-center justify-center cursor-pointer">
              {uploading ? '…' : '📷'}
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
          <div className="text-center">
            <p className="text-base font-bold text-primary">{firstName} {lastName}</p>
            <p className="text-xs text-accent font-semibold capitalize">{userProfile?.role}</p>
            <p className="text-xs text-dim">{user?.email}</p>
          </div>
        </div>
 
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Name</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted mb-1.5">First</label>
              <input value={firstName} onChange={e => setFirstName(e.target.value)} className={INPUT} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-muted mb-1.5">Last</label>
              <input value={lastName} onChange={e => setLastName(e.target.value)} className={INPUT} />
            </div>
          </div>
          <button onClick={handleSaveProfile} disabled={saving}
            className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold cursor-pointer border-none disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
 
        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">Change password</p>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">Current password</label>
            <input type="password" value={curPass} onChange={e => setCurPass(e.target.value)} placeholder="••••••••" className={INPUT} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1.5">New password</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="6+ characters" className={INPUT} />
          </div>
          <button onClick={handleChangePassword} disabled={saving}
            className="w-full py-3 rounded-xl bg-raised border border-app text-sm font-bold text-primary cursor-pointer disabled:opacity-50">
            Update password
          </button>
        </div>

        <div className="bg-card border border-app rounded-2xl p-4 flex flex-col gap-4">
          <p className="text-xs font-bold text-muted uppercase tracking-wide">🔔 Push Notifications Settings</p>
          <p className="text-xs text-dim leading-relaxed">
            Enable push notifications on your phone or computer to receive instant native alerts when teachers confirm or reject shifts, send new chat messages, or submit forms.
          </p>
          
          {pushStatus === 'done' && (
            <div className="flex items-center gap-2 bg-ok-soft border border-ok/30 rounded-xl px-3.5 py-2">
              <span className="text-sm">✅</span>
              <span className="text-xs text-ok font-semibold">Push notifications active on this device</span>
            </div>
          )}

          {pushStatus === 'denied' && (
            <div className="flex items-center gap-2 bg-raised border border-app rounded-xl px-3.5 py-2">
              <span className="text-sm">🔕</span>
              <span className="text-xs text-muted">Notifications blocked. Enable in your browser/device settings.</span>
            </div>
          )}

          {pushStatus === 'unsupported' && (
            <div className="flex items-center gap-2 bg-raised border border-app rounded-xl px-3.5 py-2">
              <span className="text-sm">ℹ️</span>
              <span className="text-xs text-muted">Push alerts are not supported in this browser.</span>
            </div>
          )}

          {pushStatus === 'error' && (
            <div className="flex items-center gap-2 bg-raised border border-danger/30 rounded-xl px-3.5 py-2">
              <span className="text-sm">⚠️</span>
              <span className="text-xs text-danger font-semibold truncate" title={pushError}>Failed: {pushError}</span>
            </div>
          )}

          {['idle', 'loading'].includes(pushStatus) && (
            <button
              onClick={handleEnablePush}
              disabled={pushStatus === 'loading'}
              className="w-full py-3 rounded-xl bg-accent text-white text-sm font-bold cursor-pointer border-none disabled:opacity-60"
            >
              {pushStatus === 'loading' ? 'Enabling push alerts…' : '🔔 Enable Push Notifications'}
            </button>
          )}
        </div>

        <button onClick={signOut}
          className="w-full py-3 rounded-xl border border-danger/40 text-danger text-sm font-semibold cursor-pointer bg-transparent">
          Sign out
        </button>
      </div>

      {toast && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold shadow-xl z-50 whitespace-nowrap ${toast.ok ? 'bg-ok' : 'bg-danger'}`}>
          {toast.ok ? '✅' : '⚠️'} {toast.msg}
        </div>
      )}
    </div>
  )
}

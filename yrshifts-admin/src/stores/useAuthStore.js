import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db }                                 from '../utils/firebase'

const cachedProfileStr = localStorage.getItem('shifthub_admin_profile')
let cachedProfile = null
try { cachedProfile = cachedProfileStr ? JSON.parse(cachedProfileStr) : null } catch {}

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    cachedProfile,
  loading:        true,
  profileMissing: false,
  _profileUnsub:  null,
  _authUnsub:     null,
  _activityTimeout: null,
  _activityCleanup: null,

  resetActivityTimer() {
    // Disabled inactivity auto-logout
  },

  setupActivityListeners() {
    // Disabled inactivity auto-logout listeners
    return () => {}
  },

  init() {
    if (get()._authUnsub) return  // already initialised

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Cancel previous profile listener
      const prev = get()._profileUnsub
      if (prev) { try { prev() } catch {} }
      set({ _profileUnsub: null })

      if (!user) {
        localStorage.removeItem('shifthub_admin_profile')
        const cleanup = get()._activityCleanup
        if (cleanup) { try { cleanup() } catch {} }
        set({ user: null, userProfile: null, loading: false, profileMissing: false, _activityCleanup: null })
        return
      }

      // Set loading true only if we don't have a cached profile to avoid blocking PWA unfreezes
      const hasCache = !!get().userProfile
      const cleanup = get().setupActivityListeners()
      set({ user, loading: !hasCache, profileMissing: false, _activityCleanup: cleanup })

      // Hard timeout — if profile never arrives, show error
      const timer = setTimeout(() => {
        if (get().loading) {
          clearTimeout(retryTimer)
          const activeUnsub = get()._profileUnsub
          if (activeUnsub) { try { activeUnsub() } catch {} }
          set({ _profileUnsub: null, loading: false, profileMissing: true })
        }
      }, 8000)

      let retryTimer = null

      const startProfileListener = () => {
        const unsub = onSnapshot(
          doc(db, 'users', user.uid),
          (snap) => {
            if (snap.exists()) {
              clearTimeout(timer)
              clearTimeout(retryTimer)
              const profile = snap.data()
              localStorage.setItem('shifthub_admin_profile', JSON.stringify(profile))
              set({ userProfile: profile, profileMissing: false, loading: false })

              // Update lastLoginAt once per session (limit to once per minute to avoid snapshot loops)
              const now = Date.now()
              const lastLoginUpdate = profile.lastLoginAt?.seconds ? (profile.lastLoginAt.seconds * 1000) : (profile.lastLoginAt || 0)
              if (now - lastLoginUpdate > 60000) {
                updateDoc(doc(db, 'users', user.uid), { lastLoginAt: serverTimestamp() }).catch(err => {})
              }
            } else {
              // Doc doesn't exist yet — retry once after 1s (first-login race)
              clearTimeout(retryTimer)
              retryTimer = setTimeout(() => {
                const currentUnsub = get()._profileUnsub
                if (currentUnsub) { try { currentUnsub() } catch {} }
                startProfileListener()
              }, 1000)
            }
          },
          (err) => {
            clearTimeout(timer)
            clearTimeout(retryTimer)
            const activeUnsub = get()._profileUnsub
            if (activeUnsub) { try { activeUnsub() } catch {} }
            console.error('Profile listener error:', err)
            set({ _profileUnsub: null, loading: false, profileMissing: true })
          }
        )

        set({ _profileUnsub: unsub })
      }

      startProfileListener()
    })

    set({ _authUnsub: unsubAuth })
  },

  signOut() {
    localStorage.removeItem('shifthub_admin_profile')
    // Cancel profile listener only — keep auth listener alive so it catches the null fire
    const prev = get()._profileUnsub
    if (prev) { try { prev() } catch {} }
    const cleanup = get()._activityCleanup
    if (cleanup) { try { cleanup() } catch {} }
    set({ _profileUnsub: null, _activityCleanup: null })
    fbSignOut(auth)
  },

  // Convenience selectors
  get isOwner()      { return get().userProfile?.role === 'owner' },
  get isAdmin()      { return ['owner','admin'].includes(get().userProfile?.role) },
  get isManager()    { return get().userProfile?.role === 'manager' },
  get isTeacher()    { return get().userProfile?.role === 'teacher' },
  get canManageRoles() { return get().userProfile?.role === 'owner' },
}))

export default useAuthStore

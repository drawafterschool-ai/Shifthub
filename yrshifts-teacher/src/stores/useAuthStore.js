import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth, db }                                 from '../utils/firebase'

const cachedProfileStr = localStorage.getItem('shifthub_teacher_profile')
let cachedProfile = null
try { cachedProfile = cachedProfileStr ? JSON.parse(cachedProfileStr) : null } catch {}

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    cachedProfile,
  loading:        !cachedProfile, // not loading if profile cached
  profileMissing: false,
  _profileUnsub:  null,   // only the profile listener — kept separate
  _authUnsub:     null,   // the auth listener — must stay alive permanently
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
    // Guard: only init once
    if (get()._authUnsub) return

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Cancel any previous profile listener when auth state changes
      const prevUnsub = get()._profileUnsub
      if (prevUnsub) { try { prevUnsub() } catch {} }
      set({ _profileUnsub: null })

      if (!user) {
        localStorage.removeItem('shifthub_teacher_profile')
        // No user — show login screen, but keep the auth listener alive!
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
              localStorage.setItem('shifthub_teacher_profile', JSON.stringify(profile))
              if (['owner', 'admin', 'manager'].includes(profile.role)) {
                window.location.replace('/admin')
                return
              }
              if (profile.role !== 'teacher') {
                fbSignOut(auth)
                localStorage.removeItem('shifthub_teacher_profile')
                set({ userProfile: null, profileMissing: true, loading: false })
                return
              }

              // Check and register teacher first login event
              if (!profile.firstLoginRegistered) {
                const userRef = doc(db, 'users', user.uid)
                updateDoc(userRef, {
                  firstLoginRegistered: true,
                  firstLoginAt: serverTimestamp()
                }).catch(err => console.error("Error registering first login:", err))

                const notifRef = collection(db, 'notifications')
                addDoc(notifRef, {
                  type: 'first_login',
                  forAdmin: true,
                  recipientId: 'admin',
                  actorId: user.uid,
                  actorName: `${profile.firstName || ''} ${profile.lastName || ''}`.trim() || 'A teacher',
                  status: 'unread',
                  createdAt: serverTimestamp()
                }).catch(err => console.error("Error creating first login notification:", err))
              }

              // Update lastLoginAt once per session (limit to once per minute to avoid loops)
              const now = Date.now()
              const lastLoginUpdate = profile.lastLoginAt?.seconds ? (profile.lastLoginAt.seconds * 1000) : (profile.lastLoginAt || 0)
              if (now - lastLoginUpdate > 60000) {
                updateDoc(doc(db, 'users', user.uid), { lastLoginAt: serverTimestamp() }).catch(err => {})
              }

              set({ userProfile: profile, profileMissing: false, loading: false })
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
    localStorage.removeItem('shifthub_teacher_profile')
    // Cancel profile listener only — auth listener must stay alive
    // so onAuthStateChanged(null) fires and transitions to login screen
    const profileUnsub = get()._profileUnsub
    if (profileUnsub) { try { profileUnsub() } catch {} }
    const cleanup = get()._activityCleanup
    if (cleanup) { try { cleanup() } catch {} }
    set({ _profileUnsub: null, _activityCleanup: null })
    fbSignOut(auth)
  },
}))

export default useAuthStore

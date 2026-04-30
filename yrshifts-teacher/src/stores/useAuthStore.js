import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot }                          from 'firebase/firestore'
import { auth, db }                                 from '../utils/firebase'

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    null,
  loading:        true,
  profileMissing: false,
  _profileUnsub:  null,   // only the profile listener — kept separate
  _authUnsub:     null,   // the auth listener — must stay alive permanently

  init() {
    // Guard: only init once
    if (get()._authUnsub) return

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Cancel any previous profile listener when auth state changes
      const prevUnsub = get()._profileUnsub
      if (prevUnsub) { try { prevUnsub() } catch {} }
      set({ _profileUnsub: null })

      if (!user) {
        // No user — show login screen, but keep the auth listener alive!
        set({ user: null, userProfile: null, loading: false, profileMissing: false })
        return
      }

      set({ user, loading: true, profileMissing: false })

      // Hard timeout — if profile never arrives, show error
      const timer = setTimeout(() => {
        if (get().loading) set({ loading: false, profileMissing: true })
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
              if (profile.role === 'admin') { window.location.replace('/admin'); return }
              if (profile.role !== 'teacher') {
                fbSignOut(auth)
                set({ userProfile: null, profileMissing: true, loading: false })
                return
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
            console.error('Profile listener error:', err)
            set({ loading: false, profileMissing: true })
          }
        )
        set({ _profileUnsub: unsub })
      }

      startProfileListener()
    })

    set({ _authUnsub: unsubAuth })
  },

  signOut() {
    // Cancel profile listener only — auth listener must stay alive
    // so onAuthStateChanged(null) fires and transitions to login screen
    const profileUnsub = get()._profileUnsub
    if (profileUnsub) { try { profileUnsub() } catch {} }
    set({ _profileUnsub: null })
    fbSignOut(auth)
  },
}))

export default useAuthStore

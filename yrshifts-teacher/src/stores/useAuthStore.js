import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot }                          from 'firebase/firestore'
import { auth, db }                                 from '../utils/firebase'

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    null,
  loading:        true,
  profileMissing: false,
  _unsubs:        [],

  init() {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        get()._cleanup()
        set({ user: null, userProfile: null, loading: false, profileMissing: false })
        return
      }

      // User is signed in — start profile listener
      set({ user, loading: true, profileMissing: false })

      // Grace period: if Firestore hasn't responded in 6 seconds, show error
      // (First login after account creation is the only time this matters)
      const timer = setTimeout(() => {
        if (get().loading) {
          set({ loading: false, profileMissing: true })
        }
      }, 6000)

      const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        clearTimeout(timer)

        if (snap.exists()) {
          const profile = snap.data()
          // Teacher app is teacher-only.
          if (profile.role === 'admin') {
            window.location.replace('/admin')
            return
          }
          if (profile.role !== 'teacher') {
            fbSignOut(auth)
            set({ userProfile: null, profileMissing: true, loading: false })
            return
          }
          set({ userProfile: profile, profileMissing: false, loading: false })
        } else {
          // Doc doesn't exist yet — keep loading=true for the grace period
          // (it will be created by the Cloud Function shortly)
          // Only set profileMissing if we've already finished loading
          if (!get().loading) {
            set({ userProfile: null, profileMissing: true })
          }
          // else: timer will handle it after 6s if profile never arrives
        }
      }, (err) => {
        clearTimeout(timer)
        console.error('Profile listener error:', err)
        set({ loading: false, profileMissing: true })
      })

      set(s => ({ _unsubs: [...s._unsubs, unsubProfile] }))
    })

    set(s => ({ _unsubs: [...s._unsubs, unsubAuth] }))
  },

  signOut() {
    get()._cleanup()
    fbSignOut(auth)
  },

  _cleanup() {
    get()._unsubs.forEach(fn => { try { fn() } catch {} })
    set({ _unsubs: [] })
  },
}))

export default useAuthStore

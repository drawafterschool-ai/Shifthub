import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot, setDoc }                  from 'firebase/firestore'
import { auth, db }                                  from '../utils/firebase'

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    null,
  loading:        true,
  profileMissing: false,
  _unsubs:        [],

  /** Call once at app startup */
  init() {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        get()._cleanup()
        set({ user: null, userProfile: null, loading: false, profileMissing: false })
        return
      }

      set({ user })

      const unsubProfile = onSnapshot(doc(db, 'users', user.uid), (snap) => {
        if (snap.exists()) {
          set({ userProfile: snap.data(), profileMissing: false, loading: false })
        } else {
          // No auto-healing — show a clear error screen instead
          set({ userProfile: null, profileMissing: true, loading: false })
        }
      })

      set((s) => ({ _unsubs: [...s._unsubs, unsubProfile] }))
    })

    set((s) => ({ _unsubs: [...s._unsubs, unsubAuth] }))
  },

  signOut() {
    fbSignOut(auth)
  },

  _cleanup() {
    get()._unsubs.forEach(fn => fn())
    set({ _unsubs: [] })
  },

  // Convenience selectors
  get isAdmin()   { return get().userProfile?.role === 'admin' },
  get isTeacher() { return get().userProfile?.role === 'teacher' },
}))

export default useAuthStore

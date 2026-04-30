import { create } from 'zustand'
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth'
import { doc, onSnapshot }                          from 'firebase/firestore'
import { auth, db }                                 from '../utils/firebase'

const useAuthStore = create((set, get) => ({
  user:           null,
  userProfile:    null,
  loading:        true,
  profileMissing: false,
  _profileUnsub:  null,
  _authUnsub:     null,

  init() {
    if (get()._authUnsub) return  // already initialised

    const unsubAuth = onAuthStateChanged(auth, (user) => {
      // Cancel previous profile listener
      const prev = get()._profileUnsub
      if (prev) { try { prev() } catch {} }
      set({ _profileUnsub: null })

      if (!user) {
        set({ user: null, userProfile: null, loading: false, profileMissing: false })
        return
      }

      // Set loading true while we fetch the profile
      set({ user, loading: true, profileMissing: false })

      const unsubProfile = onSnapshot(
        doc(db, 'users', user.uid),
        (snap) => {
          if (snap.exists()) {
            set({ userProfile: snap.data(), profileMissing: false, loading: false })
          } else {
            set({ userProfile: null, profileMissing: true, loading: false })
          }
        },
        (err) => {
          console.error('Profile listener error:', err)
          set({ loading: false, profileMissing: true })
        }
      )

      set({ _profileUnsub: unsubProfile })
    })

    set({ _authUnsub: unsubAuth })
  },

  signOut() {
    // Cancel profile listener only — keep auth listener alive so it catches the null fire
    const prev = get()._profileUnsub
    if (prev) { try { prev() } catch {} }
    set({ _profileUnsub: null })
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

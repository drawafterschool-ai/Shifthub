import { create } from 'zustand'
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../utils/firebase'

const useDirectoryStore = create((set, get) => ({
  instructors: [],
  loading:     true,
  _unsub:      null,

  init() {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      set({
        instructors: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        loading: false,
      })
    })
    set({ _unsub: unsub })
  },

  cleanup() {
    get()._unsub?.()
  },

  async addInstructor(data) {
    await setDoc(doc(db, 'users', String(data.id)), data)
  },

  async updateInstructor(id, fields) {
    await updateDoc(doc(db, 'users', String(id)), fields)
  },

  async deleteInstructor(id) {
    await deleteDoc(doc(db, 'users', String(id)))
  },
}))

export default useDirectoryStore

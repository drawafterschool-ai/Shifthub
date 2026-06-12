import { create } from 'zustand'
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../utils/firebase'

const useDirectoryStore = create((set, get) => ({
  instructors: [],
  loading:     true,
  _unsub:      null,

  init() {
    try {
      const cached = localStorage.getItem('shifthub_instructors')
      if (cached) {
        set({ instructors: JSON.parse(cached), loading: false })
      }
    } catch (e) {
      console.warn('Error loading cached instructors:', e)
    }

    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                            .sort((a, b) => {
                              const nameA = `${a.firstName} ${a.lastName}`.toLowerCase()
                              const nameB = `${b.firstName} ${b.lastName}`.toLowerCase()
                              return nameA.localeCompare(nameB)
                            })
      set({ instructors: list, loading: false })
      try {
        localStorage.setItem('shifthub_instructors', JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving instructors to cache:', e)
      }
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

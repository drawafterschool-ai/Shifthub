import { create } from 'zustand'
import { collection, onSnapshot, query, where, doc, updateDoc } from 'firebase/firestore'
import { db } from '../utils/firebase'
import { createNotification } from '../utils/notifications'

const useFormsStore = create((set, get) => ({
  assignments: [],
  loading: true,
  _unsub: null,
  _userId: null,

  init(userId) {
    set({ _userId: userId })
    // Load from cache if exists
    try {
      const cached = localStorage.getItem(`shifthub_forms_${userId}`)
      if (cached) {
        set({ assignments: JSON.parse(cached), loading: false })
      }
    } catch (e) {
      console.warn('Error loading cached forms:', e)
    }

    // Subscribe to assigned forms for this teacher
    const q = query(
      collection(db, 'forms_assigned'),
      where('teacherId', '==', userId)
    )

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                            .sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0))
      set({ assignments: list, loading: false })
      try {
        localStorage.setItem(`shifthub_forms_${userId}`, JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving forms to cache:', e)
      }
    }, (error) => {
      console.error('Firestore teacher forms subscription error:', error)
    })

    set({ _unsub: unsub })
  },

  cleanup() {
    get()._unsub?.()
    set({ _unsub: null, assignments: [], loading: true, _userId: null })
  },

  // Submit responses for a specific form assignment
  async submitFormResponse(assignmentId, responses, userName, formTitle) {
    await updateDoc(doc(db, 'forms_assigned', assignmentId), {
      status: 'completed',
      responses,
      submittedAt: Date.now()
    })

    // Create a real-time notification for the admin
    await createNotification({
      type: 'form_submitted',
      forAdmin: true,
      recipientId: 'admin',
      actorName: userName,
      formTitle: formTitle,
      message: `${userName} submitted responses for form "${formTitle}".`
    })
  }
}))

export default useFormsStore

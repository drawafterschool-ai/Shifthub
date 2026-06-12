import { create } from 'zustand'
import { collection, onSnapshot, doc, setDoc, deleteDoc, writeBatch } from 'firebase/firestore'
import { db } from '../utils/firebase'
import useDirectoryStore from './useDirectoryStore'

const useFormsStore = create((set, get) => ({
  forms: [],
  assignments: [],
  loading: true,
  _unsubForms: null,
  _unsubAssignments: null,

  init() {
    // 1. Try to load cached data for forms and assignments
    try {
      const cachedForms = localStorage.getItem('shifthub_forms_templates')
      const cachedAssignments = localStorage.getItem('shifthub_forms_assignments')
      const updateObj = {}
      if (cachedForms) {
        updateObj.forms = JSON.parse(cachedForms)
        updateObj.loading = false
      }
      if (cachedAssignments) {
        updateObj.assignments = JSON.parse(cachedAssignments)
      }
      if (Object.keys(updateObj).length > 0) {
        set(updateObj)
      }
    } catch (e) {
      console.warn('Error loading cached forms store:', e)
    }

    // 2. Setup real-time listener for 'forms' collection (templates)
    const unsubForms = onSnapshot(collection(db, 'forms'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      set({ forms: list, loading: false })
      try {
        localStorage.setItem('shifthub_forms_templates', JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving form templates to cache:', e)
      }
    }, (error) => {
      console.error('Firestore forms subscription error:', error)
    })

    // 3. Setup real-time listener for 'forms_assigned' collection (assignments)
    const unsubAssignments = onSnapshot(collection(db, 'forms_assigned'), (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
                            .sort((a, b) => (b.assignedAt || 0) - (a.assignedAt || 0))
      set({ assignments: list })
      try {
        localStorage.setItem('shifthub_forms_assignments', JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving form assignments to cache:', e)
      }
    }, (error) => {
      console.error('Firestore forms_assigned subscription error:', error)
    })

    set({ _unsubForms: unsubForms, _unsubAssignments: unsubAssignments })
  },

  cleanup() {
    get()._unsubForms?.()
    get()._unsubAssignments?.()
    set({ _unsubForms: null, _unsubAssignments: null, forms: [], assignments: [], loading: true })
  },

  // Save (Create or Update) a form template
  async saveFormTemplate(id, title, description, fields) {
    const templateId = id || Math.random().toString(36).slice(2) + Date.now().toString(36)
    const data = {
      title: title.trim(),
      description: description.trim(),
      fields,
      createdAt: id ? (get().forms.find(f => f.id === id)?.createdAt || Date.now()) : Date.now()
    }
    await setDoc(doc(db, 'forms', templateId), data)
    return templateId
  },

  // Delete a form template
  async deleteFormTemplate(id) {
    await deleteDoc(doc(db, 'forms', id))
  },

  // Batch assign a form to multiple teachers
  async assignForm(formId, formTitle, formDescription, fields, teacherIds) {
    if (!teacherIds || teacherIds.length === 0) return
    const batch = writeBatch(db)
    const instructors = useDirectoryStore.getState().instructors

    teacherIds.forEach(teacherId => {
      const teacher = instructors.find(t => t.id === teacherId)
      const teacherName = teacher ? `${teacher.firstName} ${teacher.lastName || ''}`.trim() : 'Teacher'
      
      const newRef = doc(collection(db, 'forms_assigned'))
      batch.set(newRef, {
        formId,
        formTitle,
        formDescription,
        teacherId,
        teacherName,
        status: 'pending',
        fields,
        responses: {},
        assignedAt: Date.now(),
        submittedAt: null
      })
    })

    await batch.commit()
  },

  // Delete a specific form assignment instance
  async deleteAssignment(id) {
    await deleteDoc(doc(db, 'forms_assigned', id))
  }
}))

export default useFormsStore

import { create } from 'zustand'
import { doc, onSnapshot, setDoc } from 'firebase/firestore'
import { db } from '../utils/firebase'

const DEFAULT_TIERS = [
  { id: 't1', maxStudents: 9,  ratePerHour: 30 },
  { id: 't2', maxStudents: 14, ratePerHour: 40 },
  { id: 't3', maxStudents: 99, ratePerHour: 45 },
]

const useSettingsStore = create((set, get) => ({
  companyName:  '',
  timezone:     'America/Chicago',
  payrollTiers: DEFAULT_TIERS,
  smsTemplates: {},
  raw:          {},    // full raw settings doc
  loading:      true,
  _unsub:       null,

  init() {
    try {
      const cached = localStorage.getItem('shifthub_settings')
      if (cached) {
        const d = JSON.parse(cached)
        set({
          companyName:  d.companyName  || '',
          timezone:     d.timezone     || 'America/Chicago',
          payrollTiers: d.payrollTiers?.length ? d.payrollTiers : DEFAULT_TIERS,
          smsTemplates: d.smsTemplates || {},
          raw:          d,
          loading:      false,
        })
      }
    } catch (e) {
      console.warn('Error loading cached settings:', e)
    }

    const unsub = onSnapshot(doc(db, 'settings', 'company'), (snap) => {
      if (snap.exists()) {
        const d = snap.data()
        set({
          companyName:  d.companyName  || '',
          timezone:     d.timezone     || 'America/Chicago',
          payrollTiers: d.payrollTiers?.length ? d.payrollTiers : DEFAULT_TIERS,
          smsTemplates: d.smsTemplates || {},
          raw:          d,
          loading:      false,
        })
        try {
          localStorage.setItem('shifthub_settings', JSON.stringify(d))
        } catch (e) {
          console.warn('Error saving settings to cache:', e)
        }
      } else {
        set({ loading: false })
      }
    })
    set({ _unsub: unsub })
  },

  cleanup() { get()._unsub?.() },

  async save(fields) {
    await setDoc(doc(db, 'settings', 'company'), fields, { merge: true })
  },
}))

export default useSettingsStore

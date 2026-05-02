import { create } from 'zustand'
import { collection, onSnapshot, query, where, orderBy, limit, writeBatch, doc, updateDoc } from 'firebase/firestore'
import { db }                        from '../utils/firebase'
import { markRead, markAllRead }     from '../utils/notifications'

const useNotificationsStore = create((set, get) => ({
  notifications: [],
  loading:       true,
  _unsub:        null,

  init() {
    // Listen to ALL notifications that are either:
    //   - forAdmin === true (shifts, people, buzz activity)
    //   - OR have no forAdmin field (legacy / chat notifications)
    // We fetch the 200 most recent and sort client-side.
    const q = query(
      collection(db, 'notifications'),
      where('forAdmin', '==', true),
      orderBy('createdAt', 'desc'),
      limit(200),
    )

    const handleSnap = (snap) => {
      const items = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      set({ notifications: items, loading: false })
    }

    const unsub = onSnapshot(q, handleSnap, () => {
      // Fallback without orderBy (index not ready yet)
      const q2 = query(
        collection(db, 'notifications'),
        where('forAdmin', '==', true),
        limit(200),
      )
      onSnapshot(q2, handleSnap)
    })

    set({ _unsub: unsub })
  },

  cleanup() { get()._unsub?.() },

  get unreadCount() {
    return get().notifications.filter(n => n.status === 'unread').length
  },

  markRead(id)  { return markRead(id) },
  markAllRead() {
    const ids = get().notifications.filter(n => n.status === 'unread').map(n => n.id)
    return markAllRead(ids)
  },
  async clearAllPending() {
    const pending = get().notifications.filter(n => n.status === 'unread')
    if (!pending.length) return
    const batch = writeBatch(db)
    pending.forEach(n => batch.update(doc(db, 'notifications', n.id), { status: 'read' }))
    await batch.commit()
  },

  // Ignore a single notification
  async ignoreNotif(id) {
    if (!id) return
    try {
      await updateDoc(doc(db, 'notifications', id), { status: 'read', ignored: true })
    } catch(e) { console.error('ignoreNotif failed:', e) }
  },

  // Ignore all pending — called with no args, uses internal list
  async ignoreAll() {
    const pending = get().notifications.filter(n =>
      ['shift_rejected', 'shift_claimed', 'shift_unconfirmed'].includes(n.type) && !n.ignored
    )
    if (!pending.length) return
    try {
      const batch = writeBatch(db)
      pending.forEach(n => batch.update(doc(db, 'notifications', n.id), { status: 'read', ignored: true }))
      await batch.commit()
    } catch(e) { console.error('ignoreAll failed:', e) }
  },
}))

export default useNotificationsStore

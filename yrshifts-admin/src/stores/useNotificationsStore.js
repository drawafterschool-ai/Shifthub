import { create } from 'zustand'
import { collection, onSnapshot, query, where, orderBy, limit, writeBatch, doc, updateDoc } from 'firebase/firestore'
import { db }                        from '../utils/firebase'
import { markRead, markAllRead }     from '../utils/notifications'

const sessionStart = Date.now()

const useNotificationsStore = create((set, get) => ({
  notifications: [],
  loading:       true,
  _unsub:        null,

  init() {
    // Clean up any existing subscription first to avoid leaks
    get().cleanup()

    let isInitial = true

    const handleSnap = (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      
      // Safe sort that converts Timestamp objects or numbers into numbers
      items.sort((a, b) => {
        const aVal = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : (Number(a.createdAt) || 0)
        const bVal = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : (Number(b.createdAt) || 0)
        return bVal - aVal
      })
      
      set({ notifications: items, loading: false })

      if (isInitial) {
        isInitial = false
        return
      }

      // Check if any notification was newly added and is unread
      const hasNewIncoming = snap.docChanges().some(change => {
        if (change.type !== 'added') return false
        const n = change.doc.data()
        if (!n || n.status !== 'unread') return false
        const createdTime = n.createdAt?.toMillis
          ? n.createdAt.toMillis()
          : (n.createdAt?.seconds ? n.createdAt.seconds * 1000 : (Number(n.createdAt) || 0))
        return !createdTime || createdTime > sessionStart
      })

      if (hasNewIncoming) {
        import('../utils/sound').then(({ playNotificationSound }) => playNotificationSound())
      }
    }

    const q = query(
      collection(db, 'notifications'),
      where('forAdmin', '==', true),
      orderBy('createdAt', 'desc'),
      limit(200),
    )

    let fallbackUnsub = null

    const unsub = onSnapshot(q, handleSnap, (error) => {
      console.error('Primary notifications query failed, trying fallback:', error)
      
      const q2 = query(
        collection(db, 'notifications'),
        where('forAdmin', '==', true),
        limit(200),
      )

      fallbackUnsub = onSnapshot(q2, handleSnap, (err2) => {
        console.error('Fallback notifications query also failed:', err2)
        set({ loading: false })
      })

      // Store the fallback unsubscribe function
      set({ _unsub: () => {
        if (fallbackUnsub) {
          fallbackUnsub()
        }
      }})
    })

    // If the error callback didn't fire synchronously, store the primary unsubscriber
    if (!fallbackUnsub) {
      set({ _unsub: () => {
        unsub()
        if (fallbackUnsub) {
          fallbackUnsub()
        }
      }})
    }
  },

  cleanup() {
    get()._unsub?.()
    set({ _unsub: null, loading: true })
  },

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

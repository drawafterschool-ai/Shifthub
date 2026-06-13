import { create } from 'zustand'
import {
  collection, onSnapshot, query, where,
  doc, updateDoc, addDoc, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../utils/firebase'
import { createNotification } from '../utils/notifications'

const useTeacherStore = create((set, get) => ({
  myShifts:      [],   // shifts assigned to me
  openShifts:    [],   // claimable unassigned shifts
  notifications: [],   // notifications for me
  buzzPosts:     [],   // weekly buzz posts
  loading:       true,
  _unsubs:       [],

  _userId: null,

  init(userId) {
    set({ _userId: userId })
    // Load from cache if exists
    try {
      const cachedMyShifts = localStorage.getItem(`shifthub_myShifts_${userId}`)
      const cachedOpenShifts = localStorage.getItem(`shifthub_openShifts_${userId}`)
      const cachedNotifications = localStorage.getItem(`shifthub_notifications_${userId}`)
      const cachedBuzz = localStorage.getItem(`shifthub_buzzPosts_${userId}`)

      const updateObj = {}
      if (cachedMyShifts) {
        updateObj.myShifts = JSON.parse(cachedMyShifts)
        updateObj.loading = false
      }
      if (cachedOpenShifts) {
        updateObj.openShifts = JSON.parse(cachedOpenShifts)
      }
      if (cachedNotifications) {
        updateObj.notifications = JSON.parse(cachedNotifications)
      }
      if (cachedBuzz) {
        updateObj.buzzPosts = JSON.parse(cachedBuzz)
      }
      if (Object.keys(updateObj).length > 0) {
        set(updateObj)
      }
    } catch (e) {
      console.warn('Error loading cached teacher store:', e)
    }

    // My assigned shifts
    const q1 = query(collection(db, 'shifts'), where('instructorId', '==', userId))
    const u1 = onSnapshot(q1, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.date.localeCompare(b.date))
      set({ myShifts: list, loading: false })
      try {
        localStorage.setItem(`shifthub_myShifts_${userId}`, JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving myShifts to cache:', e)
      }
    })

    // Open / claimable shifts
    const q2 = query(collection(db, 'shifts'), where('claimable', '==', true))
    const u2  = onSnapshot(q2, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.date.localeCompare(b.date))
      set({ openShifts: list })
      try {
        localStorage.setItem(`shifthub_openShifts_${userId}`, JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving openShifts to cache:', e)
      }
    })

    // My notifications
    const q3 = query(collection(db, 'notifications'), where('recipientId', '==', userId))
    let isInitialNotif = true
    const u3  = onSnapshot(q3, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.createdAt - a.createdAt)
      set({ notifications: list })
      try {
        localStorage.setItem(`shifthub_notifications_${userId}`, JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving notifications to cache:', e)
      }

      if (isInitialNotif) {
        isInitialNotif = false
        return
      }

      // Check if any notification was newly added and is unread
      const hasNewIncoming = snap.docChanges().some(change => {
        if (change.type !== 'added') return false
        const n = change.doc.data()
        return n && n.status === 'unread'
      })

      if (hasNewIncoming) {
        import('../utils/sound').then(({ playNotificationSound }) => playNotificationSound())
      }
    })

    // Weekly buzz
    const u4 = onSnapshot(collection(db, 'weekly_buzz'), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0))
      set({ buzzPosts: list })
      try {
        localStorage.setItem(`shifthub_buzzPosts_${userId}`, JSON.stringify(list))
      } catch (e) {
        console.warn('Error saving buzzPosts to cache:', e)
      }
    })

    set(s => ({ _unsubs: [...s._unsubs, u1, u2, u3, u4] }))
  },

  cleanup() {
    get()._unsubs.forEach(fn => fn())
    set({ _unsubs: [], myShifts: [], openShifts: [], notifications: [], buzzPosts: [] })
  },

  // Confirm a shift
  async confirmShift(shift, userId, userName) {
    await updateDoc(doc(db, 'shifts', shift.id), { confirmationStatus: 'confirmed' })
  },

  // Reject a shift — keeps instructorId so admin sees red dot on correct row,
  // admin then decides whether to reassign
  async rejectShift(shift, userId, userName) {
    await updateDoc(doc(db, 'shifts', shift.id), {
      confirmationStatus: 'rejected',
      // intentionally keep instructorId so admin can see who rejected it
    })
  },

  // Decline an open shift — adds user to declinedBy so they stop seeing it
  async declineOpenShift(shift, userId, userName, note) {
    const { arrayUnion } = await import('firebase/firestore')
    await updateDoc(doc(db, 'shifts', shift.id), {
      declinedBy: arrayUnion(userId),
    })
    await createNotification({
      type:        'shift_declined',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   userName,
      shiftId:     shift.id,
      shiftDate:   shift.date,
      shiftStart:  shift.start,
      shiftTitle:  shift.title || 'Shift',
      message:     note || '',
    })
  },

  // Release an assigned shift — teacher can't teach, returns it to open pool
  async releaseShift(shift, userId, userName, note) {
    // Same as reject — keep instructorId so admin sees who released it
    await updateDoc(doc(db, 'shifts', shift.id), {
      confirmationStatus: 'rejected',
    })
    await createNotification({
      type:        'shift_released',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   userName,
      shiftId:     shift.id,
      shiftDate:   shift.date,
      shiftStart:  shift.start,
      shiftTitle:  shift.title || 'Shift',
      message:     note || '',
    })
  },

  // Claim an open shift
  async claimShift(shift, userId, userName) {
    await updateDoc(doc(db, 'shifts', shift.id), {
      instructorId:       userId,
      claimable:          false,
      confirmationStatus: 'confirmed',
    })
  },

  // Mark a buzz post as seen
  async markBuzzSeen(postId, userId) {
    const post = get().buzzPosts.find(p => p.id === postId)
    if (!post) return
    const seenBy = post.seenBy || []
    if (seenBy.includes(userId)) return
    await updateDoc(doc(db, 'weekly_buzz', postId), { seenBy: [...seenBy, userId] })
  },

  // Like / unlike a buzz post
  async toggleBuzzLike(postId, userId, userName) {
    const post = get().buzzPosts.find(p => p.id === postId)
    if (!post) return
    const likes = post.likes || []
    const liked = likes.includes(userId)
    const { updateDoc, doc, arrayUnion, arrayRemove } = await import('firebase/firestore')
    const { db } = await import('../utils/firebase')
    await updateDoc(doc(db, 'weekly_buzz', postId), {
      likes: liked
        ? arrayRemove(userId)
        : arrayUnion(userId),
    })
    if (!liked) {
      await createNotification({
        type:      'buzz_like',
        forAdmin:  true,
        actorName: userName,
        postId,
        postTitle: post.title || 'Weekly Buzz',
      })
    }
  },

  // Add a comment to a buzz post
  async addBuzzComment(postId, userId, userName, text) {
    if (!text?.trim()) return
    const { updateDoc, doc, arrayUnion } = await import('firebase/firestore')
    const { db } = await import('../utils/firebase')
    const comment = {
      id: Math.random().toString(36).slice(2),
      userId,
      userName,
      text: text.trim(),
      createdAt: Date.now(),
    }
    await updateDoc(doc(db, 'weekly_buzz', postId), {
      comments: arrayUnion(comment),
    })
    const post = get().buzzPosts.find(p => p.id === postId)
    await createNotification({
      type:      'buzz_comment',
      forAdmin:  true,
      actorName: userName,
      postId,
      postTitle: post?.title || 'Weekly Buzz',
    })
  },

  // Start a direct message chat with another user
  async startDM(otherUserId, otherName, myName) {
    const { addDoc, collection, query, where, getDocs, serverTimestamp } = await import('firebase/firestore')
    const { db } = await import('../utils/firebase')
    const myId = get()._userId
    // Check if DM already exists between these two users
    const q = query(collection(db, 'chats'),
      where('isGroup', '==', false),
      where('members', 'array-contains', myId || otherUserId)
    )
    const snap = await getDocs(q)
    const existing = snap.docs.find(d => {
      const m = d.data().members || []
      return m.includes(myId) && m.includes(otherUserId)
    })
    if (existing) return existing.id
    const ref = await addDoc(collection(db, 'chats'), {
      name:        otherName,
      members:     [myId, otherUserId],
      isGroup:     false,
      createdAt:   serverTimestamp(),
      lastMessage: '',
      lastAt:      serverTimestamp(),
    })
    return ref.id
  },

  // Mark a notification as read
  async markNotifRead(notifId) {
    await updateDoc(doc(db, 'notifications', notifId), { status: 'read' })
  },

  get unreadNotifCount() {
    return get().notifications.filter(n => n.status === 'unread').length
  },

  get unreadBuzzCount() {
    return 0 // computed in component from buzzPosts + userId
  },
}))

export default useTeacherStore

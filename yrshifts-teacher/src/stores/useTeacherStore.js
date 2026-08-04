import { create } from 'zustand'
import {
  collection, onSnapshot, query, where,
  doc, updateDoc, addDoc, serverTimestamp,
  arrayUnion,
} from 'firebase/firestore'
import { db } from '../utils/firebase'
import { createNotification } from '../utils/notifications'

const sessionStart = Date.now()
let visibilityHandlerAttached = false

function timeToMinutes(timeStr) {
  if (!timeStr) return 0
  const clean = timeStr.toLowerCase().replace(/\s+/g, '')
  const match = clean.match(/^(\d{1,2}):(\d{2})(am|pm)$/)
  if (!match) return 0
  let hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  const ampm = match[3]
  if (ampm === 'pm' && hours < 12) hours += 12
  if (ampm === 'am' && hours === 12) hours = 0
  return hours * 60 + minutes
}

function setupVisibilityHandler(get) {
  if (visibilityHandlerAttached || typeof window === 'undefined') return
  visibilityHandlerAttached = true

  const handleWake = () => {
    if (document.visibilityState === 'visible') {
      const uId = get()._userId
      if (uId) {
        get().init(uId, true)
      }
    }
  }

  window.addEventListener('visibilitychange', handleWake)
  window.addEventListener('online', handleWake)
}

const useTeacherStore = create((set, get) => ({
  myShifts:      [],   // shifts assigned to me
  openShifts:    [],   // claimable unassigned shifts
  notifications: [],   // notifications for me
  buzzPosts:     [],   // weekly buzz posts
  loading:       true,
  _unsubs:       [],
  _userId:       null,

  init(userId, force = false) {
    setupVisibilityHandler(get)
    set({ _userId: userId })

    if (get()._unsubs && get()._unsubs.length > 0 && !force) return

    // Clean previous unsubs if forcing re-sync
    if (force && get()._unsubs) {
      get()._unsubs.forEach(fn => { try { fn() } catch {} })
      set({ _unsubs: [] })
    }

    // Load from cache if exists
    try {
      const cachedMyShifts = localStorage.getItem(`shifthub_myShifts_${userId}`)
      const cachedOpenShifts = localStorage.getItem(`shifthub_openShifts_${userId}`)
      const cachedNotifications = localStorage.getItem(`shifthub_notifications_${userId}`)
      const cachedBuzz = localStorage.getItem(`shifthub_buzzPosts_${userId}`)

      const updateObj = {}
      if (cachedMyShifts && !force) {
        updateObj.myShifts = JSON.parse(cachedMyShifts)
        updateObj.loading = false
      }
      if (cachedOpenShifts && !force) {
        updateObj.openShifts = JSON.parse(cachedOpenShifts)
      }
      if (cachedNotifications && !force) {
        updateObj.notifications = JSON.parse(cachedNotifications)
      }
      if (cachedBuzz && !force) {
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
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare
        return timeToMinutes(a.start) - timeToMinutes(b.start)
      })
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
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare
        return timeToMinutes(a.start) - timeToMinutes(b.start)
      })
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
        import('../utils/sound').then(({ playNotificationSound }) => playNotificationSound()).catch(() => {})
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
    get()._unsubs.forEach(fn => { try { fn() } catch {} })
    set({ _unsubs: [], myShifts: [], openShifts: [], notifications: [], buzzPosts: [] })
  },

  // Confirm a shift
  async confirmShift(shift, userId, userName) {
    const prevShifts = get().myShifts
    const nextShifts = prevShifts.map(s => s.id === shift.id ? { ...s, confirmationStatus: 'confirmed' } : s)
    set({ myShifts: nextShifts })

    try {
      await updateDoc(doc(db, 'shifts', shift.id), { confirmationStatus: 'confirmed' })
    } catch (err) {
      console.error('confirmShift teacher error:', err)
      set({ myShifts: prevShifts })
      throw err
    }
  },

  // Reject a shift
  async rejectShift(shift, userId, userName) {
    const prevShifts = get().myShifts
    const nextShifts = prevShifts.map(s => s.id === shift.id ? { ...s, confirmationStatus: 'rejected' } : s)
    set({ myShifts: nextShifts })

    try {
      await updateDoc(doc(db, 'shifts', shift.id), { confirmationStatus: 'rejected' })
    } catch (err) {
      console.error('rejectShift teacher error:', err)
      set({ myShifts: prevShifts })
      throw err
    }
  },

  // Decline an open shift
  async declineOpenShift(shift, userId, userName, note) {
    const prevOpen = get().openShifts
    const nextOpen = prevOpen.filter(s => s.id !== shift.id)
    set({ openShifts: nextOpen })

    try {
      const { arrayUnion } = await import('firebase/firestore')
      await updateDoc(doc(db, 'shifts', shift.id), {
        declinedBy: arrayUnion(userId),
      })
      Promise.resolve().then(() => {
        createNotification({
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
      }).catch(() => {})
    } catch (err) {
      console.error('declineOpenShift error:', err)
      set({ openShifts: prevOpen })
      throw err
    }
  },

  // Release an assigned shift
  async releaseShift(shift, userId, userName, note) {
    const prevShifts = get().myShifts
    const nextShifts = prevShifts.map(s => s.id === shift.id ? { ...s, confirmationStatus: 'rejected' } : s)
    set({ myShifts: nextShifts })

    try {
      await updateDoc(doc(db, 'shifts', shift.id), { confirmationStatus: 'rejected' })
      Promise.resolve().then(() => {
        createNotification({
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
      }).catch(() => {})
    } catch (err) {
      console.error('releaseShift error:', err)
      set({ myShifts: prevShifts })
      throw err
    }
  },

  // Claim an open shift
  async claimShift(shift, userId, userName) {
    const prevOpen = get().openShifts
    const prevMy = get().myShifts
    const claimed = { ...shift, instructorId: userId, claimable: false, confirmationStatus: 'confirmed' }

    set({
      openShifts: prevOpen.filter(s => s.id !== shift.id),
      myShifts: [...prevMy, claimed].sort((a,b) => {
        const dateCompare = a.date.localeCompare(b.date)
        if (dateCompare !== 0) return dateCompare
        return timeToMinutes(a.start) - timeToMinutes(b.start)
      })
    })

    try {
      await updateDoc(doc(db, 'shifts', shift.id), {
        instructorId:       userId,
        claimable:          false,
        confirmationStatus: 'confirmed',
      })
    } catch (err) {
      console.error('claimShift error:', err)
      set({ openShifts: prevOpen, myShifts: prevMy })
      throw err
    }
  },

  // Mark a buzz post as seen
  async markBuzzSeen(postId, userId) {
    const post = get().buzzPosts.find(p => p.id === postId)
    if (!post) return
    const seenBy = post.seenBy || []
    if (seenBy.includes(userId)) return
    await updateDoc(doc(db, 'weekly_buzz', postId), { seenBy: arrayUnion(userId) })
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
    return 0
  },
}))

export default useTeacherStore

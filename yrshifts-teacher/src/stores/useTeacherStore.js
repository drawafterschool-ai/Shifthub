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
    // My assigned shifts
    const q1 = query(collection(db, 'shifts'), where('instructorId', '==', userId))
    const u1 = onSnapshot(q1, snap => {
      set({ myShifts: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.date.localeCompare(b.date)) })
      set({ loading: false })
    })

    // Open / claimable shifts
    const q2 = query(collection(db, 'shifts'), where('claimable', '==', true))
    const u2  = onSnapshot(q2, snap => {
      set({ openShifts: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.date.localeCompare(b.date)) })
    })

    // My notifications
    const q3 = query(collection(db, 'notifications'), where('recipientId', '==', userId))
    const u3  = onSnapshot(q3, snap => {
      set({ notifications: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => b.createdAt - a.createdAt) })
    })

    // Weekly buzz
    const u4 = onSnapshot(collection(db, 'weekly_buzz'), snap => {
      set({ buzzPosts: snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.seconds||0) - (a.createdAt?.seconds||0)) })
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
    await createNotification({
      type:        'shift_confirmed',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   userName,
      shiftId:     shift.id,
      shiftDate:   shift.date,
      shiftStart:  shift.start,
      shiftTitle:  shift.title || 'Shift',
    })
  },

  // Reject a shift — keeps instructorId so admin sees red dot on correct row,
  // admin then decides whether to reassign
  async rejectShift(shift, userId, userName) {
    await updateDoc(doc(db, 'shifts', shift.id), {
      confirmationStatus: 'rejected',
      // intentionally keep instructorId so admin can see who rejected it
    })
    await createNotification({
      type:        'shift_rejected',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   userName,
      shiftId:     shift.id,
      shiftDate:   shift.date,
      shiftStart:  shift.start,
      shiftTitle:  shift.title || 'Shift',
    })
  },

  // Claim an open shift
  async claimShift(shift, userId, userName) {
    await updateDoc(doc(db, 'shifts', shift.id), {
      instructorId:       userId,
      claimable:          false,
      confirmationStatus: 'confirmed',
    })
    await createNotification({
      type:        'shift_claimed',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   userName,
      shiftId:     shift.id,
      shiftDate:   shift.date,
      shiftStart:  shift.start,
      shiftTitle:  shift.title || 'Shift',
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

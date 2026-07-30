import { create } from 'zustand'
import {
  collection, doc, onSnapshot, addDoc,
  updateDoc, deleteDoc, query, orderBy,
  serverTimestamp, writeBatch, getDocs,
} from 'firebase/firestore'
import { db } from '../utils/firebase'
import useAuthStore from './useAuthStore'

const sessionStart = Date.now()

const activeMsgUnsubs = new Map() // chatId -> unsubFn
let rootChatUnsub = null

function getMsgTime(m) {
  if (!m || !m.createdAt) return Date.now()
  if (typeof m.createdAt.toMillis === 'function') return m.createdAt.toMillis()
  if (typeof m.createdAt.seconds === 'number') return m.createdAt.seconds * 1000
  if (typeof m.createdAt === 'number') return m.createdAt
  if (typeof m.createdAt === 'string') return new Date(m.createdAt).getTime()
  return Date.now()
}

function syncMessageListener(chatId, set, get) {
  if (!chatId || activeMsgUnsubs.has(chatId)) return
  activeMsgUnsubs.set(chatId, () => {}) // Placeholder to prevent duplicate sync calls

  const q = collection(db, 'chats', chatId, 'messages')
  let isInitial = true

  const unsub = onSnapshot(q, (msgSnap) => {
    const list = msgSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => getMsgTime(a) - getMsgTime(b))

    set(s => {
      const currentList = s.messages[chatId] || []
      const optimisticMsgs = currentList.filter(m => m._optimistic && !list.some(real => real.text === m.text && real.authorId === m.authorId))
      return {
        messages: {
          ...s.messages,
          [chatId]: [...list, ...optimisticMsgs],
        },
      }
    })

    if (isInitial) {
      isInitial = false
      return
    }

    const currentUserId = useAuthStore.getState().user?.uid
    const hasNewIncoming = msgSnap.docChanges().some(change => {
      if (change.type !== 'added') return false
      const m = change.doc.data()
      if (!m || m.authorId === currentUserId) return false
      const createdTime = getMsgTime(m)
      return !createdTime || createdTime > sessionStart
    })

    if (hasNewIncoming) {
      import('../utils/sound').then(({ playNotificationSound }) => playNotificationSound()).catch(() => {})
    }
  }, (err) => {
    console.error(`Error loading messages for chat ${chatId}:`, err)
  })

  activeMsgUnsubs.set(chatId, unsub)
}

const useChatStore = create((set, get) => ({
  chats:        [],
  messages:     {},
  activeChatId: null,
  loading:      true,
  _initialized: false,

  init() {
    if (get()._initialized) return
    set({ _initialized: true })

    if (rootChatUnsub) rootChatUnsub()

    rootChatUnsub = onSnapshot(collection(db, 'chats'), (snap) => {
      const chats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const getSeconds = (val) => {
            if (!val) return 0
            if (val.seconds !== undefined) return val.seconds
            if (val._seconds !== undefined) return val._seconds
            if (typeof val.toDate === 'function') return Math.floor(val.toDate().getTime() / 1000)
            if (val instanceof Date) return Math.floor(val.getTime() / 1000)
            if (typeof val === 'number') return val > 1000000000000 ? Math.floor(val / 1000) : val
            if (typeof val === 'string') return Math.floor(new Date(val).getTime() / 1000)
            return 0
          }
          const aPin = getSeconds(a.pinnedAt)
          const bPin = getSeconds(b.pinnedAt)
          if (aPin !== bPin) return bPin - aPin
          return getSeconds(b.lastAt) - getSeconds(a.lastAt)
        })

      set({ chats, loading: false })

      // Garbage collect deleted chats
      const currentChatIds = new Set(chats.map(c => c.id))
      for (const [cId, unsubFn] of activeMsgUnsubs.entries()) {
        if (!currentChatIds.has(cId)) {
          try { unsubFn() } catch {}
          activeMsgUnsubs.delete(cId)
        }
      }

      // Establish message listeners without duplication
      chats.forEach(chat => {
        syncMessageListener(chat.id, set, get)
      })
    }, (err) => {
      console.error('Error loading chats:', err)
      set({ loading: false })
    })
  },

  cleanup() {
    if (rootChatUnsub) {
      try { rootChatUnsub() } catch {}
      rootChatUnsub = null
    }
    for (const [cId, unsubFn] of activeMsgUnsubs.entries()) {
      try { unsubFn() } catch {}
    }
    activeMsgUnsubs.clear()
    set({ _initialized: false, messages: {}, activeChatId: null, chats: [] })
  },

  setActiveChat(chatId) {
    set({ activeChatId: chatId })
    if (!chatId) return
    syncMessageListener(chatId, set, get)
  },

  async markChatRead(chatId, userId) {
    if (!chatId || !userId) return
    try {
      await updateDoc(doc(db, 'chats', chatId), { [`lastRead.${userId}`]: serverTimestamp() })
    } catch { /* ignore */ }
  },

  async sendMessage(chatId, payload) {
    const optId = `opt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optMsg = {
      id: optId,
      text: payload.text || '',
      attachments: payload.attachments || [],
      replyTo: payload.replyTo || null,
      authorId: payload.authorId,
      authorName: payload.authorName,
      reactions: {},
      createdAt: { seconds: Math.floor(Date.now() / 1000) },
      _optimistic: true,
    }

    // 1. Instant optimistic local UI update (0ms)
    set(s => ({
      messages: {
        ...s.messages,
        [chatId]: [...(s.messages[chatId] || []), optMsg],
      },
    }))

    try {
      // 2. Add message to Firestore
      await addDoc(collection(db, 'chats', chatId, 'messages'), {
        text:        payload.text || '',
        attachments: payload.attachments || [],
        replyTo:     payload.replyTo || null,
        authorId:    payload.authorId,
        authorName:  payload.authorName,
        reactions:   {},
        createdAt:   serverTimestamp(),
      })

      // 3. Update chat header
      await updateDoc(doc(db, 'chats', chatId), {
        lastMessage: payload.text
          ? (payload.text.length > 60 ? payload.text.slice(0, 60) + '…' : payload.text)
          : '📎 Attachment',
        lastAt: serverTimestamp(),
      })
    } catch (err) {
      console.error('sendMessage error:', err)
      // Rollback optimistic message on error
      set(s => ({
        messages: {
          ...s.messages,
          [chatId]: (s.messages[chatId] || []).filter(m => m.id !== optId),
        },
      }))
      throw err
    }
  },

  async pinChat(chatId, pinned) {
    await updateDoc(doc(db, 'chats', chatId), {
      pinnedAt: pinned ? serverTimestamp() : null,
    })
  },

  async deleteMessage(chatId, msgId) {
    await deleteDoc(doc(db, 'chats', chatId, 'messages', msgId))
  },

  async deleteChat(chatId) {
    const batch = writeBatch(db)
    const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'))
    msgsSnap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, 'chats', chatId))
    await batch.commit()

    if (activeMsgUnsubs.has(chatId)) {
      try { activeMsgUnsubs.get(chatId)() } catch {}
      activeMsgUnsubs.delete(chatId)
    }

    if (get().activeChatId === chatId) set({ activeChatId: null })
    set(s => ({
      messages: Object.fromEntries(Object.entries(s.messages).filter(([k]) => k !== chatId)),
    }))
  },

  async addReaction(chatId, msgId, emoji, userId) {
    const msg = (get().messages[chatId] || []).find(m => m.id === msgId)
    if (!msg) return
    const reactions = { ...msg.reactions }
    if (!reactions[emoji]) reactions[emoji] = []
    if (reactions[emoji].includes(userId)) {
      reactions[emoji] = reactions[emoji].filter(u => u !== userId)
      if (!reactions[emoji].length) delete reactions[emoji]
    } else {
      reactions[emoji] = [...reactions[emoji], userId]
    }
    await updateDoc(doc(db, 'chats', chatId, 'messages', msgId), { reactions })
  },

  async createChat({ name, members, isGroup, createdBy, icon, color, photo }) {
    const ref = await addDoc(collection(db, 'chats'), {
      name:        name || '',
      members:     members || [],
      isGroup:     isGroup || false,
      createdBy:   createdBy || null,
      createdAt:   serverTimestamp(),
      lastMessage: '',
      lastAt:      serverTimestamp(),
      pinnedAt:    null,
      icon:        icon || null,
      color:       color || null,
      photo:       photo || null,
    })
    return ref.id
  },
}))

export default useChatStore

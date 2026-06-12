import { create } from 'zustand'
import {
  collection, doc, onSnapshot, addDoc,
  updateDoc, deleteDoc, query, orderBy,
  serverTimestamp, writeBatch, getDocs,
} from 'firebase/firestore'
import { db } from '../utils/firebase'

const useChatStore = create((set, get) => ({
  chats:        [],
  messages:     {},
  activeChatId: null,
  loading:      true,
  _unsubs:      [],

  init() {
    const unsubChats = onSnapshot(collection(db, 'chats'), (snap) => {
      const chats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          // Pinned chats first, then by lastAt
          const aPin = a.pinnedAt?.seconds || 0
          const bPin = b.pinnedAt?.seconds || 0
          if (aPin !== bPin) return bPin - aPin
          return (b.lastAt?.seconds || 0) - (a.lastAt?.seconds || 0)
        })
      set({ chats, loading: false })

      // garbage collect deleted or removed chat listeners
      const currentChatIds = chats.map(c => c.id)
      const unsubsToKeep = []
      const unsubsToRemove = []

      get()._unsubs.forEach(unsub => {
        // If it's a message listener and its chat is no longer in currentChatIds, clean it up!
        if (unsub._chatId && unsub._chatId !== 'root-chats' && !currentChatIds.includes(unsub._chatId)) {
          unsubsToRemove.push(unsub)
        } else {
          unsubsToKeep.push(unsub)
        }
      })

      // Unsubscribe and delete local messages
      unsubsToRemove.forEach(unsub => {
        try { unsub() } catch (err) { console.error('Unsub error:', err) }
      })

      set(s => {
        const nextMessages = { ...s.messages }
        unsubsToRemove.forEach(unsub => {
          delete nextMessages[unsub._chatId]
        })
        return {
          _unsubs: unsubsToKeep,
          messages: nextMessages
        }
      })

      // Establish new message listeners
      chats.forEach(chat => {
        if (get()._unsubs.some(u => u._chatId === chat.id)) return
        const q = query(collection(db, 'chats', chat.id, 'messages'), orderBy('createdAt', 'asc'))
        const unsub = onSnapshot(q, (msgSnap) => {
          set(s => ({
            messages: {
              ...s.messages,
              [chat.id]: msgSnap.docs.map(d => ({ id: d.id, ...d.data() })),
            },
          }))
        }, (err) => {
          console.error(`Error loading messages for chat ${chat.id}:`, err)
        })
        unsub._chatId = chat.id
        set(s => ({ _unsubs: [...s._unsubs, unsub] }))
      })
    }, (err) => {
      console.error('Error loading chats:', err)
      set({ loading: false })
    })
    unsubChats._chatId = 'root-chats'
    set(s => ({ _unsubs: [...s._unsubs, unsubChats] }))
  },

  cleanup() {
    get()._unsubs.forEach(fn => fn())
    set({ _unsubs: [], messages: {}, activeChatId: null })
  },

  setActiveChat(chatId) {
    set({ activeChatId: chatId })
    if (!chatId) return
    if (get()._unsubs.some(u => u._chatId === chatId)) return
    const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'))
    const unsub = onSnapshot(q, (snap) => {
      set(s => ({
        messages: {
          ...s.messages,
          [chatId]: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        },
      }))
    }, (err) => {
      console.error(`Error loading messages for active chat ${chatId}:`, err)
    })
    unsub._chatId = chatId
    set(s => ({ _unsubs: [...s._unsubs, unsub] }))
  },

  async markChatRead(chatId, userId) {
    if (!chatId || !userId) return
    try {
      await updateDoc(doc(db, 'chats', chatId), { [`lastRead.${userId}`]: serverTimestamp() })
    } catch { /* ignore */ }
  },

  async sendMessage(chatId, payload) {
    await addDoc(collection(db, 'chats', chatId, 'messages'), {
      text:        payload.text || '',
      attachments: payload.attachments || [],
      replyTo:     payload.replyTo || null,
      authorId:    payload.authorId,
      authorName:  payload.authorName,
      reactions:   {},
      createdAt:   serverTimestamp(),
    })
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: payload.text
        ? (payload.text.length > 60 ? payload.text.slice(0, 60) + '…' : payload.text)
        : '📎 Attachment',
      lastAt: serverTimestamp(),
    })
  },

  // ── Pin / Unpin chat ────────────────────────────────────────────────────────
  async pinChat(chatId, pinned) {
    await updateDoc(doc(db, 'chats', chatId), {
      pinnedAt: pinned ? serverTimestamp() : null,
    })
  },

  // ── Delete a single message ────────────────────────────────────────────────
  async deleteMessage(chatId, msgId) {
    await deleteDoc(doc(db, 'chats', chatId, 'messages', msgId))
  },

  // ── Delete entire chat + all its messages ─────────────────────────────────
  async deleteChat(chatId) {
    const batch = writeBatch(db)
    // Delete all messages first
    const msgsSnap = await getDocs(collection(db, 'chats', chatId, 'messages'))
    msgsSnap.docs.forEach(d => batch.delete(d.ref))
    batch.delete(doc(db, 'chats', chatId))
    await batch.commit()
    // Clean up local state
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

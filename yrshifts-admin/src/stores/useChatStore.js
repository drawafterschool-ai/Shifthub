import { create } from 'zustand'
import {
  collection, doc, onSnapshot, addDoc,
  updateDoc, query, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db }  from '../utils/firebase'

const useChatStore = create((set, get) => ({
  chats:        [],
  messages:     {},
  activeChatId: null,
  loading:      true,
  _unsubs:      [],

  init() {
    const unsub = onSnapshot(collection(db, 'chats'), (snap) => {
      const chats = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.lastAt?.seconds || 0) - (a.lastAt?.seconds || 0))
      set({ chats, loading: false })
    })
    set(s => ({ _unsubs: [...s._unsubs, unsub] }))
  },

  cleanup() {
    get()._unsubs.forEach(fn => fn())
    set({ _unsubs: [], messages: {}, activeChatId: null })
  },

  setActiveChat(chatId) {
    set({ activeChatId: chatId })
    if (!chatId) return
    if (get()._unsubs.some(u => u._chatId === chatId)) return
    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('createdAt', 'asc'),
    )
    const unsub = onSnapshot(q, (snap) => {
      set(s => ({
        messages: {
          ...s.messages,
          [chatId]: snap.docs.map(d => ({ id: d.id, ...d.data() })),
        },
      }))
    })
    unsub._chatId = chatId
    set(s => ({ _unsubs: [...s._unsubs, unsub] }))
  },

  async markChatRead(chatId, userId) {
    if (!chatId || !userId) return
    try {
      await updateDoc(doc(db, 'chats', chatId), {
        [`lastRead.${userId}`]: serverTimestamp(),
      })
    } catch (e) { /* ignore */ }
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

  async createChat({ name, members, isGroup }) {
    const ref = await addDoc(collection(db, 'chats'), {
      name:        name || '',
      members:     members || [],
      isGroup:     isGroup || false,
      createdAt:   serverTimestamp(),
      lastMessage: '',
      lastAt:      serverTimestamp(),
    })
    return ref.id
  },
}))

export default useChatStore

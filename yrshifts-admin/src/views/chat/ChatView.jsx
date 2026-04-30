import { useState, useEffect, useRef, useMemo } from 'react'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { resizeFile } from '../../utils/resizeFile'
import { storage }    from '../../utils/firebase'
import useChatStore    from '../../stores/useChatStore'
import useAuthStore        from '../../stores/useAuthStore'
import useDirectoryStore   from '../../stores/useDirectoryStore'
import Avatar              from '../../components/Avatar'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'
import Button              from '../../components/Button'
import { uid }         from '../../utils/helpers'

const EMOJIS = ['👍','❤️','😂','🎉','🔥','👀','🙌','✅','😮','😢']

function fmtTime(ts) {
  if (!ts) return ''
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtChatTime(ts) {
  if (!ts) return ''
  const d    = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  const diff = Date.now() - d
  if (diff < 60000)    return 'Now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Forward sheet ─────────────────────────────────────────────────────────────
function ForwardSheet({ text, chats, onClose, onForward }) {
  const [q, setQ] = useState('')
  const filtered  = chats.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-t-3xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-2 border-b border-app">
          <div className="w-10 h-1 rounded-full bg-raised mx-auto mb-3" />
          <p className="text-sm font-bold text-primary mb-2">Forward to…</p>
          <div className="bg-raised border border-app rounded-xl px-3 py-2 text-xs text-muted italic truncate mb-3">
            "{text?.slice(0, 70)}{text?.length > 70 ? '…' : ''}"
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" autoFocus
            className="w-full bg-raised border border-app rounded-xl px-3 py-2 text-sm text-primary placeholder:text-dim outline-none" />
        </div>
        <div className="overflow-y-auto max-h-64">
          {filtered.map(c => (
            <button key={c.id} onClick={() => onForward(c)}
              className="flex items-center gap-3 w-full px-4 py-3 text-left cursor-pointer bg-transparent border-none border-b border-app/20 hover:bg-raised transition-colors">
              <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center text-base flex-shrink-0">
                {c.isGroup ? '👥' : '💬'}
              </div>
              <span className="text-sm font-medium text-primary truncate">{c.name}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="text-sm text-dim text-center py-6">No chats found</p>}
        </div>
        <div className="px-4 py-3">
          <button onClick={onClose}
            className="w-full py-3 rounded-2xl border border-app text-sm font-semibold text-muted cursor-pointer bg-transparent">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function Bubble({ msg, isMine, onReact, onReply, onForward }) {
  const [showActions, setShowActions] = useState(false)
  const [showEmoji,   setShowEmoji]   = useState(false)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).some(k => msg.reactions[k]?.length > 0)

  return (
    <div className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
      {!isMine && <span className="text-xs font-semibold text-accent px-1">{msg.authorName}</span>}

      {/* Reply preview */}
      {msg.replyTo && (
        <div className={`max-w-[80%] px-3 py-1.5 rounded-xl border-l-2 border-accent text-xs mb-0.5
          ${isMine ? 'bg-white/10 self-end' : 'bg-raised'}`}>
          <span className="font-semibold text-accent">{msg.replyTo.authorName} </span>
          <span className="text-muted">{msg.replyTo.text?.slice(0, 50)}</span>
        </div>
      )}

      {/* Bubble + long-press actions */}
      <div className={`flex items-end gap-2 ${isMine ? 'flex-row-reverse' : ''}`}>
        <div
          className={`relative max-w-[78vw] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed cursor-pointer select-none
            ${isMine ? 'bg-accent text-white rounded-br-sm' : 'bg-card border border-app text-primary rounded-bl-sm'}`}
          onClick={() => setShowActions(v => !v)}
        >
          {msg.attachments?.map(a => (
            <div key={a.id} className="mb-2 last:mb-0">
              {a.type?.startsWith('image/') ? (
                <img src={a.url} alt={a.name} className="rounded-xl max-w-full max-h-40 object-cover block" />
              ) : (
                <a href={a.url} target="_blank" rel="noreferrer"
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold no-underline
                    ${isMine ? 'bg-white/20 text-white' : 'bg-raised text-primary'}`}>
                  📄 {a.name}
                </a>
              )}
            </div>
          ))}
          {msg.text && <p className="whitespace-pre-wrap break-words">{msg.text}</p>}
          <p className={`text-[10px] mt-1 text-right ${isMine ? 'text-white/60' : 'text-dim'}`}>
            {fmtTime(msg.createdAt)}
          </p>
        </div>

        {/* Inline action buttons (visible after tap) */}
        {showActions && (
          <div className={`flex flex-col gap-1 ${isMine ? 'items-end' : 'items-start'}`}>
            <div className="relative">
              <button onClick={() => setShowEmoji(v => !v)}
                className="w-8 h-8 rounded-xl bg-card border border-app text-sm flex items-center justify-center cursor-pointer">
                😊
              </button>
              {showEmoji && (
                <>
                  <div onClick={() => setShowEmoji(false)} className="fixed inset-0 z-10" />
                  <div className={`absolute z-20 bottom-full mb-1 bg-card border border-app rounded-2xl p-2.5 flex flex-wrap gap-2 shadow-xl w-52
                    ${isMine ? 'right-0' : 'left-0'}`}>
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => { onReact(e); setShowEmoji(false); setShowActions(false) }}
                        className="text-xl cursor-pointer bg-transparent border-none p-1 rounded hover:bg-raised">{e}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {!isMine && (
              <button onClick={() => { onReply(); setShowActions(false) }}
                className="w-8 h-8 rounded-xl bg-card border border-app text-sm flex items-center justify-center cursor-pointer">↩</button>
            )}
            <button onClick={() => { onForward(); setShowActions(false) }}
              className="w-8 h-8 rounded-xl bg-card border border-app text-sm flex items-center justify-center cursor-pointer">↗</button>
            {isMine && (
              <button onClick={() => { if (window.confirm('Delete message?')) onDelete(); setShowActions(false) }}
                className="w-8 h-8 rounded-xl bg-danger-soft border border-danger/30 text-danger text-sm flex items-center justify-center cursor-pointer">🗑</button>
            )}
          </div>
        )}
      </div>

      {/* Reactions */}
      {hasReactions && (
        <div className={`flex flex-wrap gap-1 px-1 ${isMine ? 'justify-end' : ''}`}>
          {Object.entries(msg.reactions).map(([emoji, users]) => users.length > 0 && (
            <button key={emoji} onClick={() => onReact(emoji)}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full border border-app bg-raised text-xs font-semibold cursor-pointer">
              <span>{emoji}</span><span className="text-muted">{users.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


// ── New Chat Modal (owner/admin only) ─────────────────────────────────────────
function NewChatModal({ onClose, onCreate, adminId }) {
  const { instructors } = useDirectoryStore()
  const [step, setStep]   = useState('pick')
  const [sel,  setSel]    = useState(null)
  const [busy, setBusy]   = useState(false)

  const teacherIds = instructors.map(i => i.id)

  const createInstant = async (opts) => {
    setBusy(true)
    try { await onCreate(opts); onClose() }
    finally { setBusy(false) }
  }

  if (step === 'dm') return (
    <Modal onClose={onClose} width="max-w-md">
      <ModalHeader title="Direct message" onClose={onClose} />
      <div className="max-h-64 overflow-y-auto flex flex-col gap-1 mb-4">
        {instructors.map(i => (
          <button key={i.id} onClick={() => setSel(i.id)}
            className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer border transition-colors text-left w-full bg-transparent
              ${sel === i.id ? 'bg-accent-soft border-accent/30' : 'border-transparent hover:bg-raised'}`}>
            <Avatar firstName={i.firstName} lastName={i.lastName} color={i.color} photo={i.photo} size={28} />
            <span className="text-sm font-medium text-primary">{i.firstName} {i.lastName}</span>
          </button>
        ))}
      </div>
      <ModalFooter>
        <Button onClick={() => setStep('pick')}>← Back</Button>
        <Button variant="primary" disabled={!sel || busy}
          onClick={() => {
            const person = instructors.find(i => i.id === sel)
            createInstant({ name: `${person?.firstName} ${person?.lastName}`, members: [sel, adminId], isGroup: false, createdBy: adminId })
          }}>
          {busy ? 'Starting…' : 'Start chat'}
        </Button>
      </ModalFooter>
    </Modal>
  )

  return (
    <Modal onClose={onClose} width="max-w-sm">
      <ModalHeader title="New conversation" onClose={onClose} />
      <div className="flex flex-col gap-3 py-2">
        <button onClick={() => createInstant({ name: 'Group Chat', members: [...teacherIds, adminId], isGroup: true, createdBy: adminId })}
          disabled={busy}
          className="flex items-center gap-4 p-4 rounded-2xl border border-app bg-card hover:border-accent/50 hover:bg-raised cursor-pointer transition-colors text-left w-full disabled:opacity-50">
          <div className="w-11 h-11 rounded-xl bg-accent-soft flex items-center justify-center text-xl flex-shrink-0">👥</div>
          <div>
            <p className="text-sm font-bold text-primary">New group chat</p>
            <p className="text-xs text-muted mt-0.5">All users</p>
          </div>
        </button>
        <button onClick={() => setStep('dm')} disabled={busy}
          className="flex items-center gap-4 p-4 rounded-2xl border border-app bg-card hover:border-accent/50 hover:bg-raised cursor-pointer transition-colors text-left w-full disabled:opacity-50">
          <div className="w-11 h-11 rounded-xl bg-accent-soft flex items-center justify-center text-xl flex-shrink-0">💬</div>
          <div>
            <p className="text-sm font-bold text-primary">New direct message</p>
            <p className="text-xs text-muted mt-0.5">Private chat with one person</p>
          </div>
        </button>
      </div>
      <ModalFooter><Button onClick={onClose}>Cancel</Button></ModalFooter>
    </Modal>
  )
}

// ── Main ChatView ──────────────────────────────────────────────────────────────
export default function ChatView() {
  const { chats, messages, activeChatId, loading, setActiveChat, markChatRead, sendMessage, addReaction, pinChat, deleteMessage, deleteChat } = useChatStore()
  const { user, userProfile }  = useAuthStore()

  const [msgText,     setMsgText]     = useState('')
  const [replyTo,     setReplyTo]     = useState(null)
  const [attachments, setAttachments] = useState([])
  const [uploading,   setUploading]   = useState(false)
  const [sending,     setSending]     = useState(false)
  const [forwardMsg,  setForwardMsg]  = useState(null)
  const [fwdToast,    setFwdToast]    = useState('')
  const [inputEmoji,  setInputEmoji]  = useState(false)
  const [showList,    setShowList]    = useState(true)
  const [showDMPicker,setShowDMPicker]= useState(false)
  const [showNew,     setShowNew]     = useState(false)

  const fileRef    = useRef(null)
  const msgListRef = useRef(null)
  const inputRef   = useRef(null)

  const activeChat = chats.find(c => c.id === activeChatId)
  const activeMsgs = messages[activeChatId] || []

  useEffect(() => {
    if (msgListRef.current) msgListRef.current.scrollTop = msgListRef.current.scrollHeight
    if (activeChatId && user) markChatRead(activeChatId, user.uid)
  }, [activeMsgs.length, activeChatId])

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files); if (!files.length) return
    setUploading(true)
    try {
      const added = []
      for (const f of files) {
        let processed
        try { processed = await resizeFile(f) }
        catch (sizeErr) { alert(sizeErr.message); continue }
        const snap = await uploadBytes(stRef(storage, `chat_attachments/${uid()}_${processed.name}`), processed)
        const url  = await getDownloadURL(snap.ref)
        added.push({ id: uid(), name: f.name, url, type: f.type })
      }
      setAttachments(prev => [...prev, ...added])
    } catch (e) { console.error(e) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const handleSend = async () => {
    if ((!msgText.trim() && !attachments.length) || !activeChatId || sending) return
    setSending(true)
    try {
      await sendMessage(activeChatId, {
        text:        msgText.trim(),
        attachments,
        replyTo,
        authorId:    user?.uid,
        authorName:  userProfile?.firstName || 'Teacher',
      })
      setMsgText(''); setAttachments([]); setReplyTo(null)
    } finally { setSending(false) }
  }

  const handleForward = async (targetChat) => {
    if (!forwardMsg) return
    await sendMessage(targetChat.id, {
      text:        `↗ Forwarded: ${forwardMsg.text || ''}`,
      attachments: forwardMsg.attachments || [],
      replyTo:     null,
      authorId:    user?.uid,
      authorName:  userProfile?.firstName || 'Teacher',
    })
    setForwardMsg(null)
    setFwdToast(`Forwarded to ${targetChat.name}`)
    setTimeout(() => setFwdToast(''), 2000)
  }

  const handleCreateChat = async (opts) => {
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore')
    const { db } = await import('../../utils/firebase')
    await addDoc(collection(db, 'chats'), {
      name: opts.name || '', members: opts.members || [],
      isGroup: opts.isGroup || false, createdBy: opts.createdBy || null,
      createdAt: serverTimestamp(), lastMessage: '', lastAt: serverTimestamp(), pinnedAt: null,
    })
  }

  const openChat = (id) => {
    setActiveChat(id)
    setShowList(false)
  }

  // ── Chat list panel ────────────────────────────────────────────────────────
  if (showList) return (
    <div className="h-full flex flex-col bg-app">
      <div className="px-4 py-3 bg-surface border-b border-app flex items-center justify-between">
        <h2 className="text-base font-bold text-primary">Chat</h2>
        <div className="flex gap-2">
          {/* Owner/Admin get full new chat modal (DM + groups) */}
          {['owner','admin'].includes(userProfile?.role) ? (
            <button onClick={() => setShowNew(true)}
              className="w-8 h-8 rounded-xl bg-accent text-white flex items-center justify-center text-lg font-bold cursor-pointer border-none">
              ✏️
            </button>
          ) : (
            <button onClick={() => setShowDMPicker(true)}
              className="w-8 h-8 rounded-xl bg-accent text-white flex items-center justify-center text-lg font-bold cursor-pointer border-none">
              ✏️
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <p className="text-3xl mb-2">💬</p>
            <p className="text-sm font-semibold text-muted">No conversations yet</p>
            <p className="text-xs text-dim mt-1 mb-4">Tap ✏️ to message a colleague</p>
          </div>
        ) : chats.filter(chat => {
            // Hide DMs that don't involve the current admin user
            if (!chat.isGroup) {
              const members = chat.members || []
              if (!members.includes(user?.uid)) return false
            }
            return true
          }).map(chat => (
          <div key={chat.id} className="relative group">
            <button onClick={() => openChat(chat.id)}
              className="flex items-center gap-3 w-full px-4 py-3.5 text-left cursor-pointer bg-transparent border-none border-b border-app/20 hover:bg-raised transition-colors">
              <div className="w-11 h-11 rounded-full bg-accent-soft flex items-center justify-center text-xl flex-shrink-0">
                {chat.isGroup ? '👥' : '💬'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {chat.pinnedAt && <span className="text-xs">📌</span>}
                  <p className="text-sm font-bold text-primary truncate">{chat.name}</p>
                </div>
                <p className="text-xs text-dim truncate mt-0.5">{chat.lastMessage || 'No messages yet'}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-2xs text-dim">{fmtChatTime(chat.lastAt)}</span>
                {(() => {
                  const lastReadTs = user ? (chat.lastRead?.[user.uid]?.seconds || 0) : 0
                  const msgs       = messages[chat.id] || []
                  const unread     = msgs.filter(m => m.authorId !== user?.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
                  return unread > 0 ? (
                    <span className="min-w-[18px] h-[18px] rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1">{unread > 9 ? '9+' : unread}</span>
                  ) : null
                })()}
              </div>
            </button>
            {/* Hover actions */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-1 bg-card border border-app rounded-lg p-1 z-10">
              <button onClick={e => { e.stopPropagation(); pinChat(chat.id, !chat.pinnedAt) }}
                className="w-7 h-7 rounded-md hover:bg-raised flex items-center justify-center text-sm cursor-pointer bg-transparent border-none text-muted"
                title={chat.pinnedAt ? 'Unpin' : 'Pin to top'}>
                {chat.pinnedAt ? '📌' : '📍'}
              </button>
              {(chat.createdBy === user?.uid || !chat.createdBy || ['owner','admin'].includes(userProfile?.role)) && (
                <button onClick={e => { e.stopPropagation(); if (window.confirm('Delete this chat?')) deleteChat(chat.id) }}
                  className="w-7 h-7 rounded-md hover:bg-danger-soft flex items-center justify-center text-sm cursor-pointer bg-transparent border-none text-danger"
                  title="Delete chat">🗑</button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* New Chat Modal (owner/admin) */}
      {showNew && (
        <NewChatModal onClose={() => setShowNew(false)} onCreate={handleCreateChat} adminId={user?.uid} />
      )}

      {/* DM Picker — must be inside showList block */}
      {showDMPicker && (
        <DMPicker
          chats={chats}
          currentUserId={user?.uid}
          onClose={() => setShowDMPicker(false)}
          onStartDM={async (otherId, otherName) => {
            const { addDoc, collection, query, where, getDocs, serverTimestamp } = await import('firebase/firestore')
            const { db } = await import('../../utils/firebase')
            const myId = user?.uid
            const q = query(collection(db, 'chats'), where('isGroup', '==', false))
            const snap = await getDocs(q)
            const existing = snap.docs.find(d => {
              const m = d.data().members || []
              return m.includes(myId) && m.includes(otherId)
            })
            let chatId
            if (existing) {
              chatId = existing.id
            } else {
              const ref = await addDoc(collection(db, 'chats'), {
                name: otherName, members: [myId, otherId],
                isGroup: false, createdAt: serverTimestamp(),
                lastMessage: '', lastAt: serverTimestamp(),
              })
              chatId = ref.id
            }
            setShowDMPicker(false)
            setShowList(false)
            setActiveChat(chatId)
          }}
        />
      )}
    </div>
  )

  // ── Message pane ───────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col bg-app">

      {/* Header with back button */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface border-b border-app flex-shrink-0">
        <button onClick={() => setShowList(true)}
          className="text-accent text-lg cursor-pointer bg-transparent border-none leading-none">‹</button>
        <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center text-base">
          {activeChat?.isGroup ? '👥' : '💬'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-primary truncate">{activeChat?.name}</p>
          <p className="text-xs text-dim">{activeChat?.isGroup ? `${activeChat?.members?.length || 0} members` : 'Direct message'}</p>
        </div>
        {(activeChat?.createdBy === user?.uid || !activeChat?.createdBy || ['owner','admin'].includes(userProfile?.role)) && (
          <button onClick={() => { if (window.confirm('Delete this chat?')) { deleteChat(activeChat?.id); setShowList(true) } }}
            className="w-8 h-8 rounded-xl hover:bg-danger-soft border border-app flex items-center justify-center text-danger cursor-pointer bg-transparent"
            title="Delete chat">🗑</button>
        )}
      </div>

      {/* Messages */}
      <div ref={msgListRef} className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {activeMsgs.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <p className="text-3xl mb-2">💬</p>
            <p className="text-sm font-semibold text-muted">No messages yet — say hello!</p>
          </div>
        )}
        {activeMsgs.map(msg => {
          const isMine = msg.authorId === user?.uid
          return (
            <Bubble key={msg.id} msg={msg} isMine={isMine}
              onReact={(emoji) => addReaction(activeChatId, msg.id, emoji, user?.uid)}
              onReply={() => { setReplyTo(msg); inputRef.current?.focus() }}
              onForward={() => setForwardMsg(msg)} />
          )
        })}
      </div>

      {/* Reply banner */}
      {replyTo && (
        <div className="mx-3 mb-1 px-3 py-2 bg-raised border-l-2 border-accent rounded-r-xl flex items-center justify-between flex-shrink-0">
          <div className="min-w-0">
            <p className="text-xs font-bold text-accent">{replyTo.authorName}</p>
            <p className="text-xs text-muted truncate">{replyTo.text?.slice(0, 60)}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="ml-2 text-dim text-base cursor-pointer bg-transparent border-none flex-shrink-0">×</button>
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mx-3 mb-1 flex flex-wrap gap-2 flex-shrink-0">
          {attachments.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-raised border border-app rounded-xl text-xs">
              {a.type?.startsWith('image/') ? '🖼️' : '📄'}
              <span className="text-primary max-w-[100px] truncate">{a.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                className="text-dim cursor-pointer bg-transparent border-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="px-3 py-2.5 bg-surface border-t border-app flex items-end gap-2 flex-shrink-0 safe-bottom">
        {/* Attach */}
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="w-9 h-9 rounded-xl border border-app bg-raised flex items-center justify-center text-base cursor-pointer flex-shrink-0 disabled:opacity-50">
          {uploading ? '⏳' : '📎'}
        </button>
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />

        {/* Emoji */}
        <div className="relative flex-shrink-0">
          <button onClick={() => setInputEmoji(v => !v)}
            className="w-9 h-9 rounded-xl border border-app bg-raised flex items-center justify-center text-base cursor-pointer">
            😊
          </button>
          {inputEmoji && (
            <>
              <div onClick={() => setInputEmoji(false)} className="fixed inset-0 z-10" />
              <div className="absolute bottom-full mb-2 left-0 z-20 bg-card border border-app rounded-2xl p-2.5 flex flex-wrap gap-2 shadow-xl w-52">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => { setMsgText(t => t + e); setInputEmoji(false); inputRef.current?.focus() }}
                    className="text-xl cursor-pointer bg-transparent border-none p-1 rounded">{e}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Text */}
        <div className="flex-1 bg-raised border border-app rounded-2xl px-3.5 py-2 flex items-end">
          <textarea ref={inputRef} value={msgText} onChange={e => setMsgText(e.target.value)}
            placeholder="Message…" rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            style={{ resize: 'none', maxHeight: 100, overflow: 'auto' }}
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-dim outline-none resize-none" />
        </div>

        {/* Send */}
        <button onClick={handleSend}
          disabled={(!msgText.trim() && !attachments.length) || sending}
          className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center text-sm cursor-pointer border-none hover:opacity-90 disabled:opacity-40 flex-shrink-0">
          {sending ? '…' : '➤'}
        </button>
      </div>

      {/* Forward sheet */}
      {forwardMsg && (
        <ForwardSheet text={forwardMsg.text}
          chats={chats.filter(c => c.id !== activeChatId)}
          onClose={() => setForwardMsg(null)}
          onForward={handleForward} />
      )}

      {/* Forward toast */}
      {fwdToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-ok text-white text-xs font-bold rounded-xl z-50 whitespace-nowrap">
          ✅ {fwdToast}
        </div>
      )}



    </div>
  )
}

// ── DM Picker ─────────────────────────────────────────────────────────────────
function DMPicker({ chats, onClose, onStartDM, currentUserId }) {
  const [q, setQ]       = useState('')
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    import('firebase/firestore').then(({ collection, getDocs }) =>
      import('../../utils/firebase').then(({ db }) => {
        // Fetch ALL users so teachers can DM admins too
        getDocs(collection(db, 'users')).then(snap => {
          setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })))
          setLoading(false)
        })
      })
    )
  }, [])

  const filtered = users.filter(u =>
    u.id !== currentUserId &&
    `${u.firstName} ${u.lastName}`.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div className="bg-surface rounded-t-3xl overflow-hidden animate-slide-up max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="px-4 pt-3 pb-2 border-b border-app flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-raised mx-auto mb-3" />
          <p className="text-sm font-bold text-primary mb-3">New message</p>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search people…" autoFocus
            className="w-full bg-raised border border-app rounded-xl px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-dim text-center py-8">No people found</p>
          ) : filtered.map(u => (
            <button key={u.id}
              onClick={() => onStartDM(u.id, `${u.firstName} ${u.lastName || ''}`.trim())}
              className="flex items-center gap-3 w-full px-4 py-3 text-left cursor-pointer bg-transparent border-none border-b border-app/20 hover:bg-raised">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                style={{ background: u.color || 'var(--accent)' }}>
                {u.firstName?.[0]}{u.lastName?.[0]}
              </div>
              <div>
                <p className="text-sm font-semibold text-primary">{u.firstName} {u.lastName}</p>
                <p className="text-xs text-dim capitalize">{u.role || 'teacher'}</p>
              </div>
            </button>
          ))}
        </div>
        <div className="px-4 py-3 flex-shrink-0">
          <button onClick={onClose}
            className="w-full py-3 rounded-2xl border border-app text-sm font-semibold text-muted cursor-pointer bg-transparent">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

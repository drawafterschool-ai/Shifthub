import { useState, useEffect, useRef, useMemo } from 'react'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage }    from '../../utils/firebase'
import useChatStore    from '../../stores/useChatStore'
import useAuthStore    from '../../stores/useAuthStore'
import useTeacherStore from '../../stores/useTeacherStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import Avatar          from '../../components/Avatar'
import { uid }         from '../../utils/helpers'

const EMOJIS = ['👍','❤️','😂','🎉','🔥','👀','🙌','✅','😮','😢']

const isImgAttachment = (a) => {
  if (a.type?.startsWith('image/')) return true
  const ext = a.name?.split('.').pop()?.toLowerCase()
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtChatTime(ts) {
  if (!ts) return ''
  const d    = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  if (isNaN(d.getTime())) return ''
  const diff = Date.now() - d
  if (diff < 60000)    return 'Now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const getChatProfile = (chat, currentUser, instructors) => {
  if (!chat) return { name: '', photo: null, color: '#6366F1', firstName: '', lastName: '', icon: null }
  if (chat.isGroup) {
    return {
      name: chat.name,
      photo: chat.photo || null,
      color: chat.color || '#4EA8D6',
      icon: chat.icon || null,
      firstName: chat.name,
      lastName: ''
    }
  }
  const otherId = chat.members?.find(id => id !== currentUser?.uid)
  const otherUser = instructors?.find(i => i.id === otherId)
  if (otherUser) {
    return {
      name: `${otherUser.firstName} ${otherUser.lastName || ''}`.trim(),
      photo: otherUser.photo || null,
      color: otherUser.color || '#6366F1',
      firstName: otherUser.firstName,
      lastName: otherUser.lastName || '',
      icon: null
    }
  }
  return { name: chat.name, photo: null, color: '#6366F1', firstName: chat.name, lastName: '', icon: null }
}

// ── Forward sheet ─────────────────────────────────────────────────────────────
function ForwardSheet({ text, chats, onClose, onForward }) {
  const [q, setQ] = useState('')
  const myChats   = chats.filter(c => c.isGroup || (c.members || []).includes(user?.uid))
  const filtered  = myChats.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
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
// Read-receipt helper: serverTimestamp | seconds-shape | null → millis
function tsMillis(ts) {
  if (!ts) return null
  if (ts.toMillis) return ts.toMillis()
  if (ts.seconds) return ts.seconds * 1000
  return null
}

function Bubble({ msg, isMine, read, onReact, onReply, onForward, onDelete }) {
  const [showActions, setShowActions] = useState(false)
  const [showEmoji,   setShowEmoji]   = useState(false)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).some(k => msg.reactions[k]?.length > 0)

  const touchTimer = useRef(null)
  const touchActive = useRef(false)

  const handleTouchStart = () => {
    touchActive.current = true
    if (touchTimer.current) clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => {
      if (touchActive.current) {
        setShowActions(true)
        if (navigator.vibrate) navigator.vibrate(40)
      }
    }, 500)
  }

  const handleTouchEnd = () => {
    touchActive.current = false
    if (touchTimer.current) clearTimeout(touchTimer.current)
  }

  const handleTouchMove = () => {
    touchActive.current = false
    if (touchTimer.current) clearTimeout(touchTimer.current)
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    setShowActions(true)
  }

  return (
    <div className={`w-full flex flex-col gap-1.5 ${isMine ? 'items-end' : 'items-start'}`}>
      {!isMine && <span className="text-sm font-semibold text-accent px-1">{msg.authorName}</span>}

      {/* Reply preview */}
      {msg.replyTo && (
        <div className={`max-w-[85%] md:max-w-[500px] px-4 py-2 rounded-xl border-l-2 border-accent text-sm mb-0.5
          ${isMine ? 'bg-white/10 self-end' : 'bg-raised'}`}>
          <span className="font-semibold text-accent">{msg.replyTo.authorName} </span>
          <span className="text-muted">{msg.replyTo.text?.slice(0, 50)}</span>
        </div>
      )}

      {/* Bubble + actions */}
      <div className={`flex items-end gap-2.5 max-w-[85%] md:max-w-[500px] ${isMine ? 'flex-row-reverse' : ''}`}>
        <div
          className={`relative min-w-[70px] px-6 py-3 rounded-3xl text-base leading-relaxed cursor-pointer select-none
            ${isMine ? 'bg-accent text-white' : 'bg-card border border-app text-primary'}`}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
          onContextMenu={handleContextMenu}
          onClick={() => setShowActions(true)}
        >
          {msg.attachments?.map(a => (
            <div key={a.id} className="mb-2 last:mb-0">
              {isImgAttachment(a) ? (
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
          {(msg.text || msg.createdAt) && (
            <div className="text-base leading-snug break-words whitespace-pre-wrap">
              {msg.text ? (
                <span>{msg.text}</span>
              ) : null}
              {msg.createdAt && (
                <span className="inline-flex items-center gap-1 select-none text-[10px] font-medium leading-none ml-2.5 align-baseline whitespace-nowrap">
                  <span className={isMine ? 'text-white/70' : 'text-dim'}>
                    {fmtTime(msg.createdAt)}
                  </span>
                  {isMine && (
                    <span className={`leading-none text-xs ml-0.5 select-none font-bold tracking-tighter ${read ? 'text-white' : 'text-white/45'}`}
                      title={read ? 'Read' : 'Sent'}>
                      {read ? '✓✓' : '✓'}
                    </span>
                  )}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions Bottom Sheet Modal */}
        {showActions && (
          <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/60 px-4 pb-8"
            onClick={() => setShowActions(false)}>
            <div className="w-full max-w-sm bg-surface border border-app rounded-3xl overflow-hidden animate-slide-up"
              style={{ background: 'var(--dropdown-bg)' }}
              onClick={e => e.stopPropagation()}>
              {/* Drag handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 rounded-full bg-raised" />
              </div>
              
              {/* Horizontal Emoji Row */}
              <div className="flex items-center justify-around px-5 py-3.5 border-b border-app">
                {['👍', '❤️', '😂', '😮', '😢', '🎉'].map(emoji => (
                  <button key={emoji} onClick={() => { onReact(emoji); setShowActions(false) }}
                    className="text-2xl hover:scale-125 transition-transform duration-150 cursor-pointer bg-transparent border-none p-1">
                    {emoji}
                  </button>
                ))}
                <button onClick={() => { setShowEmoji(true); setShowActions(false) }}
                  className="w-8 h-8 rounded-full bg-raised hover:bg-card border border-app flex items-center justify-center text-sm cursor-pointer text-muted font-bold"
                  title="All emojis">
                  ➕
                </button>
              </div>

              {/* Vertical Action List */}
              <div className="flex flex-col py-1.5">
                {!isMine && onReply && (
                  <button onClick={() => { onReply(); setShowActions(false) }}
                    className="flex items-center gap-4.5 px-6 py-4 w-full text-left cursor-pointer hover:bg-raised bg-transparent border-none text-primary text-sm font-semibold transition-colors">
                    <span className="text-lg text-accent leading-none">↩</span>
                    <span>Reply</span>
                  </button>
                )}
                <button onClick={() => { onForward(); setShowActions(false) }}
                  className="flex items-center gap-4.5 px-6 py-4 w-full text-left cursor-pointer hover:bg-raised bg-transparent border-none text-primary text-sm font-semibold transition-colors">
                  <span className="text-lg text-accent leading-none">↗</span>
                  <span>Forward message</span>
                </button>
                {onDelete && (
                  <button onClick={() => { if (window.confirm('Delete message?')) onDelete(); setShowActions(false) }}
                    className="flex items-center gap-4.5 px-6 py-4 w-full text-left cursor-pointer hover:bg-danger-soft hover:text-danger bg-transparent border-none text-danger text-sm font-semibold transition-colors">
                    <span className="text-lg leading-none">🗑</span>
                    <span>Delete for everyone</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Full Emoji Picker Popover */}
        {showEmoji && (
          <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 px-4"
            onClick={() => setShowEmoji(false)}>
            <div className="w-full max-w-xs bg-surface border border-app rounded-3xl p-5 shadow-2xl animate-fade-in"
              style={{ background: 'var(--dropdown-bg)' }}
              onClick={e => e.stopPropagation()}>
              <p className="text-xs font-bold text-muted uppercase tracking-wide mb-3.5">All Reactions</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => { onReact(e); setShowEmoji(false); setShowActions(false) }}
                    className="text-2xl hover:scale-125 transition-transform duration-150 cursor-pointer bg-transparent border-none p-1.5 rounded-xl hover:bg-raised">
                    {e}
                  </button>
                ))}
              </div>
            </div>
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

// ── Main ChatView ──────────────────────────────────────────────────────────────
export default function ChatView() {
  const { chats, messages, activeChatId, loading, setActiveChat, markChatRead, sendMessage, addReaction, pinChat, deleteMessage, deleteChat } = useChatStore()
  const { user, userProfile }  = useAuthStore()
  const { _userId }            = useTeacherStore()
  const { instructors }        = useDirectoryStore()

  useEffect(() => {
    useDirectoryStore.getState().init()
    return () => useDirectoryStore.getState().cleanup()
  }, [])

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
        const snap = await uploadBytes(stRef(storage, `chat_attachments/${uid()}_${f.name}`), f)
        const url  = await getDownloadURL(snap.ref)
        added.push({ id: uid(), name: f.name, url, type: f.type })
      }
      setAttachments(prev => [...prev, ...added])
    } catch (e) { console.error(e) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const handleSend = async () => {
    const textToSend = msgText.trim()
    const attachmentsToSend = attachments
    const replyToToSend = replyTo
    if ((!textToSend && !attachmentsToSend.length) || !activeChatId || sending) return

    // Clear input immediately to make it ready for the next message (optimistic UX)
    setMsgText('')
    setAttachments([])
    setReplyTo(null)
    
    // Focus the input box immediately
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)

    setSending(true)
    try {
      await sendMessage(activeChatId, {
        text:        textToSend,
        attachments: attachmentsToSend,
        replyTo:     replyToToSend,
        authorId:    user?.uid,
        authorName:  userProfile?.firstName || 'Teacher',
      })
    } catch (err) {
      console.error("Failed to send message:", err)
      // Restore input state if sending fails
      setMsgText(textToSend)
      setAttachments(attachmentsToSend)
      setReplyTo(replyToToSend)
    } finally {
      setSending(false)
    }
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

  const openChat = (id) => {
    setActiveChat(id)
    setShowList(false)
  }

  // ── Chat list panel ────────────────────────────────────────────────────────
  if (showList) return (
    <div className="h-full flex flex-col bg-app">
      <div className="px-5 py-4 bg-surface border-b border-app flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary">Chat</h2>
        <button onClick={() => setShowDMPicker(true)}
          className="w-10 h-10 rounded-xl bg-accent text-white flex items-center justify-center text-xl font-bold cursor-pointer border-none">
          ✏️
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          </div>
        ) : chats.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center px-6">
            <p className="text-3xl mb-2">💬</p>
            <p className="text-base font-semibold text-muted">No conversations yet</p>
            <p className="text-sm text-dim mt-1 mb-4">Tap ✏️ to message a colleague</p>
          </div>
        ) : chats.map(chat => {
          const lastReadTs = user ? (chat.lastRead?.[user.uid]?.seconds || 0) : 0
          const msgs       = messages[chat.id] || []
          const unread     = msgs.filter(m => m.authorId !== user?.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
          return (
            <div key={chat.id} className="relative group">
              <button onClick={() => openChat(chat.id)}
                className={`flex items-center gap-4 w-full px-5 py-4 text-left cursor-pointer border-none border-b border-app/20 transition-colors
                  ${unread > 0 ? 'bg-accent/5 hover:bg-accent/10' : 'bg-transparent hover:bg-raised'}`}>
                <div className="relative flex-shrink-0">
                  {(() => {
                    const profile = getChatProfile(chat, user, instructors)
                    return <Avatar firstName={profile.firstName} lastName={profile.lastName} color={profile.color} photo={profile.photo} icon={profile.icon} size={48} />
                  })()}
                  {unread > 0 && (
                    <span className="absolute -top-1 -left-1 w-3 h-3 bg-accent border border-surface rounded-full flex-shrink-0 animate-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {chat.pinnedAt && <span className="text-sm">📌</span>}
                    <p className="text-base font-bold text-primary truncate">{getChatProfile(chat, user, instructors).name}</p>
                  </div>
                  <p className={`text-sm truncate mt-0.5 ${unread > 0 ? 'font-bold text-primary' : 'text-dim'}`}>{chat.lastMessage || 'No messages yet'}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`text-xs ${unread > 0 ? 'text-accent font-semibold' : 'text-dim'}`}>{fmtChatTime(chat.lastAt)}</span>
                  {unread > 0 && (
                    <span className="min-w-[22px] h-[22px] rounded-full bg-accent text-white text-[11px] font-bold flex items-center justify-center px-1.5">{unread > 9 ? '9+' : unread}</span>
                  )}
                </div>
              </button>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover:flex gap-1 bg-card border border-app rounded-lg p-1 z-10">
                <button onClick={e => { e.stopPropagation(); pinChat(chat.id, !chat.pinnedAt) }}
                  title={chat.pinnedAt ? 'Unpin' : 'Pin'}
                  className="w-7 h-7 rounded-md hover:bg-raised flex items-center justify-center text-sm cursor-pointer bg-transparent border-none text-muted">
                  {chat.pinnedAt ? '📌' : '📍'}
                </button>

              </div>
            </div>
          )
        })}
      </div>

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
            const q = query(collection(db, 'chats'), where('isGroup', '==', false), where('members', 'array-contains', myId))
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
      <div className="flex items-center gap-4 px-5 py-4 bg-surface border-b border-app flex-shrink-0">
        <button onClick={() => setShowList(true)}
          className="text-accent text-2xl cursor-pointer bg-transparent border-none leading-none mr-1.5">‹</button>
        {(() => {
          const profile = getChatProfile(activeChat, user, instructors)
          return <Avatar firstName={profile.firstName} lastName={profile.lastName} color={profile.color} photo={profile.photo} icon={profile.icon} size={40} />
        })()}
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-primary truncate leading-tight">{getChatProfile(activeChat, user, instructors).name}</p>
          <p className="text-sm text-dim mt-0.5">{activeChat?.isGroup ? `${activeChat?.members?.length || 0} members` : 'Direct message'}</p>
        </div>
        <button onClick={() => pinChat(activeChat.id, !activeChat.pinnedAt)}
          className={`w-9 h-9 rounded-full border border-app flex items-center justify-center text-sm cursor-pointer transition-colors flex-shrink-0
            ${activeChat.pinnedAt ? 'bg-accent/15 border-accent text-accent' : 'bg-card hover:bg-raised text-muted'}`}
          title={activeChat.pinnedAt ? 'Unpin chat' : 'Pin chat'}>
          📌
        </button>
      </div>

      {/* Messages */}
      <div ref={msgListRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
        {activeMsgs.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <p className="text-3xl mb-2">💬</p>
            <p className="text-base font-semibold text-muted">No messages yet — say hello!</p>
          </div>
        )}
        {activeMsgs.map(msg => {
          const isMine = msg.authorId === user?.uid
          const sentAt = tsMillis(msg.createdAt)
          const others = (activeChat?.members || []).filter(id => id !== user?.uid)
          const isRead = sentAt != null && others.length > 0 &&
            others.every(id => (tsMillis(activeChat?.lastRead?.[id]) || 0) >= sentAt)
          return (
            <Bubble key={msg.id} msg={msg} isMine={isMine} read={isRead}
              onReact={(emoji) => addReaction(activeChatId, msg.id, emoji, user?.uid)}
              onReply={() => { setReplyTo(msg); inputRef.current?.focus() }}
              onForward={() => setForwardMsg(msg)}
              onDelete={isMine ? () => deleteMessage(activeChatId, msg.id) : null} />
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
              {isImgAttachment(a) ? '🖼️' : '📄'}
              <span className="text-primary max-w-[100px] truncate">{a.name}</span>
              <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                className="text-dim cursor-pointer bg-transparent border-none">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div className="px-4.5 py-3.5 bg-surface border-t border-app flex items-end gap-3 flex-shrink-0 safe-bottom">
        {/* Attach */}
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="w-11 h-11 rounded-xl border border-app bg-raised flex items-center justify-center text-lg cursor-pointer flex-shrink-0 disabled:opacity-50">
          {uploading ? '⏳' : '📎'}
        </button>
        <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />

        {/* Emoji */}
        <div className="relative flex-shrink-0">
          <button onClick={() => setInputEmoji(v => !v)}
            className="w-11 h-11 rounded-xl border border-app bg-raised flex items-center justify-center text-lg cursor-pointer">
            😊
          </button>
          {inputEmoji && (
            <>
              <div onClick={() => setInputEmoji(false)} className="fixed inset-0 z-10" />
              <div className="absolute bottom-full mb-2 left-0 z-20 bg-card border border-app rounded-2xl p-2.5 flex flex-wrap gap-2 shadow-xl w-52">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => { setMsgText(t => t + e); setInputEmoji(false); inputRef.current?.focus() }}
                    className="text-xl cursor-pointer bg-transparent border-none p-1 rounded hover:bg-raised transition-colors">{e}</button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Text */}
        <div className="flex-1 bg-raised border border-app rounded-2xl px-4.5 py-2.5 flex items-end">
          <textarea ref={inputRef} value={msgText} onChange={e => setMsgText(e.target.value)}
            placeholder="Message…" rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            style={{ resize: 'none', maxHeight: 120, overflow: 'auto' }}
            className="flex-1 bg-transparent text-base text-primary placeholder:text-dim outline-none resize-none" />
        </div>

        {/* Send */}
        <button onClick={handleSend}
          disabled={(!msgText.trim() && !attachments.length) || sending}
          className="w-11 h-11 rounded-xl bg-accent text-white flex items-center justify-center text-base cursor-pointer border-none hover:opacity-90 disabled:opacity-40 flex-shrink-0">
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
    <div className="absolute inset-0 z-50 flex flex-col justify-end bg-black/50" onClick={onClose}>
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
              <Avatar firstName={u.firstName} lastName={u.lastName} color={u.color} photo={u.photo} size={40} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-primary">{u.firstName} {u.lastName}</p>
                  {['owner','admin'].includes(u.role) && (
                    <span className="text-xs px-1.5 py-0.5 rounded-md bg-accent-soft text-accent font-semibold">
                      {u.role === 'owner' ? '👑' : '🛡️'} {u.role}
                    </span>
                  )}
                </div>
                <p className="text-xs text-dim capitalize">{u.role === 'teacher' ? 'Teacher' : ''}</p>
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

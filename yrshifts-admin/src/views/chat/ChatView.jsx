import { useState, useEffect, useRef, useMemo } from 'react'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../utils/firebase'
import useChatStore      from '../../stores/useChatStore'
import useAuthStore      from '../../stores/useAuthStore'
import useDirectoryStore from '../../stores/useDirectoryStore'
import { uid }           from '../../utils/helpers'
import Avatar            from '../../components/Avatar'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'
import Button            from '../../components/Button'

const EMOJIS = ['👍','❤️','😂','🎉','🔥','👀','🙌','✅','😮','😢']

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtTime(ts) {
  if (!ts) return ''
  const d = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function fmtChatTime(ts) {
  if (!ts) return ''
  const d   = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000)     return 'Just now'
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000)  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── New chat modal ─────────────────────────────────────────────────────────────
function NewChatModal({ onClose, onCreate }) {
  const { instructors } = useDirectoryStore()
  const [type, setType]   = useState('group')
  const [name, setName]   = useState('')
  const [sel,  setSel]    = useState(new Set())
  const [busy, setBusy]   = useState(false)

  const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

  const toggleMember = (id) => {
    const n = new Set(sel)
    n.has(id) ? n.delete(id) : n.add(id)
    setSel(n)
  }

  const handleCreate = async () => {
    if (type === 'group' && !name.trim()) return
    if (sel.size === 0) return
    setBusy(true)
    try {
      const chatName = type === 'group'
        ? name.trim()
        : instructors.find(i => sel.has(i.id))?.firstName + ' ' + instructors.find(i => sel.has(i.id))?.lastName
      await onCreate({ name: chatName, members: [...sel], isGroup: type === 'group' })
      onClose()
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} width="max-w-md">
      <ModalHeader title="New conversation" onClose={onClose} />

      {/* Type toggle */}
      <div className="flex rounded-xl border border-app overflow-hidden mb-5">
        {[['group','👥 Group'],['dm','💬 Direct message']].map(([t, label]) => (
          <button key={t} onClick={() => { setType(t); setSel(new Set()) }}
            className={`flex-1 py-2 text-sm font-semibold cursor-pointer border-none transition-colors
              ${type === t ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}>
            {label}
          </button>
        ))}
      </div>

      {type === 'group' && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Group name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Spring 2025" autoFocus className={INPUT} />
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">
          {type === 'dm' ? 'Choose a person' : 'Add members'}
        </label>
        <div className="max-h-52 overflow-y-auto flex flex-col gap-1">
          {instructors.map(i => {
            const isSel = sel.has(i.id)
            const disabled = type === 'dm' && sel.size === 1 && !isSel
            return (
              <label key={i.id}
                className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-colors
                  ${isSel ? 'bg-accent-soft border border-accent/30' : 'border border-transparent hover:bg-raised'}
                  ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
                <input type={type === 'dm' ? 'radio' : 'checkbox'} checked={isSel}
                  onChange={() => { if (type === 'dm') setSel(new Set([i.id])); else toggleMember(i.id) }}
                  className="accent-accent" />
                <Avatar firstName={i.firstName} lastName={i.lastName} color={i.color} photo={i.photo} size={28} />
                <span className="text-sm font-medium text-primary">{i.firstName} {i.lastName}</span>
              </label>
            )
          })}
        </div>
      </div>

      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleCreate}
          disabled={busy || sel.size === 0 || (type === 'group' && !name.trim())}>
          {busy ? 'Creating…' : type === 'group' ? 'Create group' : 'Start chat'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ── Forward modal ──────────────────────────────────────────────────────────────
function ForwardModal({ text, chats, onClose, onForward }) {
  const [q, setQ] = useState('')
  const filtered  = chats.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal onClose={onClose} width="max-w-sm">
      <ModalHeader title="Forward to…" onClose={onClose} />
      <div className="bg-raised border border-app/50 rounded-lg px-3 py-2 mb-4 text-sm text-muted italic truncate">
        "{text?.slice(0, 80)}{text?.length > 80 ? '…' : ''}"
      </div>
      <input value={q} onChange={e => setQ(e.target.value)}
        placeholder="Search chats…" autoFocus
        className="w-full bg-raised border border-app rounded-lg px-3 py-2 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors mb-3" />
      <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5">
        {filtered.map(c => (
          <button key={c.id} onClick={() => onForward(c)}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-raised text-left cursor-pointer bg-transparent border-none transition-colors">
            <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center text-sm flex-shrink-0">
              {c.isGroup ? '👥' : '💬'}
            </div>
            <span className="text-sm font-medium text-primary truncate">{c.name}</span>
          </button>
        ))}
        {filtered.length === 0 && <p className="text-sm text-dim text-center py-6">No chats found</p>}
      </div>
    </Modal>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, isMine, onReact, onReply, onForward, authorColor }) {
  const [showActions, setShowActions] = useState(false)
  const [showEmoji,   setShowEmoji]   = useState(false)
  const hasReactions = msg.reactions && Object.keys(msg.reactions).length > 0

  return (
    <div className={`flex flex-col gap-0.5 ${isMine ? 'items-end' : 'items-start'} group`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmoji(false) }}>

      {/* Author name (others only) */}
      {!isMine && (
        <span className="text-xs font-semibold px-1" style={{ color: authorColor || 'var(--accent)' }}>
          {msg.authorName}
        </span>
      )}

      {/* Reply preview */}
      {msg.replyTo && (
        <div className={`flex items-start gap-2 max-w-[72%] px-3 py-1.5 rounded-lg border-l-2 border-accent mb-0.5
          ${isMine ? 'bg-white/10 self-end' : 'bg-raised'}`}>
          <span className="text-xs font-semibold text-accent flex-shrink-0">{msg.replyTo.authorName}</span>
          <span className="text-xs text-muted truncate">{msg.replyTo.text?.slice(0, 60)}</span>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {/* Action bar (others left, mine right) */}
        {!isMine && showActions && (
          <ActionBar isMine={isMine} showEmoji={showEmoji} setShowEmoji={setShowEmoji}
            onReact={onReact} onReply={onReply} onForward={onForward} msg={msg} />
        )}

        {/* Bubble */}
        <div className={`relative max-w-xs lg:max-w-md px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed
          ${isMine
            ? 'bg-accent text-white rounded-br-md'
            : 'bg-card border border-app text-primary rounded-bl-md'}`}>

          {/* Attachments */}
          {msg.attachments?.map(a => (
            <div key={a.id} className="mb-2 last:mb-0">
              {a.type?.startsWith('image/') ? (
                <img src={a.url} alt={a.name} className="rounded-lg max-w-full max-h-48 object-cover block" />
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

          {/* Timestamp */}
          <p className={`text-[10px] mt-1 ${isMine ? 'text-white/60' : 'text-dim'} text-right`}>
            {fmtTime(msg.createdAt)}
          </p>
        </div>

        {/* Action bar — mine (right side) */}
        {isMine && showActions && (
          <ActionBar isMine={isMine} showEmoji={showEmoji} setShowEmoji={setShowEmoji}
            onReact={onReact} onReply={onReply} onForward={onForward} msg={msg} />
        )}
      </div>

      {/* Reactions */}
      {hasReactions && (
        <div className={`flex flex-wrap gap-1 px-1 ${isMine ? 'justify-end' : ''}`}>
          {Object.entries(msg.reactions).map(([emoji, users]) => users.length > 0 && (
            <button key={emoji} onClick={() => onReact(emoji)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold cursor-pointer transition-all
                bg-raised border-app hover:border-accent`}>
              <span>{emoji}</span>
              <span className="text-muted">{users.length}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionBar({ isMine, showEmoji, setShowEmoji, onReact, onReply, onForward, msg }) {
  return (
    <div className={`relative flex items-center gap-0.5 mb-1 ${isMine ? 'flex-row-reverse' : ''}`}>
      {/* Emoji toggle */}
      <div className="relative">
        <button onClick={() => setShowEmoji(v => !v)}
          className="w-7 h-7 rounded-lg bg-card border border-app text-sm flex items-center justify-center cursor-pointer hover:bg-raised transition-colors">
          😊
        </button>
        {showEmoji && (
          <>
            <div onClick={() => setShowEmoji(false)} className="fixed inset-0 z-10" />
            <div className={`absolute z-20 bottom-full mb-1 bg-card border border-app rounded-xl p-2 flex flex-wrap gap-1.5 shadow-xl w-52
              ${isMine ? 'right-0' : 'left-0'}`}>
              {EMOJIS.map(e => (
                <button key={e} onClick={() => { onReact(e); setShowEmoji(false) }}
                  className="text-lg hover:scale-125 transition-transform cursor-pointer bg-transparent border-none p-0.5 rounded">{e}</button>
              ))}
            </div>
          </>
        )}
      </div>
      {!isMine && (
        <button onClick={onReply}
          className="w-7 h-7 rounded-lg bg-card border border-app text-sm flex items-center justify-center cursor-pointer hover:bg-raised transition-colors">
          ↩
        </button>
      )}
      <button onClick={onForward}
        className="w-7 h-7 rounded-lg bg-card border border-app text-sm flex items-center justify-center cursor-pointer hover:bg-raised transition-colors">
        ↗
      </button>
    </div>
  )
}

// ── Main Chat view ─────────────────────────────────────────────────────────────
export default function ChatView() {
  const { chats, messages, activeChatId, loading, setActiveChat, markChatRead, sendMessage, addReaction, createChat } = useChatStore()
  const { user, userProfile } = useAuthStore()
  const { instructors }       = useDirectoryStore()

  const [msgText,    setMsgText]    = useState('')
  const [replyTo,    setReplyTo]    = useState(null)
  const [attachments,setAttachments]= useState([])
  const [uploading,  setUploading]  = useState(false)
  const [showNew,    setShowNew]    = useState(false)
  const [forwardMsg, setForwardMsg] = useState(null)
  const [fwdToast,   setFwdToast]   = useState('')
  const [search,     setSearch]     = useState('')
  const [inputEmoji, setInputEmoji] = useState(false)
  const [sending,    setSending]    = useState(false)

  const fileRef     = useRef(null)
  const msgListRef  = useRef(null)
  const inputRef    = useRef(null)

  const activeChat = chats.find(c => c.id === activeChatId)
  const activeMsgs = messages[activeChatId] || []

  const filteredChats = useMemo(() => {
    if (!search) return chats
    return chats.filter(c => (c.name || '').toLowerCase().includes(search.toLowerCase()))
  }, [chats, search])

  // Auto-scroll on new messages
  useEffect(() => {
    if (msgListRef.current) {
      msgListRef.current.scrollTop = msgListRef.current.scrollHeight
    }
  }, [activeMsgs.length, activeChatId])

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploading(true)
    try {
      const added = []
      for (const f of files) {
        const snap = await uploadBytes(ref(storage, `chat_attachments/${uid()}_${f.name}`), f)
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
        authorId:    user?.uid || 'admin',
        authorName:  userProfile?.firstName || 'Admin',
      })
      setMsgText('')
      setAttachments([])
      setReplyTo(null)
    } catch (e) { console.error(e) }
    finally { setSending(false) }
  }

  const handleReact = async (msgId, emoji) => {
    if (!activeChatId) return
    await addReaction(activeChatId, msgId, emoji, user?.uid || 'admin')
  }

  const handleForward = async (targetChat) => {
    if (!forwardMsg || !targetChat) return
    await sendMessage(targetChat.id, {
      text:       `↗ Forwarded: ${forwardMsg.text}`,
      attachments: forwardMsg.attachments || [],
      replyTo:    null,
      authorId:   user?.uid || 'admin',
      authorName: userProfile?.firstName || 'Admin',
    })
    setForwardMsg(null)
    setFwdToast(`Forwarded to ${targetChat.name}`)
    setTimeout(() => setFwdToast(''), 2000)
  }

  const handleCreateChat = async (opts) => {
    const id = await createChat(opts)
    setActiveChat(id)
  }

  const getAuthorColor = (authorId) => {
    const inst = instructors.find(i => String(i.id) === String(authorId))
    return inst?.color || 'var(--accent)'
  }

  const INPUT_BASE = "bg-transparent text-sm text-primary placeholder:text-dim outline-none"

  return (
    <div className="flex-1 flex overflow-hidden bg-app">

      {/* ── Sidebar ── */}
      <div className="w-72 flex-shrink-0 flex flex-col bg-surface border-r border-app">

        {/* Header */}
        <div className="px-4 pt-5 pb-3 flex items-center justify-between border-b border-app">
          <h2 className="text-lg font-bold text-primary">Chat</h2>
          <button onClick={() => setShowNew(true)}
            className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center text-xl font-bold cursor-pointer border-none hover:opacity-90 transition-opacity">
            +
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-2.5 border-b border-app">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-xs pointer-events-none">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search chats…"
              className="w-full bg-raised border border-app rounded-lg pl-7 pr-3 py-1.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors" />
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto py-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="text-center py-10 px-4">
              <p className="text-2xl mb-2">💬</p>
              <p className="text-sm font-semibold text-muted">No chats yet</p>
              <p className="text-xs text-dim mt-1">Click + to start one</p>
            </div>
          ) : filteredChats.map(chat => {
            const isActive = chat.id === activeChatId
            return (
              <button key={chat.id}
                onClick={() => setActiveChat(chat.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer border-none transition-all
                  ${isActive ? 'bg-accent-soft border-r-2 border-accent' : 'bg-transparent hover:bg-raised'}`}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                  ${chat.isGroup ? 'bg-accent-soft text-accent' : 'bg-raised text-muted'}`}>
                  {chat.isGroup ? '👥' : '💬'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold truncate ${isActive ? 'text-accent' : 'text-primary'}`}>
                    {chat.name}
                  </p>
                  <p className="text-xs text-dim truncate mt-0.5">
                    {chat.lastMessage || 'No messages yet'}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-2xs text-dim">{fmtChatTime(chat.lastAt)}</span>
                {(() => {
                  const lastReadTs = user ? (chat.lastRead?.[user.uid]?.seconds || 0) : 0
                  const msgs       = messages[chat.id] || []
                  const unread     = msgs.filter(m => m.authorId !== (user?.uid || 'admin') && (m.createdAt?.seconds || 0) > lastReadTs).length
                  return unread > 0 ? (
                    <span className="min-w-[18px] h-[18px] rounded-full bg-accent text-white text-[9px] font-bold flex items-center justify-center px-1">{unread > 9 ? '9+' : unread}</span>
                  ) : null
                })()}
              </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Message pane ── */}
      {activeChatId ? (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Chat header */}
          <div className="px-5 py-3.5 bg-surface border-b border-app flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-full bg-accent-soft flex items-center justify-center text-base">
              {activeChat?.isGroup ? '👥' : '💬'}
            </div>
            <div>
              <p className="text-sm font-bold text-primary">{activeChat?.name}</p>
              <p className="text-xs text-dim">
                {activeChat?.isGroup
                  ? `${activeChat?.members?.length || 0} members`
                  : 'Direct message'}
              </p>
            </div>
          </div>

          {/* Messages */}
          <div ref={msgListRef} className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
            {activeMsgs.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-20">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-sm font-semibold text-muted">No messages yet</p>
                <p className="text-xs text-dim mt-1">Say hello!</p>
              </div>
            )}
            {activeMsgs.map(msg => {
              const isMine = msg.authorId === (user?.uid || 'admin')
              return (
                <MessageBubble key={msg.id} msg={msg} isMine={isMine}
                  authorColor={getAuthorColor(msg.authorId)}
                  onReact={(emoji) => handleReact(msg.id, emoji)}
                  onReply={() => { setReplyTo(msg); inputRef.current?.focus() }}
                  onForward={() => setForwardMsg(msg)} />
              )
            })}
          </div>

          {/* Reply banner */}
          {replyTo && (
            <div className="mx-4 mb-1 px-3 py-2 bg-raised border-l-2 border-accent rounded-r-lg flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <p className="text-xs font-bold text-accent">{replyTo.authorName}</p>
                <p className="text-xs text-muted truncate">{replyTo.text?.slice(0, 80)}</p>
              </div>
              <button onClick={() => setReplyTo(null)}
                className="ml-2 text-dim hover:text-muted text-base cursor-pointer bg-transparent border-none flex-shrink-0">×</button>
            </div>
          )}

          {/* Attachment previews */}
          {attachments.length > 0 && (
            <div className="mx-4 mb-1 flex flex-wrap gap-2 flex-shrink-0">
              {attachments.map(a => (
                <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-raised border border-app rounded-xl text-xs">
                  {a.type?.startsWith('image/') ? '🖼️' : '📄'}
                  <span className="text-primary max-w-[120px] truncate">{a.name}</span>
                  <button onClick={() => setAttachments(prev => prev.filter(x => x.id !== a.id))}
                    className="text-dim hover:text-danger cursor-pointer bg-transparent border-none">×</button>
                </div>
              ))}
            </div>
          )}

          {/* Input bar */}
          <div className="px-4 py-3 bg-surface border-t border-app flex items-end gap-2 flex-shrink-0">
            {/* Attach */}
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-9 h-9 rounded-xl border border-app bg-raised flex items-center justify-center text-base cursor-pointer hover:bg-card transition-colors disabled:opacity-50 flex-shrink-0">
              {uploading ? '⏳' : '📎'}
            </button>
            <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden" onChange={handleFileUpload} />

            {/* Emoji */}
            <div className="relative flex-shrink-0">
              <button onClick={() => setInputEmoji(v => !v)}
                className="w-9 h-9 rounded-xl border border-app bg-raised flex items-center justify-center text-base cursor-pointer hover:bg-card transition-colors">
                😊
              </button>
              {inputEmoji && (
                <>
                  <div onClick={() => setInputEmoji(false)} className="fixed inset-0 z-10" />
                  <div className="absolute bottom-full mb-2 left-0 z-20 bg-card border border-app rounded-2xl p-3 flex flex-wrap gap-2 shadow-xl w-56">
                    {EMOJIS.map(e => (
                      <button key={e} onClick={() => { setMsgText(t => t + e); setInputEmoji(false); inputRef.current?.focus() }}
                        className="text-xl hover:scale-125 transition-transform cursor-pointer bg-transparent border-none p-0.5">{e}</button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Text input */}
            <div className="flex-1 bg-raised border border-app rounded-2xl px-4 py-2.5 flex items-end gap-2 min-h-[40px]">
              <textarea ref={inputRef} value={msgText} onChange={e => setMsgText(e.target.value)} placeholder="Message…" rows={1}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                style={{ resize: 'none', maxHeight: 120, overflow: 'auto' }}
                className={`flex-1 ${INPUT_BASE} resize-none`} />
            </div>

            {/* Send */}
            <button onClick={handleSend} disabled={(!msgText.trim() && !attachments.length) || sending}
              className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center text-sm cursor-pointer hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity flex-shrink-0 border-none">
              {sending ? '…' : '➤'}
            </button>
          </div>
        </div>
      ) : (
        /* No chat selected */
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 bg-app">
          <p className="text-5xl">💬</p>
          <div>
            <p className="text-lg font-bold text-primary mb-1">Select a conversation</p>
            <p className="text-sm text-muted">or start a new one</p>
          </div>
          <Button variant="primary" onClick={() => setShowNew(true)} icon="+">New conversation</Button>
        </div>
      )}

      {/* ── Modals ── */}
      {showNew && <NewChatModal onClose={() => setShowNew(false)} onCreate={handleCreateChat} />}

      {forwardMsg && (
        <ForwardModal
          text={forwardMsg.text}
          chats={chats.filter(c => c.id !== activeChatId)}
          onClose={() => setForwardMsg(null)}
          onForward={handleForward}
        />
      )}

      {/* Forward toast */}
      {fwdToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-2.5 bg-ok text-white text-sm font-semibold rounded-xl shadow-xl z-[9999] whitespace-nowrap">
          ✅ {fwdToast}
        </div>
      )}
    </div>
  )
}

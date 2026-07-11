import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  const filtered  = chats.filter(c => (c.name || '').toLowerCase().includes(q.toLowerCase()))
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

function Bubble({ msg, isMine, read, onImageOpen, onReact, onReply, onForward, onDelete }) {
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
          {(() => {
            const imgs = (msg.attachments || []).filter(isImgAttachment)
            const files = (msg.attachments || []).filter(a => !isImgAttachment(a))
            return (
              <>
                {imgs.length > 0 && (
                  <div className={`grid gap-1 mb-2 ${imgs.length === 1 ? 'grid-cols-1' : imgs.length === 2 ? 'grid-cols-2' : imgs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
                    {imgs.map((a, i) => (
                      <div key={a.id} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onImageOpen?.(a.url) }}
                        className={`block overflow-hidden ${imgs.length === 1 ? 'rounded-xl' : i === 0 && imgs.length === 3 ? 'rounded-tl-xl rounded-bl-xl' : i === 0 ? 'rounded-tl-xl rounded-bl-xl' : i === imgs.length - 1 ? 'rounded-tr-xl rounded-br-xl' : ''}`}>
                        <img src={a.thumbUrl || a.url} alt={a.name} loading="lazy" decoding="async" className="w-full object-cover cursor-pointer" style={{ height: imgs.length === 1 ? 160 : 100 }} />
                      </div>
                    ))}
                  </div>
                )}
                {files.map(a => (
                  <div key={a.id} className="mb-1">
                    <a href={a.url} target="_blank" rel="noreferrer"
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold no-underline
                        ${isMine ? 'bg-white/20 text-white' : 'bg-raised text-primary'}`}>
                      📄 {a.name}
                    </a>
                  </div>
                ))}
              </>
            )
          })()}
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


// ── New Chat Modal (owner/admin only) ─────────────────────────────────────────
function NewChatModal({ onClose, onCreate, adminId, initialStep = 'pick' }) {
  const { instructors } = useDirectoryStore()
  const [step, setStep]   = useState(initialStep)
  const [sel,  setSel]    = useState(null)
  const [busy, setBusy]   = useState(false)

  const [groupName, setGroupName] = useState('')
  const [selectedMembers, setSelectedMembers] = useState([])
  const [groupIcon, setGroupIcon]   = useState('👥')
  const [groupColor, setGroupColor] = useState('#4EA8D6')
  const [groupPhoto, setGroupPhoto] = useState(null)
  const [uploadingGroupPhoto, setUploadingGroupPhoto] = useState(false)
  const fileInputRef = useRef(null)

  const teacherIds = instructors.map(i => i.id)

  // Pre-fill selected members with all teachers
  useEffect(() => {
    if (instructors.length) {
      setSelectedMembers(instructors.map(i => i.id))
    }
  }, [instructors])

  const handleGroupPhotoUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploadingGroupPhoto(true)
    try {
      const { resizeFile } = await import('../../utils/resizeFile')
      const processed = await resizeFile(file)
      const snap = await uploadBytes(stRef(storage, `group_icons/${uid()}_${processed.name}`), processed)
      const url  = await getDownloadURL(snap.ref)
      setGroupPhoto(url)
    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setUploadingGroupPhoto(false)
    }
  }

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
        <Button onClick={initialStep === 'pick' ? () => setStep('pick') : onClose}>← Back</Button>
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

  if (step === 'group') return (
    <Modal onClose={onClose} width="max-w-md">
      <ModalHeader title="Create a Group Chat / Team" onClose={onClose} />
      <div className="flex flex-col gap-4 py-2 max-h-[60vh] overflow-y-auto pr-1.5">
        {/* Group Name input */}
        <div>
          <label className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Group / Team Name</label>
          <input
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            placeholder="e.g. Summer Artwork"
            className="w-full bg-raised border border-app rounded-xl px-3.5 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent"
          />
        </div>

        {/* Group Icon Customization */}
        <div className="flex items-center gap-4 p-3 bg-surface border border-app rounded-2xl">
          <Avatar firstName={groupName || 'G'} color={groupColor} photo={groupPhoto} icon={groupPhoto ? null : groupIcon} size={64} />
          <div className="flex-1 flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted uppercase tracking-wide">Group Avatar</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingGroupPhoto || busy}
                className="px-3 py-1.5 rounded-lg bg-raised border border-app text-xs font-semibold text-primary cursor-pointer hover:bg-card transition-colors disabled:opacity-50"
              >
                {uploadingGroupPhoto ? 'Uploading…' : groupPhoto ? 'Change Photo' : 'Upload Photo'}
              </button>
              {groupPhoto && (
                <button
                  type="button"
                  onClick={() => setGroupPhoto(null)}
                  className="px-3 py-1.5 rounded-lg bg-danger-soft border border-danger/30 text-xs font-semibold text-danger cursor-pointer hover:bg-danger/10 transition-colors"
                >
                  Clear
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleGroupPhotoUpload}
              />
            </div>
          </div>
        </div>

        {/* Emoji Icon Selector (only shown if no photo uploaded) */}
        {!groupPhoto && (
          <div>
            <label className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Select Icon Emoji</label>
            <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto border border-app rounded-xl bg-card p-2">
              {['👥', '💬', '🎨', '🚀', '📢', '🌸', '☀️', '🍁', '❄️', '🎉', '🔥', '📚', '🗓️', '🏆', '🍔', '✈️'].map(emoji => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => setGroupIcon(emoji)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg cursor-pointer transition-all border
                    ${groupIcon === emoji ? 'bg-accent border-accent text-white shadow-md' : 'bg-transparent border-transparent hover:bg-raised text-primary'}`}
                >
                  {emoji}
                </button>
              ))}
              <input
                value={groupIcon.length === 1 || groupIcon === '👥' ? '' : groupIcon}
                onChange={e => {
                  const val = e.target.value.trim()
                  if (val) setGroupIcon(val)
                }}
                placeholder="Custom Emoji"
                maxLength={2}
                className="w-24 bg-raised border border-app rounded-lg px-2 text-xs text-primary placeholder:text-dim outline-none text-center h-8"
              />
            </div>
          </div>
        )}

        {/* Avatar Color Selector (only shown if no photo uploaded) */}
        {!groupPhoto && (
          <div>
            <label className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Select Theme Color</label>
            <div className="flex flex-wrap gap-2 border border-app rounded-xl bg-card p-2">
              {[
                { label: 'Violet', value: '#8B5CF6' },
                { label: 'Indigo', value: '#6366F1' },
                { label: 'Sky', value: '#0EA5E9' },
                { label: 'Emerald', value: '#10B981' },
                { label: 'Amber', value: '#F59E0B' },
                { label: 'Rose', value: '#F43F5E' },
                { label: 'Slate', value: '#475569' },
                { label: 'Pink', value: '#EC4899' }
              ].map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setGroupColor(c.value)}
                  title={c.label}
                  className={`w-8 h-8 rounded-full cursor-pointer transition-all border-2 flex items-center justify-center
                    ${groupColor === c.value ? 'border-accent scale-105 shadow-md' : 'border-transparent hover:scale-105'}`}
                  style={{ background: c.value }}
                >
                  {groupColor === c.value && <span className="text-white text-xs">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Quick Presets */}
        <div>
          <label className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Quick Presets</label>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '🌸 Spring Artwork', value: 'Spring Artwork' },
              { label: '☀️ Summer Artwork', value: 'Summer Artwork' },
              { label: '🍁 Fall Artwork', value: 'Fall Artwork' },
              { label: '❄️ Winter Artwork', value: 'Winter Artwork' }
            ].map(p => (
              <button
                key={p.value}
                onClick={() => setGroupName(p.value)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer border transition-all
                  ${groupName === p.value ? 'bg-accent border-accent text-white' : 'bg-raised border-app text-muted hover:text-primary hover:border-accent/40'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Member checklist */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-muted uppercase tracking-wide">Select Team Members</label>
            <span className="text-[10px] text-dim font-semibold">{selectedMembers.length} / {instructors.length} selected</span>
          </div>
          <div className="max-h-48 overflow-y-auto border border-app rounded-xl bg-card p-1.5 flex flex-col gap-1">
            {instructors.map(i => {
              const checked = selectedMembers.includes(i.id)
              return (
                <button
                  key={i.id}
                  onClick={() => {
                    setSelectedMembers(prev =>
                      checked ? prev.filter(id => id !== i.id) : [...prev, i.id]
                    )
                  }}
                  className="flex items-center justify-between p-2 rounded-lg cursor-pointer bg-transparent border-none hover:bg-raised text-left w-full"
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar firstName={i.firstName} lastName={i.lastName} color={i.color} photo={i.photo} size={26} />
                    <span className="text-xs font-medium text-primary">{i.firstName} {i.lastName}</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={checked}
                    readOnly
                    className="w-4 h-4 rounded border-app bg-raised accent-accent"
                  />
                </button>
              )
            })}
          </div>
        </div>
      </div>
      <ModalFooter>
        <Button onClick={initialStep === 'pick' ? () => setStep('pick') : onClose}>← Back</Button>
        <Button variant="primary" disabled={busy || uploadingGroupPhoto}
          onClick={() => {
            createInstant({
              name: groupName.trim() || 'Group Chat',
              members: [...selectedMembers, adminId],
              isGroup: true,
              createdBy: adminId,
              icon: groupPhoto ? null : groupIcon,
              color: groupPhoto ? null : groupColor,
              photo: groupPhoto
            })
          }}>
          {busy ? 'Creating…' : 'Create Group'}
        </Button>
      </ModalFooter>
    </Modal>
  )

  return (
    <Modal onClose={onClose} width="max-w-sm">
      <ModalHeader title="New conversation" onClose={onClose} />
      <div className="flex flex-col gap-3 py-2">
        <button onClick={() => setStep('group')}
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
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const qChatId = searchParams.get('chatId')

  const { chats, messages, activeChatId, loading, setActiveChat, markChatRead, sendMessage, addReaction, pinChat, deleteMessage, deleteChat } = useChatStore()
  const { user, userProfile }  = useAuthStore()

  useEffect(() => {
    if (qChatId) {
      setActiveChat(qChatId)
      // Clean query parameter from the URL bar to avoid re-triggering
      const updated = new URLSearchParams(searchParams)
      updated.delete('chatId')
      setSearchParams(updated, { replace: true })
    }
  }, [qChatId])
  const { instructors }        = useDirectoryStore()

  const [msgText,     setMsgText]     = useState('')
  const [replyTo,     setReplyTo]     = useState(null)
  const [attachments, setAttachments] = useState([])
  const [lightbox,    setLightbox]    = useState(null)
  const [uploading,   setUploading]   = useState(false)
  const [sending,     setSending]     = useState(false)
  const [forwardMsg,  setForwardMsg]  = useState(null)
  const [fwdToast,    setFwdToast]    = useState('')
  const [inputEmoji,  setInputEmoji]  = useState(false)
  const [showDMPicker,setShowDMPicker]= useState(false)
  const [dmStarting,  setDmStarting]  = useState(false)
  const [showNew,     setShowNew]     = useState(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [listTab,     setListTab]     = useState('all') // 'all', 'unread', 'teams'
  const [showAddMenu, setShowAddMenu] = useState(false)

  const filteredChats = useMemo(() => {
    return chats.filter(chat => {
      // Hide DMs that don't involve the current admin user
      if (!chat.isGroup) {
        const members = chat.members || []
        if (!members.includes(user?.uid)) return false
      }

      // Tab filter
      if (listTab === 'teams' && !chat.isGroup) return false
      if (listTab === 'unread') {
        const lastReadTs = user ? (chat.lastRead?.[user.uid]?.seconds || 0) : 0
        const msgs       = messages[chat.id] || []
        const unread     = msgs.filter(m => m.authorId !== user?.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
        if (unread === 0) return false
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        return (chat.name || '').toLowerCase().includes(q) || (chat.lastMessage || '').toLowerCase().includes(q)
      }

      return true
    })
  }, [chats, listTab, searchQuery, user, messages])

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
        try {
          processed = await resizeFile(f)
        }
        catch (sizeErr) { alert(sizeErr.message); continue }
        const snap = await uploadBytes(stRef(storage, `chat_attachments/${uid()}_${processed.name}`), processed)
        const url  = await getDownloadURL(snap.ref)
        // Generate a small thumbnail alongside the full image so threads load fast
        let thumbUrl = null
        if (processed.type.startsWith('image/')) {
          const { makeThumbnail } = await import('../../utils/resizeFile')
          const t = await makeThumbnail(processed)
          if (t) {
            const tSnap = await uploadBytes(stRef(storage, `chat_attachments/thumb_${uid()}_${processed.name}`), t)
            thumbUrl = await getDownloadURL(tSnap.ref)
          }
        }
        added.push({ id: uid(), name: f.name, url, thumbUrl: thumbUrl || url, type: f.type })
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

  const handleCreateChat = async (opts) => {
    const { addDoc, collection, serverTimestamp } = await import('firebase/firestore')
    const { db } = await import('../../utils/firebase')
    const chatRef = await addDoc(collection(db, 'chats'), {
      name: opts.name || '',
      members: opts.members || [],
      isGroup: opts.isGroup || false,
      createdBy: opts.createdBy || null,
      createdAt: serverTimestamp(),
      lastMessage: 'Group created',
      lastAt: serverTimestamp(),
      pinnedAt: null,
      icon: opts.icon || null,
      color: opts.color || null,
      photo: opts.photo || null,
    })

    // Write initial system welcome message to trigger FCM push notifications to all teachers
    await addDoc(collection(db, 'chats', chatRef.id, 'messages'), {
      text: `Welcome to the new group chat: "${opts.name}"!`,
      attachments: [],
      replyTo: null,
      authorId: opts.createdBy || 'system',
      authorName: 'System',
      reactions: {},
      createdAt: serverTimestamp(),
    })
  }

  // ── Main Render Flow (Symmetric Two-Column Split Layout) ───────────────────
  return (
    <div className="flex-1 flex overflow-hidden bg-app">
      
      {/* ── 1. Left Sidebar Chat List (360px scaled up) ── */}
      <div className={`flex-shrink-0 flex flex-col bg-surface border-r border-app/50 relative transition-all ${activeChatId ? 'hidden md:flex md:w-[360px]' : 'w-full md:w-[360px]'}`}>
        
        {/* Sidebar Header */}
        <div className="px-5 py-4 border-b border-app flex items-center justify-between flex-shrink-0">
          {/* Add new button with Popover */}
          <div className="relative">
            <button onClick={() => setShowAddMenu(v => !v)}
              className="bg-accent hover:opacity-95 text-white px-5 py-2.5 rounded-full font-bold flex items-center gap-2 cursor-pointer border-none text-base transition-all shadow-md">
              Add new <span className="text-xs">▼</span>
            </button>
            {showAddMenu && (
              <>
                <div onClick={() => setShowAddMenu(false)} className="fixed inset-0 z-40" />
                <div className="absolute z-50 left-0 top-12 bg-card border border-app shadow-2xl rounded-2xl p-2.5 w-52 flex flex-col gap-1 animate-fade-in">
                  <button onClick={() => { setShowAddMenu(false); setShowDMPicker(true) }}
                    className="flex items-center gap-3 w-full px-3.5 py-2.5 text-base text-left text-primary hover:bg-raised rounded-xl bg-transparent border-none cursor-pointer">
                    <span className="text-lg">👤</span> New Message
                  </button>
                  <button onClick={() => { setShowAddMenu(false); setShowNew('group') }}
                    className="flex items-center gap-3 w-full px-3.5 py-2.5 text-base text-left text-primary hover:bg-raised rounded-xl bg-transparent border-none cursor-pointer">
                    <span className="text-lg">👥</span> New group message
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Sibling header action buttons */}
          <div className="flex gap-2 flex-shrink-0">
            <button className="w-11 h-11 rounded-full bg-card hover:bg-raised border border-app flex items-center justify-center text-lg cursor-pointer text-muted"
              onClick={() => navigate('/directory')}
              title="View directory">
              📇
            </button>
          </div>
        </div>

        {/* Inline Search Bar */}
        <div className="px-5 py-3 flex-shrink-0">
          <div className="bg-raised border border-app rounded-2xl px-4 py-2.5 flex items-center gap-2.5">
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="flex-1 bg-transparent text-base text-primary placeholder:text-dim outline-none"
            />
            <span className="text-dim text-base">🔍</span>
          </div>
        </div>

        {/* Capsule Tab Pills */}
        <div className="px-5 pb-3 flex gap-2 flex-shrink-0">
          <button onClick={() => setListTab('all')}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-colors cursor-pointer border-none
              ${listTab === 'all' ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-primary'}`}>
            All
          </button>
          <button onClick={() => setListTab('unread')}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-colors cursor-pointer border-none
              ${listTab === 'unread' ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-primary'}`}>
            Unread
          </button>
          <button onClick={() => setListTab('teams')}
            className={`px-5 py-2 rounded-full text-sm font-bold transition-colors cursor-pointer border-none
              ${listTab === 'teams' ? 'bg-accent text-white' : 'bg-raised text-muted hover:text-primary'}`}>
            Teams
          </button>
        </div>

        {/* Scrollable list of chat items */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            </div>
          ) : filteredChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <p className="text-3xl mb-2">💬</p>
              <p className="text-sm font-semibold text-muted">No conversations found</p>
              <p className="text-xs text-dim mt-1">Try adjusting your filters</p>
            </div>
          ) : filteredChats.map(chat => {
            const isActive = chat.id === activeChatId
            const lastReadTs = user ? (chat.lastRead?.[user.uid]?.seconds || 0) : 0
            const msgs       = messages[chat.id] || []
            const unread     = msgs.filter(m => m.authorId !== user?.uid && (m.createdAt?.seconds || 0) > lastReadTs).length
            return (
              <div key={chat.id} className="relative group">
                <button onClick={() => setActiveChat(chat.id)}
                  className={`flex items-center gap-4 w-full px-5 py-4 text-left cursor-pointer border-none border-b border-app/20 transition-colors
                    ${isActive ? 'bg-accent-soft' : unread > 0 ? 'bg-accent/5 hover:bg-accent/10' : 'bg-transparent hover:bg-raised'}`}>
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
            )
          })}
        </div>
      </div>

      {/* ── 2. Right Main Column Chat Window (flex-1) ── */}
      <div className={`flex-col min-w-0 bg-app relative transition-all ${activeChatId ? 'flex flex-1 w-full' : 'hidden md:flex md:flex-1'}`}>
        {!activeChatId ? (
          /* Welcome screen when no chat selected */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <p className="text-5xl mb-4">💬</p>
            <h3 className="text-lg font-bold text-primary mb-1">Select a Conversation</h3>
            <p className="text-sm text-dim">Choose a chat from the sidebar to start messaging your team.</p>
          </div>
        ) : (
          /* Active chat workspace feed */
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-7 py-5 bg-surface border-b border-app flex-shrink-0">
              <div className="flex items-center gap-4 min-w-0">
                <button 
                  onClick={() => setActiveChat(null)}
                  className="md:hidden w-11 h-11 rounded-full bg-card hover:bg-raised border border-app flex items-center justify-center text-lg cursor-pointer text-muted mr-1.5 flex-shrink-0"
                  title="Back to list"
                >
                  ←
                </button>
                {(() => {
                  const profile = getChatProfile(activeChat, user, instructors)
                  return <Avatar firstName={profile.firstName} lastName={profile.lastName} color={profile.color} photo={profile.photo} icon={profile.icon} size={50} />
                })()}
                <div className="min-w-0">
                  <p className="text-lg font-bold text-primary truncate leading-tight">{getChatProfile(activeChat, user, instructors).name}</p>
                  <p className="text-sm text-dim mt-0.5">
                    {activeChat?.isGroup ? (
                      `${activeChat?.members?.length || 0} Members`
                    ) : (
                      (() => {
                        const otherId = activeChat?.members?.find(id => id !== user?.uid)
                        const otherUser = instructors?.find(i => i.id === otherId)
                        if (!otherUser) return ''
                        if (!otherUser.lastLoginAt) return 'Not logged in yet'
                        
                        const date = otherUser.lastLoginAt?.seconds
                          ? new Date(otherUser.lastLoginAt.seconds * 1000)
                          : new Date(otherUser.lastLoginAt)
                        
                        const dateStr = date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined
                        })
                        const timeStr = date.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit'
                        })
                        return `Last login: ${dateStr} at ${timeStr}`
                      })()
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3.5 flex-shrink-0">
                <button onClick={() => pinChat(activeChat.id, !activeChat.pinnedAt)}
                  className={`w-11 h-11 rounded-full border border-app flex items-center justify-center text-base cursor-pointer transition-colors
                    ${activeChat.pinnedAt ? 'bg-accent/15 border-accent text-accent' : 'bg-card hover:bg-raised text-muted'}`}
                  title={activeChat.pinnedAt ? 'Unpin chat' : 'Pin chat to top'}>
                  📌
                </button>
                <button className="w-11 h-11 rounded-full bg-card hover:bg-raised border border-app flex items-center justify-center text-base cursor-pointer text-muted" title="Search messages">
                  🔍
                </button>
                {(activeChat?.createdBy === user?.uid || !activeChat?.createdBy || ['owner','admin'].includes(userProfile?.role)) && (
                  <button onClick={() => { if (window.confirm('Delete this chat?')) { deleteChat(activeChat?.id); setActiveChat(null) } }}
                    className="w-11 h-11 rounded-full bg-card hover:bg-danger-soft border border-app flex items-center justify-center text-base text-danger cursor-pointer"
                    title="Delete chat">
                    🗑
                  </button>
                )}
              </div>
            </div>

            {/* Message History Feed */}
            <div ref={msgListRef} className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
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
                  <Bubble key={msg.id} msg={msg} isMine={isMine} read={isRead} onImageOpen={setLightbox}
                    onReact={(emoji) => addReaction(activeChatId, msg.id, emoji, user?.uid)}
                    onReply={() => { setReplyTo(msg); inputRef.current?.focus() }}
                    onForward={() => setForwardMsg(msg)}
                    onDelete={msg.authorId === user?.uid ? () => deleteMessage(activeChatId, msg.id) : null} />
                )
              })}
            </div>

            {/* Reply bar banner */}
            {replyTo && (
              <div className="mx-6 mb-1 px-3 py-2 bg-raised border-l-2 border-accent rounded-r-xl flex items-center justify-between flex-shrink-0">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-accent">{replyTo.authorName}</p>
                  <p className="text-xs text-muted truncate">{replyTo.text?.slice(0, 60)}</p>
                </div>
                <button onClick={() => setReplyTo(null)} className="ml-2 text-dim text-base cursor-pointer bg-transparent border-none flex-shrink-0">×</button>
              </div>
            )}

            {/* Uploaded attachments previews */}
            {attachments.length > 0 && (
              <div className="mx-6 mb-1 flex flex-wrap gap-2 flex-shrink-0">
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

            {/* Floating input card block */}
            <div className="px-7 py-5 bg-transparent flex flex-col flex-shrink-0 relative">
              <div className="bg-card border border-app rounded-2xl shadow-lg p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <textarea ref={inputRef} value={msgText} onChange={e => setMsgText(e.target.value)}
                    placeholder="Write something..." rows={1}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                    style={{ resize: 'none', maxHeight: 150, overflow: 'auto' }}
                    className="flex-1 bg-transparent text-base text-primary placeholder:text-dim outline-none resize-none border-none py-1.5" />
                  
                  <button onClick={handleSend}
                    disabled={(!msgText.trim() && !attachments.length) || sending}
                    className="w-11 h-11 rounded-xl bg-accent text-white flex items-center justify-center text-base cursor-pointer border-none hover:opacity-90 disabled:opacity-40 flex-shrink-0 transition-opacity">
                    {sending ? '…' : '➤'}
                  </button>
                </div>

                <div className="flex items-center justify-between border-t border-app/30 pt-2.5 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <button onClick={() => fileRef.current?.click()} disabled={uploading}
                      className="w-10 h-10 rounded-lg hover:bg-raised flex items-center justify-center text-lg cursor-pointer border-none bg-transparent text-muted transition-colors disabled:opacity-50"
                      title="Attach file">
                      📎
                    </button>
                    <input ref={fileRef} type="file" multiple accept="image/*,.pdf" className="hidden" onChange={handleFileUpload} />
                    
                    <div className="relative">
                      <button onClick={() => setInputEmoji(v => !v)}
                        className="w-10 h-10 rounded-lg hover:bg-raised flex items-center justify-center text-lg cursor-pointer border-none bg-transparent text-muted transition-colors"
                        title="Add emoji">
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

                    <button className="w-10 h-10 rounded-lg hover:bg-raised flex items-center justify-center text-lg cursor-pointer border-none bg-transparent text-muted transition-colors" title="Add link"
                      onClick={() => {
                        const url = window.prompt('Enter link URL:')
                        if (url) setMsgText(t => t + ' ' + url + ' ')
                      }}>
                      🔗
                    </button>

                    <button className="w-10 h-10 rounded-lg hover:bg-raised flex items-center justify-center text-lg cursor-pointer border-none bg-transparent text-muted transition-colors" title="Mention someone"
                      onClick={() => {
                        setMsgText(t => t + '@')
                        inputRef.current?.focus()
                      }}>
                      @
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sibling overlays (DM Picker & Group Creator) */}
      {showNew && (
        <NewChatModal onClose={() => setShowNew(null)} onCreate={handleCreateChat} adminId={user?.uid} initialStep={showNew} />
      )}

      {showDMPicker && (
        <DMPicker
          chats={chats}
          currentUserId={user?.uid}
          onClose={() => setShowDMPicker(false)}
          dmStarting={dmStarting}
          onStartDM={async (otherId, otherName) => {
            setDmStarting(true)
            try {
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
              setActiveChat(chatId)
            } catch (err) {
              console.error("Failed to start DM:", err)
              alert("Failed to start chat. Please try again.")
            } finally {
              setDmStarting(false)
            }
          }}
        />
      )}

      {forwardMsg && (
        <ForwardSheet text={forwardMsg.text}
          chats={chats.filter(c => c.id !== activeChatId)}
          onClose={() => setForwardMsg(null)}
          onForward={handleForward} />
      )}

      {fwdToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 px-4 py-2 bg-ok text-white text-xs font-bold rounded-xl z-50 whitespace-nowrap">
          ✅ {fwdToast}
        </div>
      )}

      {/* Lightbox Modal */}
      {lightbox && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/90 cursor-pointer animate-fade-in"
          onClick={() => setLightbox(null)}>
          <button className="absolute top-5 right-5 text-white text-3xl font-bold bg-transparent border-none outline-none select-none cursor-pointer"
            onClick={() => setLightbox(null)}>×</button>
          <img src={lightbox} alt="Full screen preview" className="max-w-full max-h-full object-contain p-4" />
        </div>
      )}
    </div>
  )
}

// ── DM Picker ─────────────────────────────────────────────────────────────────
function DMPicker({ chats, onClose, onStartDM, currentUserId, dmStarting }) {
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
          {loading || dmStarting ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <div className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              {dmStarting && <p className="text-xs text-dim">Starting chat thread...</p>}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-dim text-center py-8">No people found</p>
          ) : filtered.map(u => (
            <button key={u.id}
              disabled={dmStarting}
              onClick={() => onStartDM(u.id, `${u.firstName} ${u.lastName || ''}`.trim())}
              className="flex items-center gap-3 w-full px-4 py-3 text-left cursor-pointer bg-transparent border-none border-b border-app/20 hover:bg-raised disabled:opacity-50">
              <Avatar firstName={u.firstName} lastName={u.lastName} color={u.color} photo={u.photo} size={40} />
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

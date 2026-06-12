import { useState, useEffect, useRef } from 'react'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy,
} from 'firebase/firestore'
import DOMPurify from 'dompurify'
import { db } from '../../utils/firebase'
import useDirectoryStore from '../../stores/useDirectoryStore'
import useAuthStore      from '../../stores/useAuthStore'
import Button  from '../../components/Button'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'

// ── Background choices configuration ──────────────────────────────────────────
const BACKGROUNDS = [
  { key: 'default',    name: 'Default',      url: '',                 textCls: 'text-muted',        titleCls: 'text-primary',                  subCls: 'text-dim' },
  { key: 'bg_bell',    name: 'Notification',  url: 'bg_bell.png',       textCls: 'text-white/95',     titleCls: 'text-white font-extrabold',     subCls: 'text-white/70' },
  { key: 'bg_clouds',  name: 'Clouds',        url: 'bg_clouds.png',     textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_trees',   name: 'Trees',         url: 'bg_trees.png',      textCls: 'text-white/95',     titleCls: 'text-white font-extrabold',     subCls: 'text-white/70' },
  { key: 'bg_snow',    name: 'Snowflakes',    url: 'bg_snowflakes.png', textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_doodles', name: 'Doodles',       url: 'bg_doodles.png',    textCls: 'text-white/95',     titleCls: 'text-white font-extrabold',     subCls: 'text-white/70' },
]

// ── Common emojis for the picker ──────────────────────────────────────────────
const EMOJI_GROUPS = [
  { label: 'Common', emojis: ['😀','😊','😂','🎉','👏','❤️','🔥','✅','⭐','💡','📌','👍','🙌','💪','🎨','🎓'] },
  { label: 'School',  emojis: ['📚','✏️','🖍️','🎭','🎪','🎨','🖼️','📐','📏','🔬','🎶','🎵','🏫','📝','📋','📅'] },
]

// ── Rich text editor ───────────────────────────────────────────────────────────
function RichEditor({ value, onChange, background }) {
  const editorRef    = useRef(null)
  const initialised  = useRef(false)
  const [showEmoji,  setShowEmoji]  = useState(false)
  const [showLink,   setShowLink]   = useState(false)
  const [linkUrl,    setLinkUrl]    = useState('https://')
  const [linkText,   setLinkText]   = useState('')
  const savedRange   = useRef(null)

  // Initialise content once — center align by default
  useEffect(() => {
    if (!initialised.current && editorRef.current) {
      editorRef.current.innerHTML = value || ''
      initialised.current = true
      if (!value) document.execCommand('justifyCenter', false, undefined)
    }
  }, [])

  const exec = (cmd, val) => {
    editorRef.current?.focus()
    document.execCommand(cmd, false, val || undefined)
  }

  const saveSelection = () => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange()
  }

  const restoreSelection = () => {
    const sel = window.getSelection()
    if (savedRange.current && sel) {
      sel.removeAllRanges()
      sel.addRange(savedRange.current)
    }
  }

  const insertEmoji = (emoji) => {
    restoreSelection()
    editorRef.current?.focus()
    document.execCommand('insertText', false, emoji)
    setShowEmoji(false)
    onChange(editorRef.current?.innerHTML || '')
  }

  const insertLink = () => {
    const url  = linkUrl.trim()
    const text = linkText.trim() || url
    if (!url) return
    restoreSelection()
    editorRef.current?.focus()
    const html = `<a href="${url}" target="_blank" rel="noreferrer" style="color:var(--accent);text-decoration:underline">${text}</a>`
    document.execCommand('insertHTML', false, html)
    setShowLink(false)
    setLinkUrl('https://')
    setLinkText('')
    onChange(editorRef.current?.innerHTML || '')
  }

  const bg = BACKGROUNDS.find(b => b.key === background) || BACKGROUNDS[0]
  const bgUrl = bg.url ? `/app/backgrounds/${bg.url}` : ''
  const editorStyle = bgUrl ? {
    backgroundImage: `url(${bgUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? '#1e293b' : '#ffffff',
    textShadow: bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'none' : '0 1px 3px rgba(0,0,0,0.5)',
  } : {
    color: 'var(--text)',
  }

  const TOOL_BTN = "px-2.5 py-1.5 rounded-lg text-xs font-bold cursor-pointer bg-transparent border-none text-muted hover:bg-card hover:text-primary transition-colors"

  return (
    <div className="border border-app rounded-xl overflow-visible">
      {/* Toolbar */}
      <div className="flex gap-0.5 p-1.5 border-b border-app bg-raised flex-wrap items-center">
        <button className={`${TOOL_BTN} font-bold`}         onMouseDown={e => { e.preventDefault(); exec('bold') }}>B</button>
        <button className={`${TOOL_BTN} italic`}            onMouseDown={e => { e.preventDefault(); exec('italic') }}>I</button>
        <button className={`${TOOL_BTN} underline`}         onMouseDown={e => { e.preventDefault(); exec('underline') }}>U</button>
        <div className="w-px h-4 bg-app mx-0.5" />
        <button className={TOOL_BTN}                        onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'h2') }}>H2</button>
        <button className={TOOL_BTN}                        onMouseDown={e => { e.preventDefault(); exec('formatBlock', 'p') }}>¶</button>
        <div className="w-px h-4 bg-app mx-0.5" />
        <button className={TOOL_BTN}                        onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList') }}>•</button>
        <button className={TOOL_BTN}                        onMouseDown={e => { e.preventDefault(); exec('insertOrderedList') }}>1.</button>
        <div className="w-px h-4 bg-app mx-0.5" />
        {/* Link */}
        <div className="relative">
          <button className={TOOL_BTN}
            onMouseDown={e => { e.preventDefault(); saveSelection(); setShowLink(v => !v); setShowEmoji(false) }}
            title="Insert link">🔗</button>
          {showLink && (
            <>
              <div onClick={() => setShowLink(false)} className="fixed inset-0 z-10" />
              <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-app rounded-xl p-3 shadow-xl w-72 flex flex-col gap-2">
                <input value={linkText} onChange={e => setLinkText(e.target.value)} placeholder="Link text (optional)"
                  className="w-full bg-raised border border-app rounded-lg px-3 py-2 text-xs text-primary outline-none focus:border-accent" />
                <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…"
                  className="w-full bg-raised border border-app rounded-lg px-3 py-2 text-xs text-primary outline-none focus:border-accent" />
                <div className="flex gap-2">
                  <button onClick={() => setShowLink(false)} className="flex-1 py-1.5 rounded-lg border border-app text-xs text-muted cursor-pointer bg-transparent">Cancel</button>
                  <button onClick={insertLink} className="flex-1 py-1.5 rounded-lg bg-accent text-white text-xs font-bold cursor-pointer border-none">Insert</button>
                </div>
              </div>
            </>
          )}
        </div>
        {/* Emoji */}
        <div className="relative">
          <button className={TOOL_BTN}
            onMouseDown={e => { e.preventDefault(); saveSelection(); setShowEmoji(v => !v); setShowLink(false) }}
            title="Insert emoji">😊</button>
          {showEmoji && (
            <>
              <div onClick={() => setShowEmoji(false)} className="fixed inset-0 z-10" />
              <div className="absolute top-full left-0 mt-1 z-20 bg-card border border-app rounded-xl p-3 shadow-xl w-64">
                {EMOJI_GROUPS.map(g => (
                  <div key={g.label} className="mb-2 last:mb-0">
                    <p className="text-2xs text-dim uppercase tracking-wide font-semibold mb-1.5">{g.label}</p>
                    <div className="flex flex-wrap gap-1">
                      {g.emojis.map(e => (
                        <button key={e} onClick={() => insertEmoji(e)}
                          className="text-lg p-1 rounded hover:bg-raised cursor-pointer bg-transparent border-none transition-colors">{e}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable suppressContentEditableWarning
        dir="ltr"
        onInput={e => onChange(e.currentTarget.innerHTML)}
        className="min-h-[160px] px-4 py-3 text-sm outline-none max-w-none transition-all duration-300"
        style={{
          lineHeight: 1.7,
          direction: 'ltr',
          listStylePosition: 'inside',
          textAlign: 'center',
          ...editorStyle
        }}
      />
    </div>
  )
}

// ── Post card ─────────────────────────────────────────────────────────────────
function PostCard({ post, instructors, onEdit, onDelete, onRemind }) {
  const [expanded, setExpanded] = useState(false)
  const seenCount  = post.seenBy?.length || 0
  const totalInst  = instructors.length
  const pct        = totalInst > 0 ? Math.round((seenCount / totalInst) * 100) : 0
  const unseen     = instructors.filter(i => !(post.seenBy || []).includes(String(i.id)))
  const likeCount  = (post.likes    || []).length
  const cmtCount   = (post.comments || []).length

  const d = post.createdAt?.seconds
    ? new Date(post.createdAt.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Just now'

  const bg = BACKGROUNDS.find(b => b.key === post.background) || BACKGROUNDS[0]
  const bgUrl = bg.url ? `/app/backgrounds/${bg.url}` : ''
  const cardStyle = bgUrl ? {
    backgroundImage: `url(${bgUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? '#1e293b' : '#ffffff',
    textShadow: bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'none' : '0 1px 3px rgba(0,0,0,0.5)',
  } : {}

  return (
    <div className={`border rounded-2xl p-5 transition-all duration-300 ${bgUrl ? 'shadow-lg border-transparent' : 'bg-card border-app'}`} style={cardStyle}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <h3 className={`text-base font-bold truncate ${bg.titleCls}`}>{post.title}</h3>
          <p className={`text-xs mt-0.5 ${bg.subCls}`}>{d}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {unseen.length > 0 && (
            <Button small variant="ghost" onClick={onRemind} className={bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'hover:bg-slate-800/10 text-slate-700' : 'hover:bg-white/10 text-white/80' : ''}>📢 Remind ({unseen.length})</Button>
          )}
          <Button small variant="ghost" onClick={onEdit} className={bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'hover:bg-slate-800/10 text-slate-700' : 'hover:bg-white/10 text-white/80' : ''}>✏️</Button>
          <button onClick={onDelete} className={`cursor-pointer bg-transparent border-none text-base ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'text-slate-600 hover:text-danger' : 'text-white/60 hover:text-red-400' : 'text-dim hover:text-danger'}`}>🗑</button>
        </div>
      </div>

      <div
        className={`text-sm leading-relaxed mb-3 line-clamp-3 prose prose-sm max-w-none ${bg.textCls}`}
        style={{ textAlign: bgUrl ? 'center' : 'left' }}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content || '') }}
      />

      {/* Engagement counts */}
      {(likeCount > 0 || cmtCount > 0) && (
        <div className={`flex items-center gap-3 mb-3 text-xs ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'text-slate-600' : 'text-white/70' : 'text-dim'}`}>
          {likeCount > 0 && <span>❤️ {likeCount}</span>}
          {cmtCount  > 0 && <span>💬 {cmtCount}</span>}
        </div>
      )}

      {/* Seen progress */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className={`text-xs font-semibold ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'text-slate-700' : 'text-white/80' : 'text-muted'}`}>Seen by {seenCount} / {totalInst}</span>
          <button onClick={() => setExpanded(v => !v)} className={`text-xs font-semibold cursor-pointer bg-transparent border-none ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'text-accent' : 'text-white hover:text-white/80' : 'text-accent'}`}>
            {expanded ? 'Hide' : 'Show all'}
          </button>
        </div>
        <div className={`h-1.5 rounded-full overflow-hidden ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'bg-slate-800/10' : 'bg-white/20' : 'bg-raised'}`}>
          <div className={`h-full rounded-full transition-all duration-500 ${bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'bg-accent' : 'bg-white' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
        </div>
        {expanded && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {instructors.map(i => {
              const seen = (post.seenBy || []).includes(String(i.id))
              return (
                <span key={i.id}
                  className={`px-2 py-0.5 rounded-full text-xs font-semibold
                    ${seen ? bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'bg-accent/15 text-accent' : 'bg-white/20 text-white' : 'bg-ok-soft text-ok' : bgUrl ? bg.key === 'bg_clouds' || bg.key === 'bg_snow' ? 'bg-slate-800/5 text-slate-500' : 'bg-white/5 text-white/50' : 'bg-raised text-dim'}`}>
                  {seen ? '✓' : '·'} {i.firstName}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Compose modal ─────────────────────────────────────────────────────────────
function ComposeModal({ existing, onClose, onSave }) {
  const [title,      setTitle]      = useState(existing?.title      || 'The Team Weekly Buzz!')
  const [content,    setContent]    = useState(existing?.content    || '')
  const [background, setBackground] = useState(existing?.background || 'default')
  const [busy,       setBusy]       = useState(false)

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return
    setBusy(true)
    await onSave({ title: title.trim(), content, background })
    setBusy(false)
    onClose()
  }

  return (
    <Modal onClose={onClose} width="max-w-2xl" zIndex="z-[1200]">
      <ModalHeader title={existing ? 'Edit post' : 'New Weekly Buzz post'} onClose={onClose} />
      <div className="flex flex-col gap-4 overflow-y-auto pr-1" style={{ maxHeight: '60vh' }}>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Title</label>
          <input value={title} onChange={e => setTitle(e.target.value)} autoFocus
            className="w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"
            placeholder="e.g. Spring session kickoff 🌸" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-2">Card Background</label>
          <div className="flex flex-wrap gap-2.5">
            {BACKGROUNDS.map(bg => {
              const bgUrl = bg.url ? `/app/backgrounds/${bg.url}` : ''
              const active = background === bg.key
              return (
                <button
                  key={bg.key}
                  type="button"
                  onClick={() => setBackground(bg.key)}
                  className={`
                    w-20 h-14 rounded-xl border-2 transition-all duration-200 cursor-pointer overflow-hidden relative flex flex-col items-center justify-center
                    ${active ? 'border-accent scale-105 shadow-md shadow-accent/20' : 'border-app hover:border-muted'}
                  `}
                  style={bgUrl ? {
                    backgroundImage: `url(${bgUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  } : {
                    background: 'var(--card)',
                  }}
                >
                  <span className={`
                    text-[10px] font-extrabold px-1 py-0.5 rounded bg-black/60 text-white whitespace-nowrap
                    ${bgUrl ? '' : 'text-muted bg-transparent'}
                  `}>
                    {bg.name}
                  </span>
                  {active && (
                    <span className="absolute top-1 right-1 text-[10px] text-accent font-bold">✓</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">Content</label>
          <RichEditor value={content} onChange={setContent} background={background} />
        </div>
      </div>
      <ModalFooter>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={busy || !title.trim() || !content.trim()}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Publish post'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function WeeklyBuzzView() {
  const [posts,    setPosts]   = useState([])
  const [loading,  setLoading] = useState(true)
  const [compose,  setCompose] = useState(null)
  const [deleting, setDeleting]= useState(null)

  const { instructors } = useDirectoryStore()
  const { userProfile } = useAuthStore()

  useEffect(() => {
    const q = query(collection(db, 'weekly_buzz'), orderBy('createdAt', 'desc'))
    const unsub = onSnapshot(q, snap => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const handleSave = async ({ title, content, background }) => {
    if (compose?.id) {
      await updateDoc(doc(db, 'weekly_buzz', compose.id), {
        title, content, background: background || 'default', updatedAt: serverTimestamp(),
      })
    } else {
      await addDoc(collection(db, 'weekly_buzz'), {
        title, content, background: background || 'default', seenBy: [], likes: [], comments: [],
        createdAt: serverTimestamp(),
        authorName: userProfile?.firstName || 'Admin',
      })
    }
  }

  const handleDelete  = async (id) => { await deleteDoc(doc(db, 'weekly_buzz', id)); setDeleting(null) }
  const handleRemind  = (post) => {
    const unseen = instructors.filter(i => !(post.seenBy || []).includes(String(i.id)))
    alert(`Reminder sent to: ${unseen.map(i => i.firstName).join(', ')}`)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">
      <div className="px-6 py-4 bg-surface border-b border-app flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-lg">📢</div>
          <div>
            <h1 className="text-xl font-bold text-primary">Weekly Buzz</h1>
            <p className="text-xs text-dim">{posts.length} post{posts.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <Button variant="primary" icon="✏️" onClick={() => setCompose({})}>New post</Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-5">
        {posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-5xl mb-4">📢</p>
            <p className="text-lg font-bold text-muted mb-1">No posts yet</p>
            <Button variant="primary" onClick={() => setCompose({})}>Write your first post</Button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto flex flex-col gap-4">
            {posts.map(post => (
              <PostCard key={post.id} post={post} instructors={instructors}
                onEdit={() => setCompose(post)}
                onDelete={() => setDeleting(post.id)}
                onRemind={() => handleRemind(post)} />
            ))}
          </div>
        )}
      </div>

      {compose !== null && (
        <ComposeModal existing={compose?.id ? compose : null} onClose={() => setCompose(null)} onSave={handleSave} />
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)} width="max-w-xs">
          <ModalHeader title="Delete post?" onClose={() => setDeleting(null)} />
          <p className="text-sm text-muted mb-5">This will permanently delete the post for everyone.</p>
          <ModalFooter>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <button onClick={() => handleDelete(deleting)}
              className="px-4 py-1.5 bg-danger text-white text-sm font-semibold rounded-lg cursor-pointer border-none hover:opacity-90">Delete</button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}

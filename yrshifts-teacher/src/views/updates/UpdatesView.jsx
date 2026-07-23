import { useEffect, useState, useRef } from 'react'

const isIOSSafari = /iphone|ipad|ipod/i.test(navigator.userAgent) &&
  /safari/i.test(navigator.userAgent) &&
  !/chrome|crios|fxios/i.test(navigator.userAgent)
import DOMPurify       from 'dompurify'
import useTeacherStore from '../../stores/useTeacherStore'
import useAuthStore    from '../../stores/useAuthStore'

const BACKGROUNDS = [
  { key: 'default',    name: 'Default',      url: '',                 textCls: 'text-muted',        titleCls: 'text-primary',                  subCls: 'text-dim' },
  { key: 'bg_chick',   name: 'Chick',         url: 'bg_chick.png',      textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600', noWash: true },
  { key: 'bg_weather', name: 'Weather',       url: 'bg_weather.png',    textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600', noWash: true },
  { key: 'bg_bell',    name: 'Notification',  url: 'bg_bell.png',       textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_clouds',  name: 'Clouds',        url: 'bg_clouds.png',     textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_trees',   name: 'Trees',         url: 'bg_trees.png',      textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_snow',    name: 'Snowflakes',    url: 'bg_snowflakes.png', textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
  { key: 'bg_doodles', name: 'Doodles',       url: 'bg_doodles.png',    textCls: 'text-slate-800/95', titleCls: 'text-slate-900 font-extrabold', subCls: 'text-slate-600' },
]

function fmtDate(ts) {
  if (!ts?.seconds) return ''
  return new Date(ts.seconds * 1000).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function fmtCommentTime(ts) {
  if (!ts) return ''
  const d    = ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts)
  const diff = Date.now() - d
  if (diff < 60000)    return 'Just now'
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function PostModal({ post, userId, userName, onClose, onMarkSeen, onLike, onComment }) {
  const [commentText, setCommentText] = useState('')
  const [submitting,  setSubmitting]  = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { onMarkSeen(post.id, userId) }, [])

  const liked    = (post.likes || []).includes(userId)
  const likeCount = (post.likes || []).length
  const comments  = (post.comments || []).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  const bg = BACKGROUNDS.find(b => b.key === post.background) || BACKGROUNDS[0]
  const bgUrl = bg.url ? `/app/backgrounds/${bg.url}` : ''
  const cardStyle = bgUrl ? {
    backgroundImage: bg.noWash
      ? `url(${bgUrl})`
      : `linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)), url(${bgUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    color: '#1e293b',
    textShadow: 'none',
  } : {}

  const handleComment = async () => {
    if (!commentText.trim() || submitting) return
    setSubmitting(true)
    await onComment(post.id, userId, userName, commentText)
    setCommentText('')
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-app" style={isIOSSafari ? { paddingTop: "env(safe-area-inset-top, 44px)" } : {}}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3.5 bg-surface border-b border-app flex-shrink-0">
        <button onClick={onClose}
          className="text-accent text-lg cursor-pointer bg-transparent border-none leading-none px-1">‹</button>
        <p className="text-sm font-bold text-primary truncate flex-1">{post.title}</p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-5">
          <h1 className="text-xl font-bold text-primary mb-1">{post.title}</h1>
          <p className="text-xs text-dim mb-5">
            {post.authorName && <span className="font-semibold">{post.authorName} · </span>}
            {fmtDate(post.createdAt)}
          </p>
          <div className={`rounded-2xl border p-5 mb-6 transition-all duration-300 ${bgUrl ? 'shadow-lg border-transparent' : 'bg-card border-app'}`} style={cardStyle}>
            <div
              className={`text-sm leading-relaxed max-w-none ${bgUrl ? bg.textCls : 'prose prose-invert text-muted'}`}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content || '') }}
              style={{ lineHeight: 1.8, textAlign: bgUrl ? 'center' : 'left' }}
            />
          </div>

          {/* Like + comment counts */}
          <div className="flex items-center gap-4 py-3 border-t border-b border-app mb-5">
            <button onClick={() => onLike(post.id, userId, userName)}
              className={`flex items-center gap-1.5 text-sm font-semibold cursor-pointer bg-transparent border-none transition-colors
                ${liked ? 'text-pink-400' : 'text-muted hover:text-pink-400'}`}>
              <span>{liked ? '❤️' : '🤍'}</span>
              <span>{likeCount > 0 ? likeCount : ''} {likeCount === 1 ? 'Like' : likeCount > 1 ? 'Likes' : 'Like'}</span>
            </button>
            <span className="text-dim text-xs">·</span>
            <button onClick={() => inputRef.current?.focus()}
              className="flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-primary cursor-pointer bg-transparent border-none">
              <span>💬</span>
              <span>{comments.length > 0 ? comments.length : ''} {comments.length === 1 ? 'Comment' : 'Comments'}</span>
            </button>
          </div>

          {/* Comments */}
          {comments.length > 0 && (
            <div className="flex flex-col gap-3 mb-5">
              {comments.map(c => (
                <div key={c.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent-soft flex items-center justify-center text-xs font-bold text-accent flex-shrink-0">
                    {c.userName?.[0] || '?'}
                  </div>
                  <div className="flex-1 bg-raised border border-app rounded-xl px-3 py-2">
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-xs font-bold text-primary">{c.userName}</span>
                      <span className="text-2xs text-dim">{fmtCommentTime(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-muted leading-relaxed">{c.text}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Comment input */}
      <div className="px-4 py-3 bg-surface border-t border-app flex items-end gap-2 flex-shrink-0"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
        <div className="flex-1 bg-raised border border-app rounded-2xl px-3.5 py-2.5">
          <textarea ref={inputRef} value={commentText}
            onChange={e => setCommentText(e.target.value)}
            placeholder="Write a comment…" rows={1}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment() } }}
            style={{ resize: 'none', maxHeight: 80, overflow: 'auto' }}
            className="w-full bg-transparent text-sm text-primary placeholder:text-dim outline-none resize-none" />
        </div>
        <button onClick={handleComment} disabled={!commentText.trim() || submitting}
          className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center text-sm cursor-pointer border-none disabled:opacity-40 flex-shrink-0">
          {submitting ? '…' : '➤'}
        </button>
      </div>
    </div>
  )
}

export default function UpdatesView() {
  const { buzzPosts, markBuzzSeen, toggleBuzzLike, addBuzzComment } = useTeacherStore()
  const { user, userProfile } = useAuthStore()
  const [openPost, setOpenPost] = useState(null)

  const uid      = user?.uid
  const userName = userProfile ? `${userProfile.firstName} ${userProfile.lastName || ''}`.trim() : 'Teacher'

  // Keep openPost in sync with live data (so likes/comments update in modal)
  const livePost = openPost ? buzzPosts.find(p => p.id === openPost.id) || openPost : null

  if (livePost) {
    return (
      <PostModal
        post={livePost}
        userId={uid}
        userName={userName}
        onClose={() => setOpenPost(null)}
        onMarkSeen={markBuzzSeen}
        onLike={toggleBuzzLike}
        onComment={addBuzzComment}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-4 py-4 flex flex-col gap-3">

        {buzzPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-4xl mb-3">📢</p>
            <p className="text-base font-semibold text-muted">No updates yet</p>
            <p className="text-xs text-dim mt-1">Your admin's posts will appear here</p>
          </div>
        ) : buzzPosts.map(post => {
          const seen       = (post.seenBy   || []).includes(uid)
          const liked      = (post.likes    || []).includes(uid)
          const likeCount  = (post.likes    || []).length
          const cmtCount   = (post.comments || []).length
          const d = post.createdAt?.seconds
            ? new Date(post.createdAt.seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : ''

          const bg = BACKGROUNDS.find(b => b.key === post.background) || BACKGROUNDS[0]
          const bgUrl = bg.url ? `/app/backgrounds/${bg.url}` : ''
          const cardStyle = bgUrl ? {
            backgroundImage: bg.noWash
              ? `url(${bgUrl})`
              : `linear-gradient(rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.5)), url(${bgUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            color: '#1e293b',
            textShadow: 'none',
          } : {}

          return (
            <div key={post.id}
              className={`border rounded-2xl overflow-hidden transition-all duration-300 ${bgUrl ? 'shadow-lg border-transparent' : 'bg-card border-app'}`}
              style={cardStyle}>
              {/* Card body — tap to open */}
              <button onClick={() => setOpenPost(post)}
                className="w-full text-left p-4 cursor-pointer bg-transparent border-none">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 mt-1">
                    {seen
                      ? <div className={`w-2 h-2 rounded-full ${bgUrl ? 'bg-slate-700/20' : 'bg-raised'}`} />
                      : <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className={`text-sm leading-tight ${seen ? 'font-medium' : 'font-bold'} ${bgUrl ? bg.titleCls : 'text-primary'}`}>
                        {post.title}
                      </p>
                      <span className={`text-xs flex-shrink-0 ${bgUrl ? bg.subCls : 'text-dim'}`}>{d}</span>
                    </div>
                    <div className={`text-xs line-clamp-2 leading-relaxed mt-1 ${bgUrl ? bg.textCls : 'rounded-lg border px-2.5 py-2 bg-raised border-app text-dim'}`}>
                      {post.content?.replace(/<[^>]*>/g, '').slice(0, 120)}
                    </div>
                    {!seen && (
                      <span className="inline-block mt-2 px-2 py-0.5 rounded-full bg-accent text-white text-[10px] font-bold uppercase tracking-wide">
                        New
                      </span>
                    )}
                  </div>
                </div>
              </button>

              {/* Like + comment bar */}
              <div className={`flex border-t ${bgUrl ? 'border-slate-800/10' : 'border-app'}`}>
                <button
                  onClick={() => toggleBuzzLike(post.id, uid, userName)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold cursor-pointer bg-transparent border-none transition-colors
                    ${liked ? 'text-pink-400' : bgUrl ? 'text-slate-600 hover:text-pink-500' : 'text-muted hover:text-pink-400'}`}>
                  <span>{liked ? '❤️' : '🤍'}</span>
                  <span>{likeCount > 0 ? likeCount : 'Like'}</span>
                </button>
                <div className={`w-px ${bgUrl ? 'bg-slate-800/10' : 'bg-app'}`} />
                <button
                  onClick={() => { setOpenPost(post) }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold cursor-pointer bg-transparent border-none transition-colors
                    ${bgUrl ? 'text-slate-600 hover:text-primary' : 'text-muted hover:text-primary'}`}>
                  <span>💬</span>
                  <span>{cmtCount > 0 ? cmtCount : 'Comment'}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

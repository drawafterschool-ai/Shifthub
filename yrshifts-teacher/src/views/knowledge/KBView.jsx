import { useState, useEffect } from 'react'
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore'
import { db } from '../../utils/firebase'

const TYPE_ICONS = { folder: '📁', file: '📄', image: '🖼️', link: '🔗', pdf: '📋' }

function getType(node) {
  if (node.type === 'folder') return 'folder'
  if (node.type === 'link')   return 'link'
  if (node.mimeType?.includes('pdf'))     return 'pdf'
  if (node.mimeType?.startsWith('image')) return 'image'
  return 'file'
}

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024)       return `${bytes}B`
  if (bytes < 1024*1024)  return `${(bytes/1024).toFixed(0)}KB`
  return `${(bytes/(1024*1024)).toFixed(1)}MB`
}

export default function KBView() {
  const [nodes,   setNodes]   = useState([])
  const [crumbs,  setCrumbs]  = useState([{ id: null, name: 'Knowledge Base' }])
  const [search,  setSearch]  = useState('')
  const [loading, setLoading] = useState(true)

  const currentId = crumbs[crumbs.length - 1].id

  useEffect(() => {
    const q = query(collection(db, 'kb_nodes'), orderBy('order', 'asc'))
    const unsub = onSnapshot(q, snap => {
      setNodes(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      setLoading(false)
    })
    return unsub
  }, [])

  const visible = search
    ? nodes.filter(n => n.name?.toLowerCase().includes(search.toLowerCase()))
    : nodes.filter(n => (n.parentId || null) === currentId)

  const openFolder = (node) => {
    setCrumbs(c => [...c, { id: node.id, name: node.name }])
    setSearch('')
  }

  const navTo = (idx) => setCrumbs(c => c.slice(0, idx + 1))

  const openNode = (node) => {
    const t = getType(node)
    if (t === 'folder') { openFolder(node); return }
    if (node.url) window.open(node.url, '_blank')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-7 h-7 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-app">

      {/* Search bar */}
      <div className="px-4 pt-3 pb-2 bg-surface border-b border-app flex-shrink-0">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-sm pointer-events-none">🔍</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search files…"
            className="w-full bg-raised border border-app rounded-xl pl-9 pr-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors" />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-dim text-base cursor-pointer bg-transparent border-none">×</button>
          )}
        </div>
      </div>

      {/* Breadcrumbs */}
      {!search && crumbs.length > 1 && (
        <div className="px-4 py-2.5 bg-surface border-b border-app flex-shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-dim text-xs">›</span>}
                <button onClick={() => navTo(i)}
                  className={`text-sm font-semibold cursor-pointer bg-transparent border-none transition-colors
                    ${i === crumbs.length - 1 ? 'text-primary pointer-events-none' : 'text-accent'}`}>
                  {i === 0 ? '📚' : c.name}
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Node list */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-6">
            <p className="text-4xl mb-3">📚</p>
            <p className="text-base font-semibold text-muted">
              {search ? `No results for "${search}"` : 'Nothing here yet'}
            </p>
            {search && (
              <button onClick={() => setSearch('')}
                className="mt-3 text-sm text-accent font-semibold cursor-pointer bg-transparent border-none">
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="px-4 py-3 flex flex-col gap-2">
            {/* Back button when inside a folder */}
            {!search && crumbs.length > 1 && (
              <button onClick={() => navTo(crumbs.length - 2)}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl bg-raised border border-app text-left cursor-pointer">
                <span className="text-xl">⬅</span>
                <span className="text-sm font-semibold text-muted">Back</span>
              </button>
            )}

            {visible.map(node => {
              const t       = getType(node)
              const isFolder = t === 'folder'
              const childCount = isFolder ? nodes.filter(n => n.parentId === node.id).length : null
              const size    = formatSize(node.size)

              return (
                <button key={node.id}
                  onClick={() => openNode(node)}
                  className="flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl bg-card border border-app text-left cursor-pointer active:scale-[0.99] transition-all hover:border-accent/40">

                  {/* Icon */}
                  <div className="w-11 h-11 rounded-xl bg-raised flex items-center justify-center text-2xl flex-shrink-0">
                    {TYPE_ICONS[t]}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{node.name}</p>
                    <p className="text-xs text-dim mt-0.5 uppercase tracking-wide">
                      {isFolder
                        ? `${childCount} item${childCount !== 1 ? 's' : ''}`
                        : size || t}
                    </p>
                  </div>

                  {/* Chevron */}
                  <span className="text-dim text-sm flex-shrink-0">
                    {isFolder ? '›' : t === 'link' ? '↗' : '↓'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

import { useState, useEffect, useRef } from 'react'
import {
  collection, onSnapshot, addDoc, updateDoc, deleteDoc,
  doc, serverTimestamp, query, orderBy, writeBatch,
} from 'firebase/firestore'
import { ref as stRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../../utils/firebase'
import { uid } from '../../utils/helpers'
import Button from '../../components/Button'
import Modal, { ModalHeader, ModalFooter } from '../../components/Modal'

const TYPE_ICONS = { folder: '📁', file: '📄', image: '🖼️', link: '🔗', pdf: '📋' }

function getType(node) {
  if (node.type === 'folder') return 'folder'
  if (node.type === 'link')   return 'link'
  if (node.mimeType?.includes('pdf'))     return 'pdf'
  if (node.mimeType?.startsWith('image')) return 'image'
  return 'file'
}

// ── Add node modal ─────────────────────────────────────────────────────────────
function AddNodeModal({ parentId, onClose, onCreate }) {
  const [kind,  setKind]  = useState('file')
  const [name,  setName]  = useState('')
  const [url,   setUrl]   = useState('')
  const [selectedFiles, setSelectedFiles] = useState([])
  const [isFolderUpload, setIsFolderUpload] = useState(false)
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState(null)
  
  const filesRef = useRef(null)
  const folderRef = useRef(null)

  const INPUT = "w-full bg-raised border border-app rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors"

  const handleFilesChange = (e) => {
    const fList = Array.from(e.target.files)
    if (fList.length === 0) return
    setSelectedFiles(fList)
    setIsFolderUpload(false)
    if (fList.length === 1) {
      setName(fList[0].name.replace(/\.[^.]+$/, ''))
    } else {
      setName('')
    }
    setError(null)
  }

  const handleFolderChange = (e) => {
    const fList = Array.from(e.target.files)
    if (fList.length === 0) return
    setSelectedFiles(fList)
    setIsFolderUpload(true)
    const rootFolder = fList[0]?.webkitRelativePath.split('/')[0] || ''
    setName(rootFolder)
    setError(null)
  }

  const handleCreate = async () => {
    const finalName = name.trim()
    if (kind === 'folder' && !finalName) return
    if (kind === 'link' && (!finalName || !url.trim())) return
    if (kind === 'file' && selectedFiles.length === 0) return

    setBusy(true)
    setError(null)
    try {
      if (kind === 'folder') {
        let node = { name: finalName, type: 'folder', order: Date.now(), createdAt: serverTimestamp() }
        await onCreate(node)
      } else if (kind === 'link') {
        let node = { name: finalName, type: 'link', url: url.trim(), order: Date.now(), createdAt: serverTimestamp() }
        await onCreate(node)
      } else if (kind === 'file') {
        if (isFolderUpload) {
          // Folder upload: reconstruct structure
          const pathCache = {}
          for (const file of selectedFiles) {
            const parts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : []
            let currentParentId = parentId || null
            
            // Create nested folders
            for (let depth = 0; depth < parts.length - 1; depth++) {
              const folderName = parts[depth]
              const pathKey = parts.slice(0, depth + 1).join('/')
              
              if (!pathCache[pathKey]) {
                const newFolderNode = {
                  name: folderName,
                  type: 'folder',
                  parentId: currentParentId,
                  order: Date.now(),
                  createdAt: serverTimestamp()
                }
                const docRef = await addDoc(collection(db, 'kb_nodes'), newFolderNode)
                pathCache[pathKey] = docRef.id
              }
              currentParentId = pathCache[pathKey]
            }
            
            // Upload the file
            const snap = await uploadBytes(stRef(storage, `kb/${uid()}_${file.name}`), file)
            const downloadUrl = await getDownloadURL(snap.ref)
            const fileNode = {
              name: file.name.replace(/\.[^.]+$/, ''),
              type: 'file',
              parentId: currentParentId,
              order: Date.now(),
              createdAt: serverTimestamp(),
              url: downloadUrl,
              mimeType: file.type,
              size: file.size
            }
            await addDoc(collection(db, 'kb_nodes'), fileNode)
          }
        } else {
          // Multiple or single file upload (flat)
          for (const file of selectedFiles) {
            const snap = await uploadBytes(stRef(storage, `kb/${uid()}_${file.name}`), file)
            const downloadUrl = await getDownloadURL(snap.ref)
            const fileDisplayName = (selectedFiles.length === 1 && finalName) 
              ? finalName 
              : file.name.replace(/\.[^.]+$/, '')
            
            const fileNode = {
              name: fileDisplayName,
              type: 'file',
              parentId: parentId || null,
              order: Date.now(),
              createdAt: serverTimestamp(),
              url: downloadUrl,
              mimeType: file.type,
              size: file.size
            }
            await onCreate(fileNode)
          }
        }
      }
      onClose()
    } catch (err) {
      console.error("Error creating KB node:", err)
      setError(err.message || String(err))
    } finally { setBusy(false) }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (canSubmit && !busy) {
      handleCreate()
    }
  }

  const canSubmit = kind === 'folder'
    ? name.trim()
    : kind === 'link'
      ? name.trim() && url.trim()
      : selectedFiles.length > 0

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add item" onClose={onClose} />
      <form onSubmit={handleSubmit}>
        <div className="flex rounded-xl border border-app overflow-hidden mb-4">
          {[['folder','📁 Folder'],['file','📄 File'],['link','🔗 Link']].map(([k,label]) => (
            <button key={k} type="button" onClick={() => { setKind(k); setName(''); setSelectedFiles([]); setError(null) }}
              className={`flex-1 py-2 text-sm font-semibold cursor-pointer border-none transition-colors
                 ${kind===k ? 'bg-accent text-white' : 'bg-transparent text-muted hover:text-primary'}`}>{label}</button>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {(kind === 'folder' || kind === 'link') && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} autoFocus className={INPUT}
                placeholder={kind === 'folder' ? 'e.g. Spring Resources' : 'e.g. Google Drive'} />
            </div>
          )}
          {kind === 'link' && (
            <div>
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">URL *</label>
              <input value={url} onChange={e => setUrl(e.target.value)} className={INPUT} placeholder="https://…" />
            </div>
          )}
          {kind === 'file' && (
            <div className="flex flex-col gap-3">
              <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Upload *</label>
              <input ref={filesRef} type="file" multiple className="hidden" onChange={handleFilesChange} />
              <input ref={folderRef} type="file" webkitdirectory="" directory="" className="hidden" onChange={handleFolderChange} />
              
              <div className="flex gap-3">
                <button type="button" onClick={() => filesRef.current?.click()}
                  className="flex-1 border-2 border-dashed border-app rounded-xl py-6 text-sm text-muted hover:border-accent hover:text-accent transition-colors cursor-pointer bg-transparent flex flex-col items-center justify-center gap-1.5">
                  <span className="text-2xl">📄</span>
                  <span>Upload Files</span>
                </button>
                <button type="button" onClick={() => folderRef.current?.click()}
                  className="flex-1 border-2 border-dashed border-app rounded-xl py-6 text-sm text-muted hover:border-accent hover:text-accent transition-colors cursor-pointer bg-transparent flex flex-col items-center justify-center gap-1.5">
                  <span className="text-2xl">📁</span>
                  <span>Upload Folder</span>
                </button>
              </div>

              {selectedFiles.length > 0 && (
                <div className="bg-raised border border-app rounded-xl p-3 text-xs text-muted flex flex-col gap-1 max-h-32 overflow-y-auto">
                  <p className="font-semibold text-primary mb-1">
                    {isFolderUpload ? `Folder: ${name}` : `${selectedFiles.length} file(s) selected:`}
                  </p>
                  {selectedFiles.slice(0, 5).map((f, idx) => (
                    <span key={idx} className="truncate">
                      📎 {isFolderUpload ? f.webkitRelativePath : f.name}
                    </span>
                  ))}
                  {selectedFiles.length > 5 && (
                    <span className="text-dim italic">...and {selectedFiles.length - 5} more</span>
                  )}
                </div>
              )}

              {selectedFiles.length === 1 && !isFolderUpload && (
                <div>
                  <label className="block text-xs font-semibold text-muted uppercase tracking-wide mb-1">Display name (optional)</label>
                  <input value={name} onChange={e => setName(e.target.value)} className={INPUT}
                    placeholder={selectedFiles[0].name.replace(/\.[^.]+$/, '')} />
                </div>
              )}
            </div>
          )}
          {error && (
            <p className="text-xs text-danger font-semibold mt-1">
              ❌ {error}
            </p>
          )}
        </div>
        <ModalFooter>
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !canSubmit}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

// ── Draggable grid card ────────────────────────────────────────────────────────
function NodeCard({ node, childCount, onOpen, onDelete, onDragStart, onDragOver, onDrop, isDragging, isOver }) {
  const t    = getType(node)
  const size = node.size
    ? (node.size < 1024 ? `${node.size}B` : node.size < 1048576 ? `${(node.size/1024).toFixed(0)}KB` : `${(node.size/1048576).toFixed(1)}MB`)
    : null

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver() }}
      onDrop={e => { e.preventDefault(); onDrop() }}
      onDragEnd={() => onDragOver(null)}
      className={`group relative bg-card border rounded-2xl p-4 cursor-pointer transition-all select-none
        ${isDragging  ? 'opacity-40 scale-95'                      : ''}
        ${isOver      ? 'border-accent bg-accent-soft scale-[1.02]' : 'border-app hover:border-accent/50'}`}
      onClick={onOpen}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-3xl">{TYPE_ICONS[t]}</span>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-dim text-xs cursor-grab" title="Drag to reorder">⠿</span>
          <button onClick={e => { e.stopPropagation(); onDelete() }}
            className="text-dim hover:text-danger text-base cursor-pointer bg-transparent border-none">🗑</button>
        </div>
      </div>
      <p className="text-sm font-semibold text-primary truncate mb-0.5">{node.name}</p>
      <p className="text-xs text-dim uppercase tracking-wide">
        {t === 'folder' ? `${childCount} item${childCount !== 1 ? 's' : ''}` : size || t}
      </p>
    </div>
  )
}

// ── Main view ──────────────────────────────────────────────────────────────────
export default function KBView() {
  const [nodes,    setNodes]    = useState([])
  const [crumbs,   setCrumbs]   = useState([{ id: null, name: 'Knowledge Base' }])
  const [showAdd,  setShowAdd]  = useState(false)
  const [search,   setSearch]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [delBusy,  setDelBusy]  = useState(false)
  const [dragId,   setDragId]   = useState(null)   // id of node being dragged
  const [overId,   setOverId]   = useState(null)   // id of node being hovered over

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

  const openFolder = (node) => { setCrumbs(c => [...c, { id: node.id, name: node.name }]); setSearch('') }
  const navTo      = (idx)  => setCrumbs(c => c.slice(0, idx + 1))

  const handleAdd = async (node) => {
    await addDoc(collection(db, 'kb_nodes'), { parentId: currentId, ...node })
  }

  const handleDelete = async (id) => {
    setDelBusy(true)
    try {
      const batch = writeBatch(db)
      const collectIds = (nid) => {
        const ids = [nid]
        const children = nodes.filter(n => n.parentId === nid)
        children.forEach(child => {
          ids.push(...collectIds(child.id))
        })
        return ids
      }
      const idsToDelete = collectIds(id)
      idsToDelete.forEach(nid => {
        batch.delete(doc(db, 'kb_nodes', nid))
      })
      await batch.commit()
      setDeleting(null)
    } catch (err) {
      console.error("Error deleting item:", err)
      alert("Failed to delete item: " + err.message)
    } finally {
      setDelBusy(false)
    }
  }

  // ── Drag-and-drop reorder ──────────────────────────────────────────────────
  const handleDrop = async (draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) {
      setDragId(null); setOverId(null); return
    }
    const dragged = visible.find(n => n.id === draggedId)
    const target  = visible.find(n => n.id === targetId)
    if (!dragged || !target) return

    // Swap orders
    const batch = writeBatch(db)
    batch.update(doc(db, 'kb_nodes', draggedId), { order: target.order })
    batch.update(doc(db, 'kb_nodes', targetId),  { order: dragged.order })
    await batch.commit()
    setDragId(null); setOverId(null)
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-app">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-app">

      {/* Header */}
      <div className="px-6 py-4 bg-surface border-b border-app flex items-center justify-between flex-shrink-0 gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-dim text-xs">/</span>}
                <button onClick={() => navTo(i)}
                  className={`text-sm font-semibold cursor-pointer bg-transparent border-none transition-colors
                    ${i === crumbs.length - 1 ? 'text-primary pointer-events-none' : 'text-muted hover:text-accent'}`}>
                  {c.name}
                </button>
              </span>
            ))}
          </div>
          <p className="text-xs text-dim">{visible.length} item{visible.length !== 1 ? 's' : ''} · drag to reorder</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-dim text-xs pointer-events-none">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
              className="bg-raised border border-app rounded-lg pl-7 pr-3 py-1.5 text-sm text-primary placeholder:text-dim outline-none focus:border-accent transition-colors w-44" />
          </div>
          <Button variant="primary" small icon="+" onClick={() => setShowAdd(true)}>Add item</Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-6">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-4xl mb-3">📚</p>
            <p className="text-base font-semibold text-muted mb-1">
              {search ? `No results for "${search}"` : 'This folder is empty'}
            </p>
            {!search && <p className="text-sm text-dim">Click <strong>+ Add item</strong> to get started</p>}
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
            {visible.map(node => {
              const t = getType(node)
              return (
                <NodeCard
                  key={node.id}
                  node={node}
                  childCount={nodes.filter(n => n.parentId === node.id).length}
                  isDragging={dragId === node.id}
                  isOver={overId === node.id && dragId !== node.id}
                  onDragStart={() => setDragId(node.id)}
                  onDragOver={() => setOverId(node.id)}
                  onDrop={() => handleDrop(dragId, node.id)}
                  onOpen={() => {
                    if (t === 'folder') openFolder(node)
                    else if (node.url) window.open(node.url, '_blank')
                  }}
                  onDelete={() => setDeleting(node.id)}
                />
              )
            })}
          </div>
        )}
      </div>

      {showAdd && <AddNodeModal parentId={currentId} onClose={() => setShowAdd(false)} onCreate={handleAdd} />}

      {deleting && (
        <Modal onClose={() => setDeleting(null)} width="max-w-xs">
          <ModalHeader title="Delete item?" onClose={() => setDeleting(null)} />
          <p className="text-sm text-muted mb-5">This will permanently delete the item and all its contents.</p>
          <ModalFooter>
            <Button onClick={() => setDeleting(null)} disabled={delBusy}>Cancel</Button>
            <button onClick={() => handleDelete(deleting)} disabled={delBusy}
              className="px-4 py-1.5 bg-danger text-white text-sm font-semibold rounded-lg cursor-pointer border-none hover:opacity-90 disabled:opacity-50">
              {delBusy ? 'Deleting...' : 'Delete'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}

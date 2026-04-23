import { useState } from 'react'
import { uid } from '../utils/helpers'

export function useSms() {
  const [msgs, setMsgs] = useState([])

  const send = (list) => {
    const withIds = list.map(m => ({ ...m, id: uid() }))
    setMsgs(prev => [...prev, ...withIds])
    withIds.forEach(m =>
      setTimeout(() => setMsgs(prev => prev.filter(x => x.id !== m.id)), 5000)
    )
  }

  const add = (text) => send([{ to: 'System', text }])

  const dismiss = (id) => setMsgs(prev => prev.filter(x => x.id !== id))

  return { msgs, send, add, dismiss }
}

export function SmsToasts({ msgs, onDismiss }) {
  if (!msgs.length) return null
  return (
    <div className="fixed top-4 right-4 z-[3000] flex flex-col gap-2 max-w-sm">
      {msgs.map(m => (
        <div key={m.id} className="flex gap-3 items-start bg-card border border-app rounded-xl p-3 shadow-lg animate-fade-in">
          <div className="w-8 h-8 rounded-full bg-ok-soft flex items-center justify-center flex-shrink-0 text-sm">💬</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-ok uppercase tracking-wide">Sent</p>
            <p className="text-sm font-semibold text-primary truncate">{m.to}</p>
            <p className="text-xs text-muted mt-0.5 line-clamp-2">{m.text}</p>
          </div>
          <button onClick={() => onDismiss(m.id)} className="text-dim hover:text-muted text-base leading-none flex-shrink-0">×</button>
        </div>
      ))}
    </div>
  )
}

import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { db } from './firebase'
import { uid } from './helpers'

export const createNotification = async (data) => {
  const id = uid()
  await setDoc(doc(db, 'notifications', id), {
    id,
    status:    'unread',
    createdAt: Date.now(),
    ...data,
  })
  return id
}

export const markRead = (id) =>
  updateDoc(doc(db, 'notifications', id), { status: 'read', readAt: Date.now() })

export const markAllRead = (ids) =>
  Promise.all(ids.map(id => markRead(id)))

export const NOTIF_ICONS = {
  shift_assigned:  '📅',
  shift_confirmed: '✅',
  shift_rejected:  '❌',
  shift_claimed:   '⚡',
  chat_message:    '💬',
  buzz_like:       '❤️',
  buzz_comment:    '🗨️',
}

export const NOTIF_COLORS = {
  shift_assigned:  'text-accent',
  shift_confirmed: 'text-ok',
  shift_rejected:  'text-danger',
  shift_claimed:   'text-warn',
  chat_message:    'text-purple-400',
  buzz_like:       'text-pink-400',
  buzz_comment:    'text-amber-400',
}

export const notifMessage = (n) => {
  switch (n.type) {
    case 'shift_assigned':  return n.message || `You have a new shift on ${n.shiftDate} at ${n.shiftStart}`
    case 'shift_confirmed': return `${n.actorName} confirmed their shift on ${n.shiftDate}`
    case 'shift_rejected':  return `${n.actorName} rejected their shift on ${n.shiftDate} — needs reassignment`
    case 'shift_claimed':   return `${n.actorName} claimed the open shift on ${n.shiftDate}`
    case 'chat_message':    return `${n.actorName}: ${n.preview || 'sent a message'}`
    case 'buzz_like':       return `${n.actorName} liked "${n.postTitle}"`
    case 'buzz_comment':    return `${n.actorName} commented on "${n.postTitle}"`
    default:                return n.message || 'New notification'
  }
}

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

export const markRead    = (id)  => updateDoc(doc(db, 'notifications', id), { status: 'read', readAt: Date.now() })
export const markAllRead = (ids) => Promise.all(ids.map(id => markRead(id)))

// ── Icons ─────────────────────────────────────────────────────────────────────
export const NOTIF_ICONS = {
  // Shifts
  shift_assigned:  '📅',
  shift_confirmed: '✅',
  shift_rejected:  '❌',
  shift_claimed:   '⚡',
  shift_unconfirmed: '⚠️',
  shift_edited:    '✏️',
  shift_deleted:   '🗑',
  shift_reminder:  '⏰',
  // People
  instructor_joined: '👋',
  instructor_left:   '👤',
  first_login:       '🎉',
  // Chat
  chat_message:    '💬',
  chat_reaction:   '😊',
  // Buzz
  buzz_posted:     '📢',
  buzz_like:       '❤️',
  buzz_comment:    '🗨️',
  buzz_seen:       '👁',
}

// ── Colour classes ────────────────────────────────────────────────────────────
export const NOTIF_COLORS = {
  shift_assigned:  'text-accent',
  shift_confirmed: 'text-ok',
  shift_rejected:  'text-danger',
  shift_claimed:   'text-warn',
  shift_unconfirmed: 'text-warn',
  shift_edited:    'text-muted',
  shift_deleted:   'text-danger',
  shift_reminder:  'text-warn',
  instructor_joined: 'text-ok',
  instructor_left:   'text-muted',
  first_login:       'text-ok',
  chat_message:    'text-purple-400',
  chat_reaction:   'text-pink-400',
  buzz_posted:     'text-warn',
  buzz_like:       'text-pink-400',
  buzz_comment:    'text-amber-400',
  buzz_seen:       'text-dim',
}

// ── Tab groups ────────────────────────────────────────────────────────────────
export const SHIFT_TYPES   = ['shift_assigned','shift_confirmed','shift_rejected','shift_claimed','shift_unconfirmed','shift_edited','shift_deleted','shift_reminder']
export const PEOPLE_TYPES  = ['instructor_joined','instructor_left','first_login']
export const CHAT_TYPES    = ['chat_message','chat_reaction']
export const BUZZ_TYPES    = ['buzz_posted','buzz_like','buzz_comment','buzz_seen']

// ── Message builders ──────────────────────────────────────────────────────────
export const notifMessage = (n) => {
  const name  = n.actorName  || 'Someone'
  const shift = n.shiftTitle || 'a shift'
  const date  = n.shiftDate  || ''
  const time  = n.shiftStart || ''

  switch (n.type) {
    // Shifts
    case 'shift_assigned':
      return n.message || `New shift assigned on ${date}${time ? ' at ' + time : ''} — ${shift}`
    case 'shift_confirmed':
      return `${name} confirmed their shift on ${date}${time ? ' at ' + time : ''}`
    case 'shift_rejected':
      return `${name} rejected their shift on ${date}${time ? ' at ' + time : ''} — needs reassignment`
    case 'shift_claimed':
      return `${name} claimed the open shift on ${date}${time ? ' at ' + time : ''}`
    case 'shift_unconfirmed':
      return `${name} has not confirmed their shift on ${date}${time ? ' at ' + time : ''} — starts in ~5 hours!`
    case 'shift_edited':
      return `${name} edited "${shift}"${date ? ' on ' + date : ''}`
    case 'shift_deleted':
      return `Shift "${shift}"${date ? ' on ' + date : ''} was deleted`
    case 'shift_reminder':
      return `Reminder: "${shift}" starts ${n.reminderType === '24h' ? 'tomorrow' : 'in 2 hours'} at ${time}`
    // People
    case 'instructor_joined':
      return `${name} joined as a teacher`
    case 'instructor_left':
      return `${name} was removed from the team`
    case 'first_login':
      return `${name} logged in for the first time`
    // Chat
    case 'chat_message':
      return `${name} in ${n.chatName || 'a chat'}: ${n.preview || 'sent a message'}`
    case 'chat_reaction':
      return `${name} reacted ${n.emoji || '👍'} to your message`
    // Buzz
    case 'buzz_posted':
      return `New post: "${n.postTitle || 'Weekly Buzz'}"`
    case 'buzz_like':
      return `${name} liked "${n.postTitle || 'your post'}"`
    case 'buzz_comment':
      return `${name} commented on "${n.postTitle || 'your post'}"`
    case 'buzz_seen':
      return `${name} read "${n.postTitle || 'your post'}"`
    default:
      return n.message || 'New notification'
  }
}

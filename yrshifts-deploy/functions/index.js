'use strict'

const { onDocumentDeleted, onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule }         = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { setGlobalOptions }   = require('firebase-functions/v2')
const admin = require('firebase-admin')

admin.initializeApp()
const db = admin.firestore()
setGlobalOptions({ region: 'us-central1' })

const EMAIL_SECRETS = ['SMTP_USER', 'SMTP_PASS']

// ─────────────────────────────────────────────────────────────────────────────
// ICS CALENDAR FILE GENERATOR
// ─────────────────────────────────────────────────────────────────────────────
function generateICS(shift) {
  // Parse date and times into UTC format for ICS
  const parseDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null
    try {
      // Handles: "2:00 PM", "2:00PM", "02:15pm", "14:00"
      const m = timeStr.match(/(\d+):(\d+)\s*(am|pm)?/i)
      if (!m) return null
      let h = parseInt(m[1])
      const min = parseInt(m[2])
      const period = (m[3] || '').toUpperCase()
      if (period === 'PM' && h !== 12) h += 12
      if (period === 'AM' && h === 12) h = 0
      // Date can be YYYY-MM-DD or MM/DD/YYYY
      let year, month, day
      if (dateStr.includes('-')) {
        ;[year, month, day] = dateStr.split('-').map(Number)
      } else if (dateStr.includes('/')) {
        ;[month, day, year] = dateStr.split('/').map(Number)
      } else { return null }
      return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(h).padStart(2,'0')}${String(min).padStart(2,'0')}00`
    } catch { return null }
  }

  const dtStart = parseDateTime(shift.date, shift.start)
  const dtEnd   = parseDateTime(shift.date, shift.end)
  if (!dtStart || !dtEnd) return null

  const uid     = `shift-${shift.id || Date.now()}@yrshifts.web.app`
  const summary = (shift.title || 'Shift').replace(/[\n\r]/g, ' ')
  const location = (shift.address || '').replace(/[\n\r]/g, ' ')
  const desc    = [
    shift.title  || 'Shift',
    shift.start && shift.end ? `${shift.start} – ${shift.end}` : '',
    shift.students ? `Students: ${shift.students}` : '',
    shift.address  ? `Location: ${shift.address}`  : '',
    shift.note     ? `Note: ${shift.note}`          : '',
    '',
    'Open ShiftHub: https://yrshifts.web.app/app',
  ].filter(Boolean).join('\n')

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftHub//YRShifts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;TZID=America/Chicago:${dtStart}`,
    `DTEND;TZID=America/Chicago:${dtEnd}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : '',
    `DESCRIPTION:${desc.replace(/\n/g, '\\n')}`,
    `STATUS:CONFIRMED`,
    `BEGIN:VALARM`,
    `TRIGGER:-PT24H`,
    `ACTION:DISPLAY`,
    `DESCRIPTION:Reminder: ${summary} tomorrow`,
    `END:VALARM`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(l => l !== '').join('\r\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DELIVERY — FCM push + email + SMS
// ─────────────────────────────────────────────────────────────────────────────
async function deliver(user, subject, body, icsContent) {
  const results = { push: false, email: false, sms: false }


  // FCM push
  if (user.fcmToken) {
    try {
      await admin.messaging().send({
        token: user.fcmToken,
        notification: { title: 'ShiftHub', body },
        android: { priority: 'high' },
        apns: { payload: { aps: { sound: 'default', badge: 1 } } },
      })
      results.push = true
    } catch (e) {
      if (e.code === 'messaging/registration-token-not-registered') {
        await db.collection('users').doc(user.id).update({ fcmToken: null })
      } else { console.error('FCM:', e.message) }
    }
  }

  // Email
  if (process.env.SMTP_USER && process.env.SMTP_PASS && user.email) {
    try {
      const transport = require('nodemailer').createTransport({
        host:   'smtp.gmail.com',
        port:   465,
        secure: true,
        auth:   { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS.replace(/\s/g,'') },
        tls:    { rejectUnauthorized: false },
      })
      await transport.sendMail({
        from:    `"ShiftHub" <${process.env.SMTP_USER}>`,
        to:      user.email,
        subject,
        text:    body,
        html:    emailHtml(subject, body),
      })
      results.email = true
    } catch (e) { console.error('Email:', e.message) }
  }

  // SMS (Twilio)
  const phone = (user.phone || '').replace(/\D/g, '')
  if (process.env.TWILIO_SID && process.env.TWILIO_TOKEN && process.env.TWILIO_FROM && phone.length >= 10) {
    try {
      const e164 = phone.length === 10 ? `+1${phone}` : `+${phone}`
      await require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN)
        .messages.create({ body, from: process.env.TWILIO_FROM, to: e164 })
      results.sms = true
    } catch (e) { console.error('SMS:', e.message) }
  }

  return results
}

// Simple branded HTML email template
function emailHtml(subject, body) {
  const lines = body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .split('\n').map(l => `<p style="margin:0 0 8px">${l || '&nbsp;'}</p>`).join('')
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0F1117;color:#E8ECF4;padding:24px;margin:0">
  <div style="max-width:520px;margin:0 auto">
    <div style="background:#4EA8D6;color:white;border-radius:12px 12px 0 0;padding:20px 24px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">📅</span>
      <span style="font-size:18px;font-weight:700">ShiftHub</span>
    </div>
    <div style="background:#1C2030;border-radius:0 0 12px 12px;padding:24px">
      <p style="font-size:17px;font-weight:700;margin:0 0 16px;color:#E8ECF4">${subject}</p>
      <div style="color:#8B92A8;font-size:14px;line-height:1.7">${lines}</div>
      <div style="margin-top:24px">
        <a href="https://yrshifts.web.app/app" style="background:#4EA8D6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Open ShiftHub</a>
      </div>
    </div>
    <p style="color:#5C6380;font-size:11px;text-align:center;margin-top:16px">Young Rembrandts · ShiftHub</p>
  </div></body></html>`
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — get all teachers
// ─────────────────────────────────────────────────────────────────────────────
async function getAllTeachers() {
  const snap = await db.collection('users').where('role', '==', 'teacher').get()
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. DELETE AUTH WHEN USER DOC IS DELETED
// ─────────────────────────────────────────────────────────────────────────────
exports.onUserDeleted = onDocumentDeleted('users/{userId}', async (event) => {
  const userId = event.params.userId
  try {
    await admin.auth().deleteUser(userId)
    console.log(`Auth deleted: ${userId}`)
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. DELIVER EMAIL+PUSH+SMS WHEN A NOTIFICATION DOC IS CREATED
// ─────────────────────────────────────────────────────────────────────────────
exports.onNotificationCreated = onDocumentCreated({ document: 'notifications/{notifId}', secrets: EMAIL_SECRETS }, async (event) => {
  const notif = event.data?.data()
  if (!notif) return

  // Admin-feed notifications — fan out to all owners + admins
  if (!notif.recipientId || notif.recipientId === 'admin' || notif.forAdmin === true) {
    const snap = await db.collection('users')
      .where('role', 'in', ['owner', 'admin'])
      .get()
    for (const d of snap.docs) {
      await deliver({ id: d.id, ...d.data() }, buildSubject(notif), buildBody(notif))
    }
    return
  }

  const snap = await db.collection('users').doc(notif.recipientId).get()
  if (!snap.exists) return
  const user = { id: notif.recipientId, ...snap.data() }
  await deliver(user, buildSubject(notif), buildBody(notif))
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. SHIFT CHANGES — notify the affected teacher
//    Fires on any write to a shift doc. Sends email when:
//    - A shift is newly assigned to a teacher (instructorId set for first time)
//    - A shift is edited (key fields changed) and the teacher is assigned
//    - A shift is deleted (instructorId was set)
// ─────────────────────────────────────────────────────────────────────────────
exports.onShiftChanged = onDocumentWritten({ document: 'shifts/{shiftId}', secrets: EMAIL_SECRETS }, async (event) => {
  const before = event.data.before?.data()
  const after  = event.data.after?.data()

  // ── Deleted ──────────────────────────────────────────────────────────────
  if (!after) {
    if (!before?.instructorId) return
    const snap = await db.collection('users').doc(before.instructorId).get()
    if (!snap.exists) return
    const user    = { id: before.instructorId, ...snap.data() }
    const subject = `Shift cancelled — ${before.title || 'Your shift'}`
    const body    = `Hi ${user.firstName || 'there'},\n\nYour shift has been cancelled:\n\n  📅 ${before.date}\n  🕐 ${before.start} – ${before.end}\n  📚 ${before.title || 'Shift'}\n\nPlease contact your admin if you have questions.\n\nhttps://yrshifts.web.app/app`
    await deliver(user, subject, body)
    return
  }

  // ── Newly assigned ───────────────────────────────────────────────────────
  const wasAssigned  = before?.instructorId
  const nowAssigned  = after.instructorId
  if (!nowAssigned || after.claimable) return   // open/unassigned — handled separately

  if (!wasAssigned && nowAssigned) {
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    const subject = `New shift assigned — ${after.date}`
    const body    = `Hi ${user.firstName || 'there'},\n\nYou have a new shift:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nThe calendar invite is attached — tap it to add to your calendar.\n\nhttps://yrshifts.web.app/app`
    const ics = generateICS({ ...after, id: event.params.shiftId })
    console.log('ICS generated:', ics ? 'YES ('+ics.length+' chars)' : 'FAILED - null returned')
    console.log('Shift data for ICS:', JSON.stringify({ date: after.date, start: after.start, end: after.end, title: after.title }))
    await deliver(user, subject, body, ics)
    return
  }

  // ── Edited (already assigned) ────────────────────────────────────────────
  if (wasAssigned && nowAssigned === wasAssigned) {
    const changed = ['date','start','end','title','address','note'].filter(
      f => JSON.stringify(before[f]) !== JSON.stringify(after[f])
    )
    if (!changed.length) return
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    const subject = `Shift updated — ${after.date}`
    const body    = `Hi ${user.firstName || 'there'},\n\nYour shift has been updated:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nChanged: ${changed.join(', ')}\n\nUpdated calendar invite attached.\n\nhttps://yrshifts.web.app/app`
    const ics = generateICS({ ...after, id: event.params.shiftId })
    await deliver(user, subject, body, ics)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. OPEN SHIFT POSTED — notify ALL teachers
//    Fires when a shift is created or updated to be claimable
// ─────────────────────────────────────────────────────────────────────────────
exports.onOpenShift = onDocumentWritten({ document: 'shifts/{shiftId}', secrets: EMAIL_SECRETS }, async (event) => {
  const before = event.data.before?.data()
  const after  = event.data.after?.data()
  if (!after) return
  // Only trigger when claimable becomes true for the first time
  const becameOpen = after.claimable && !before?.claimable
  if (!becameOpen) return

  const teachers = await getAllTeachers()
  const subject  = `⚡ Open shift available — ${after.date}`
  const body     = `Hi,\n\nAn open shift is available:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Open Shift'}${after.address ? `\n  📍 ${after.address}` : ''}\n\nOpen ShiftHub to claim it before someone else does.\n\nhttps://yrshifts.web.app/app`

  for (const teacher of teachers) {
    await deliver(teacher, subject, body)
  }
  console.log(`Open shift notification sent to ${teachers.length} teachers`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEW EVENT — notify ALL teachers
// ─────────────────────────────────────────────────────────────────────────────
exports.onEventCreated = onDocumentCreated({ document: 'events/{eventId}', secrets: EMAIL_SECRETS }, async (event) => {
  const e = event.data?.data()
  if (!e) return

  const teachers = await getAllTeachers()
  const timeStr  = e.time ? ` at ${fmtTime(e.time)}` : ''
  const subject  = `📆 New event — ${e.title}`
  const body     = `Hi,\n\nA new event has been scheduled:\n\n  📌 ${e.title}\n  📅 ${e.date}${timeStr}${e.location ? `\n  📍 ${e.location}` : ''}${e.notes ? `\n  📝 ${e.notes}` : ''}\n\nOpen ShiftHub to RSVP.\n\nhttps://yrshifts.web.app/app`

  for (const teacher of teachers) {
    await deliver(teacher, subject, body)
  }
  console.log(`Event notification sent to ${teachers.length} teachers`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. NEW WEEKLY BUZZ POST — notify ALL teachers
// ─────────────────────────────────────────────────────────────────────────────
exports.onBuzzPostCreated = onDocumentCreated({ document: 'weekly_buzz/{postId}', secrets: EMAIL_SECRETS }, async (event) => {
  const post = event.data?.data()
  if (!post) return

  const teachers = await getAllTeachers()
  // Strip HTML tags for email plain-text preview
  const preview  = (post.content || '').replace(/<[^>]*>/g, '').slice(0, 200)
  const subject  = `📢 New post — ${post.title}`
  const body     = `Hi,\n\n${post.authorName || 'Admin'} posted a new update:\n\n"${post.title}"\n\n${preview}${preview.length === 200 ? '…' : ''}\n\nOpen ShiftHub to read the full post.\n\nhttps://yrshifts.web.app/app`

  for (const teacher of teachers) {
    await deliver(teacher, subject, body)
  }
  console.log(`Buzz notification sent to ${teachers.length} teachers`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. 24-HOUR REMINDER — daily at 8 AM Central
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// CHAT MESSAGE — notify chat members when a new message is sent
// ─────────────────────────────────────────────────────────────────────────────
exports.onChatMessageCreated = onDocumentCreated(
  { document: 'chats/{chatId}/messages/{msgId}', secrets: EMAIL_SECRETS },
  async (event) => {
    const msg    = event.data?.data()
    if (!msg) return
    const chatId = event.params.chatId

    // Get the chat to find members
    const chatSnap = await db.collection('chats').doc(chatId).get()
    if (!chatSnap.exists) return
    const chat = chatSnap.data()
    const members = chat.members || []

    // Notify all members except the sender
    for (const memberId of members) {
      if (memberId === msg.authorId) continue
      const uSnap = await db.collection('users').doc(memberId).get()
      if (!uSnap.exists) continue
      const user    = { id: memberId, ...uSnap.data() }
      const isGroup = chat.isGroup
      const subject = isGroup
        ? `💬 New message in ${chat.name || 'group chat'}`
        : `💬 New message from ${msg.authorName || 'your colleague'}`
      const body = `${msg.authorName || 'Someone'}: ${msg.text || '📎 Attachment'}\n\nhttps://yrshifts.web.app/app`
      await deliver(user, subject, body)
    }
  }
)

exports.sendDayBeforeReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Chicago', secrets: EMAIL_SECRETS },
  async () => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const tomorrowKey = d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    console.log(`24h reminders for ${tomorrowKey}`)

    const snap = await db.collection('shifts')
      .where('date', '==', tomorrowKey)
      .where('status', '==', 'published')
      .get()

    let sent = 0
    for (const shiftDoc of snap.docs) {
      const shift = shiftDoc.data()
      if (!shift.instructorId || shift.claimable) continue
      const reminderRef = db.collection('reminders').doc(`${shift.id}-24h`)
      if ((await reminderRef.get()).exists) continue
      const uSnap = await db.collection('users').doc(shift.instructorId).get()
      if (!uSnap.exists) continue
      const user = { id: shift.instructorId, ...uSnap.data() }
      await deliver(user,
        `⏰ Reminder: shift tomorrow — ${shift.title || 'Your shift'}`,
        buildReminderBody(user, shift, '24h'),
      )
      await reminderRef.set({
        shiftId: shift.id, instructorId: shift.instructorId,
        type: '24h', sentAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      sent++
    }
    console.log(`24h: ${sent} sent`)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// 8. 2-HOUR REMINDER — every 30 minutes
// ─────────────────────────────────────────────────────────────────────────────
exports.sendTwoHourReminders = onSchedule(
  { schedule: '*/30 * * * *', timeZone: 'America/Chicago', secrets: EMAIL_SECRETS },
  async () => {
    const now      = new Date()
    const todayKey = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const central  = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(now)
    const [hStr, mStr] = central.split(':')
    const nowMins  = parseInt(hStr) * 60 + parseInt(mStr)
    const winMin   = nowMins + 115
    const winMax   = nowMins + 150

    const snap = await db.collection('shifts')
      .where('date', '==', todayKey)
      .where('status', '==', 'published')
      .get()

    let sent = 0
    for (const shiftDoc of snap.docs) {
      const shift = shiftDoc.data()
      if (!shift.instructorId || shift.claimable) continue
      const startMins = parseShiftTime(shift.start)
      if (startMins < 0 || startMins < winMin || startMins > winMax) continue
      const reminderRef = db.collection('reminders').doc(`${shift.id}-2h`)
      if ((await reminderRef.get()).exists) continue
      const uSnap = await db.collection('users').doc(shift.instructorId).get()
      if (!uSnap.exists) continue
      const user = { id: shift.instructorId, ...uSnap.data() }
      await deliver(user,
        `⏰ Starting in 2 hours — ${shift.title || 'Your shift'}`,
        buildReminderBody(user, shift, '2h'),
      )
      await reminderRef.set({
        shiftId: shift.id, instructorId: shift.instructorId,
        type: '2h', sentAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      sent++
    }
    console.log(`2h: ${sent} sent`)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// 10. UNCONFIRMED SHIFT ALERT — notify owner 5 hours before shift start
// ─────────────────────────────────────────────────────────────────────────────
exports.sendUnconfirmedAlerts = onSchedule(
  { schedule: '*/30 * * * *', timeZone: 'America/Chicago', secrets: EMAIL_SECRETS },
  async () => {
    const now      = new Date()
    const todayKey = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
    const central  = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', hour: 'numeric', minute: 'numeric', hour12: false,
    }).format(now)
    const [hStr, mStr] = central.split(':')
    const nowMins  = parseInt(hStr) * 60 + parseInt(mStr)
    // Window: shifts starting in 4h30m–5h30m from now
    const winMin   = nowMins + 270
    const winMax   = nowMins + 330

    const snap = await db.collection('shifts')
      .where('date', '==', todayKey)
      .where('status', '==', 'published')
      .get()

    // Find all owners to notify
    const ownersSnap = await db.collection('users').where('role', '==', 'owner').get()
    const owners = ownersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (!owners.length) return

    let sent = 0
    for (const shiftDoc of snap.docs) {
      const shift = shiftDoc.data()
      if (!shift.instructorId || shift.claimable) continue
      // Only alert if teacher hasn't confirmed or rejected
      if (shift.confirmationStatus === 'confirmed' || shift.confirmationStatus === 'rejected') continue
      const startMins = parseShiftTime(shift.start)
      if (startMins < 0 || startMins < winMin || startMins > winMax) continue

      // De-duplicate — only send once per shift
      const alertRef = db.collection('reminders').doc(`${shiftDoc.id}-unconfirmed`)
      if ((await alertRef.get()).exists) continue

      // Get teacher name
      const tSnap = await db.collection('users').doc(shift.instructorId).get()
      const teacherName = tSnap.exists ? `${tSnap.data().firstName} ${tSnap.data().lastName}` : 'A teacher'

      // Notify all owners
      for (const owner of owners) {
        await deliver(owner,
          `⚠️ Shift unconfirmed — ${shift.title || 'Shift'} at ${shift.start}`,
          `Hi ${owner.firstName || 'there'},\n\n${teacherName} has not confirmed or rejected their shift starting in ~5 hours:\n\n  📅 ${shift.date}\n  🕐 ${shift.start} – ${shift.end}\n  📚 ${shift.title || 'Shift'}${shift.address ? `\n  📍 ${shift.address}` : ''}\n\nYou may want to follow up or reassign.\n\nhttps://yrshifts.web.app/admin`
        )
      }

      // Also create an in-app notification
      await db.collection('notifications').add({
        type:        'shift_unconfirmed',
        forAdmin:    true,
        recipientId: 'admin',
        actorName:   teacherName,
        shiftId:     shiftDoc.id,
        shiftDate:   shift.date,
        shiftStart:  shift.start,
        shiftTitle:  shift.title || 'Shift',
        message:     `${teacherName} has not confirmed their shift at ${shift.start}`,
        status:      'unread',
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })

      await alertRef.set({
        shiftId: shiftDoc.id, instructorId: shift.instructorId,
        type: 'unconfirmed', sentAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      sent++
    }
    console.log(`Unconfirmed alerts: ${sent} sent`)
  }
)

// ─────────────────────────────────────────────────────────────────────────────
// 9. CREATE TEACHER ACCOUNT (callable)
// ─────────────────────────────────────────────────────────────────────────────
exports.createTeacherAccount = onCall({ enforceAppCheck: false, secrets: EMAIL_SECRETS }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in')
  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || !['admin','owner'].includes(callerSnap.data().role)) {
    throw new HttpsError('permission-denied', 'Admin only')
  }

  const { email, phone, color, oldId } = request.data
  const displayFirst = (request.data.firstName || '').trim() || email.split('@')[0]
  const displayLast  = (request.data.lastName  || '').trim()

  if (!email) throw new HttpsError('invalid-argument', 'email is required')

  let uid
  try {
    const existing = await admin.auth().getUserByEmail(email)
    uid = existing.uid
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e
    const tempPw = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
    const rec    = await admin.auth().createUser({
      email, password: tempPw,
      displayName: `${displayFirst} ${displayLast}`.trim(),
      emailVerified: false,
    })
    uid = rec.uid
  }

  await db.collection('users').doc(uid).set({
    id: uid, firstName: displayFirst, lastName: displayLast,
    email, phone: phone || '', color: color || '#6366F1',
    role: 'teacher', photo: null,
  }, { merge: true })

  if (oldId && oldId !== uid) {
    try { await db.collection('users').doc(oldId).delete() } catch { /* ignore */ }
  }

  const link = await admin.auth().generateSignInWithEmailLink(email, {
    url: 'https://yrshifts.web.app/app',
    handleCodeInApp: true,
  })

  // Send invite email
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transport = require('nodemailer').createTransport({
        host:   'smtp.gmail.com',
        port:   465,
        secure: true,
        auth:   { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS.replace(/\s/g,'') },
        tls:    { rejectUnauthorized: false },
      })
      await transport.sendMail({
        from:    `"ShiftHub" <${process.env.SMTP_USER}>`,
        to:      email,
        subject: `${displayFirst}, you're invited to ShiftHub`,
        text:    `Hi ${displayFirst},\n\nYou've been added to ShiftHub by Young Rembrandts.\n\nClick the link below to set your password:\n\n${link}\n\nThis link expires in 6 hours.\n\nhttps://yrshifts.web.app/app`,
        html:    emailHtml(`Welcome to ShiftHub, ${displayFirst}!`,
          `You've been added to ShiftHub by Young Rembrandts.\n\n<a href="${link}" style="background:#4EA8D6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:8px 0">Set my password →</a>\n\nThis link expires in 6 hours.`),
      })
    } catch (e) { console.error('Invite email:', e.message) }
  }

  // Notify admin feed
  await db.collection('notifications').add({
    type: 'instructor_joined', forAdmin: true,
    actorName: `${displayFirst} ${displayLast}`.trim(),
    status: 'unread',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  return { uid, link }
})


// ─────────────────────────────────────────────────────────────────────────────
// 11. RESEND INVITE — callable, re-generates sign-in link for expired invites
// ─────────────────────────────────────────────────────────────────────────────
exports.resendInvite = onCall({ enforceAppCheck: false, secrets: EMAIL_SECRETS }, async (request) => {
  const { email } = request.data || {}
  if (!email) throw new HttpsError('invalid-argument', 'Email required')

  // Check user exists
  let userRecord
  try { userRecord = await admin.auth().getUserByEmail(email) }
  catch { throw new HttpsError('not-found', 'No account found for this email') }

  const snap = await db.collection('users').doc(userRecord.uid).get()
  if (!snap.exists) throw new HttpsError('not-found', 'No profile found')
  const profile = snap.data()
  const firstName = profile.firstName || 'there'

  const link = await admin.auth().generateSignInWithEmailLink(email, {
    url: 'https://yrshifts.web.app/app',
    handleCodeInApp: true,
  })

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transport = require('nodemailer').createTransport({
        host: 'smtp.gmail.com', port: 465, secure: true,
        auth: { user: process.env.SMTP_USER.trim(), pass: process.env.SMTP_PASS.replace(/\s/g,'') },
        tls: { rejectUnauthorized: false },
      })
      await transport.sendMail({
        from:    `"ShiftHub" <${process.env.SMTP_USER}>`,
        to:      email,
        subject: `${firstName}, here's your new ShiftHub invite link`,
        text:    `Hi ${firstName},\n\nYour previous invite link expired. Here's a fresh one:\n\n${link}\n\nThis link expires in 6 hours.\n\nhttps://yrshifts.web.app/app`,
        html:    emailHtml(`New invite link, ${firstName}!`,
          `Your previous link expired. Here's a fresh one.\n\n<a href="${link}" style="background:#4EA8D6;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;margin:8px 0">Sign in to ShiftHub →</a>\n\nThis link expires in 6 hours.`),
      })
    } catch(e) { console.error('Resend invite email:', e.message) }
  }

  return { ok: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function parseShiftTime(t) {
  if (!t) return -1
  const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return -1
  let h = parseInt(m[1])
  const mins   = parseInt(m[2])
  const period = m[3].toUpperCase()
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return h * 60 + mins
}

function fmtTime(t) {
  // HH:MM → "2:00 PM"
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${period}`
}

function buildReminderBody(user, shift, type) {
  const name    = user.firstName || 'there'
  const session = shift.title || 'your session'
  const addr    = shift.address ? `\n  📍 ${shift.address}` : ''
  const note    = shift.note    ? `\n  📝 ${shift.note}`    : ''
  if (type === '24h') {
    return `Hi ${name},\n\nReminder: you have a shift TOMORROW.\n\n  📅 ${shift.date}\n  🕐 ${shift.start} – ${shift.end}\n  📚 ${session}${addr}${note}\n\nhttps://yrshifts.web.app/app`
  }
  return `Hi ${name},\n\nYour shift starts in about 2 hours.\n\n  🕐 ${shift.start} – ${shift.end}\n  📚 ${session}${addr}${note}\n\nhttps://yrshifts.web.app/app`
}

function buildSubject(n) {
  switch (n.type) {
    case 'shift_assigned':  return `📅 New shift on ${n.shiftDate}`
    case 'shift_confirmed': return `✅ ${n.actorName} confirmed their shift`
    case 'shift_rejected':  return `⚠️ ${n.actorName} rejected their shift`
    case 'shift_claimed':   return `⚡ ${n.actorName} claimed an open shift`
    default:                return 'ShiftHub notification'
  }
}

function buildBody(n) {
  switch (n.type) {
    case 'shift_assigned':
      return `Hi ${n.recipientName || 'there'},\n\nYou have a new shift:\n\n  📅 ${n.shiftDate}\n  🕐 ${n.shiftStart} – ${n.shiftEnd}\n  📚 ${n.shiftTitle || 'Shift'}\n\nPlease confirm or reject in the app.\n\nhttps://yrshifts.web.app/app`
    case 'shift_confirmed':
      return `${n.actorName} confirmed their shift on ${n.shiftDate} at ${n.shiftStart}.`
    case 'shift_rejected':
      return `${n.actorName} rejected their shift on ${n.shiftDate}.\n\nLog in to reassign:\nhttps://yrshifts.web.app/admin`
    case 'shift_claimed':
      return `${n.actorName} claimed the open shift on ${n.shiftDate} at ${n.shiftStart}.`
    default:
      return n.message || 'You have a new ShiftHub notification.'
  }
}

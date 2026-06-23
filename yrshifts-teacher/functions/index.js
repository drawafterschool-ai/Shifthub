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
// SHARED DELIVERY — FCM push + email + SMS
// ─────────────────────────────────────────────────────────────────────────────
async function deliver(user, subject, body, customLink) {
  const results = { push: false, email: false, sms: false }

  // FCM push
  if (user.fcmToken) {
    try {
      const defaultLink = ['owner', 'admin', 'manager'].includes(user.role)
        ? 'https://yrshifts.web.app/admin'
        : 'https://yrshifts.web.app/app'
      const link = customLink || defaultLink

      await admin.messaging().send({
        token: user.fcmToken,
        notification: { title: subject, body },
        data: { link: link },
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
  if (!notif?.recipientId) return

  // Admin-feed notifications use recipientId "admin". Fan out to all admin users.
  if (notif.recipientId === 'admin') {
    const admins = await db.collection('users').where('role', '==', 'admin').get()
    for (const adminDoc of admins.docs) {
      const adminUser = { id: adminDoc.id, ...adminDoc.data() }
      await deliver(adminUser, buildSubject(notif), buildBody(notif))
    }
    return
  }

  const snap = await db.collection('users').doc(notif.recipientId).get()
  if (!snap.exists) return
  const user = { id: notif.recipientId, ...snap.data() }

  // Prevent duplicate external alerts for shift assignments and edits.
  // Shift assignment and edit notifications for teachers are already delivered with detailed calendar (.ics) attachments via the onShiftChanged trigger.
  if (notif.type === 'shift_assigned') {
    console.log(`Skipping external delivery for shift_assigned notification ${event.params.notifId} to avoid duplication. (Handled by onShiftChanged)`)
    return
  }

  await deliver(user, buildSubject(notif), buildBody(notif))
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. SHIFT CHANGES — notify the affected teacher
//    Fires on any write to a shift doc. Sends email when:
//    - A shift is newly assigned to a teacher (instructorId set for first time)
//    - A shift is edited (key fields changed) and the teacher is assigned
//    - A shift is deleted (instructorId was set)
// ─────────────────────────────────────────────────────────────────────────────
exports.onShiftChanged = onDocumentWritten('shifts/{shiftId}', async (event) => {
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

  if (nowAssigned && nowAssigned !== wasAssigned) {
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    const subject = `New shift assigned — ${after.date}`
    const body    = `Hi ${user.firstName || 'there'},\n\nYou have a new shift:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nPlease confirm or reject in the app.\n\nhttps://yrshifts.web.app/app`
    await deliver(user, subject, body)
    return
  }

  // ── Edited (already assigned) ────────────────────────────────────────────
  if (wasAssigned && nowAssigned === wasAssigned) {
    const changed = ['date','start','end','title','address','note','students','attachments','job'].filter(
      f => JSON.stringify(before[f]) !== JSON.stringify(after[f])
    )
    if (!changed.length) return  // no meaningful change
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    
    const wasConfirmed = before?.confirmationStatus === 'confirmed'
    const timeOrDayChanged = before.date !== after.date || before.start !== after.start || before.end !== after.end

    let subject = `Shift updated — ${after.date}`
    let body    = `Hi ${user.firstName || 'there'},\n\nYour shift has been updated:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nChanged: ${changed.join(', ')}\n\nhttps://yrshifts.web.app/app`

    if (wasConfirmed) {
      if (timeOrDayChanged) {
        subject = `Important changes to confirmed shift — please confirm again`
        body    = `important changes to a shift you have already confirmed, please confirm again`
      } else {
        subject = `Shift details updated`
        body    = `details added`
      }
    }

    await deliver(user, subject, body)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. OPEN SHIFT POSTED — notify ALL teachers
//    Fires when a shift is created or updated to be claimable
// ─────────────────────────────────────────────────────────────────────────────
exports.onOpenShift = onDocumentWritten('shifts/{shiftId}', async (event) => {
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
exports.onEventCreated = onDocumentCreated('events/{eventId}', async (event) => {
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
exports.onBuzzPostCreated = onDocumentCreated('weekly_buzz/{postId}', async (event) => {
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
exports.sendDayBeforeReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Chicago' },
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
// 9. CREATE TEACHER ACCOUNT (callable)
// ─────────────────────────────────────────────────────────────────────────────
exports.createTeacherAccount = onCall({ enforceAppCheck: false, secrets: EMAIL_SECRETS }, async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in')
  const callerSnap = await db.collection('users').doc(callerUid).get()
  if (!callerSnap.exists || callerSnap.data().role !== 'admin') {
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

  // Generate custom password reset token that expires in 72 hours (to satisfy the 72-hour requirement)
  const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await db.collection('password_resets').doc(token).set({
    email: email.trim().toLowerCase(),
    token: token,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000), // 72 hours
    used: false
  });
  const appLink = `https://yrshifts.web.app/app?mode=resetPassword&token=${token}&email=${encodeURIComponent(email)}`;

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
        text:    `Hi ${displayFirst},\n\nYou've been added to ShiftHub by Young Rembrandts.\n\nClick the link below to set your password and start using the app:\n\n${appLink}\n\nThis link expires in 72 hours. After signing in, open the app at:\nhttps://yrshifts.web.app/app`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0F1117;color:#E8ECF4;padding:24px;margin:0">
          <div style="max-width:520px;margin:0 auto">
            <div style="background:#4EA8D6;color:white;border-radius:12px 12px 0 0;padding:20px 24px">
              <span style="font-size:24px">📅</span>
              <span style="font-size:18px;font-weight:700;margin-left:10px">ShiftHub</span>
            </div>
            <div style="background:#1C2030;border-radius:0 0 12px 12px;padding:24px">
              <p style="font-size:17px;font-weight:700;margin:0 0 12px;color:#E8ECF4">Welcome, ${displayFirst}! 👋</p>
              <p style="color:#8B92A8;font-size:14px;margin:0 0 20px">You've been added to ShiftHub by Young Rembrandts. Click the button below to set your password and access your schedule.</p>
              <a href="${appLink}" style="display:inline-block;background:#4EA8D6;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:20px">
                Set my password →
              </a>
              <p style="color:#5C6380;font-size:12px;margin:0">This link expires in 72 hours. If it doesn't work, copy and paste this into your browser:<br><span style="color:#4EA8D6;word-break:break-all">${appLink}</span></p>
            </div>
            <p style="color:#5C6380;font-size:11px;text-align:center;margin-top:16px">Young Rembrandts · ShiftHub</p>
          </div></body></html>`,
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

  return { uid, link: appLink }
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
  if (n.subject) return n.subject
  switch (n.type) {
    case 'shift_assigned':  return `📅 New shift on ${n.shiftDate}`
    case 'shift_confirmed': return `✅ ${n.actorName} confirmed their shift`
    case 'shift_rejected':  return `⚠️ ${n.actorName} rejected their shift`
    case 'shift_claimed':   return `⚡ ${n.actorName} claimed an open shift`
    default:                return 'ShiftHub notification'
  }
}

function buildBody(n) {
  if (n.message) return n.message
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

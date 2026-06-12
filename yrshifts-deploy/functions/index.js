'use strict'

const { onDocumentDeleted, onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onSchedule }         = require('firebase-functions/v2/scheduler')
const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https')
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

function generateTeacherICalFeed(shifts) {
  const parseDateTime = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return null
    try {
      const m = timeStr.match(/(\d+):(\d+)\s*(am|pm)?/i)
      if (!m) return null
      let h = parseInt(m[1])
      const min = parseInt(m[2])
      const period = (m[3] || '').toUpperCase()
      if (period === 'PM' && h !== 12) h += 12
      if (period === 'AM' && h === 12) h = 0
      let year, month, day
      if (dateStr.includes('-')) {
        ;[year, month, day] = dateStr.split('-').map(Number)
      } else if (dateStr.includes('/')) {
        ;[month, day, year] = dateStr.split('/').map(Number)
      } else { return null }
      return `${year}${String(month).padStart(2,'0')}${String(day).padStart(2,'0')}T${String(h).padStart(2,'0')}${String(min).padStart(2,'0')}00`
    } catch { return null }
  }

  const vevents = []
  for (const shift of shifts) {
    const dtStart = parseDateTime(shift.date, shift.start)
    const dtEnd   = parseDateTime(shift.date, shift.end)
    if (!dtStart || !dtEnd) continue

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

    const lines = [
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
      'END:VEVENT'
    ]
    vevents.push(...lines.filter(l => l !== ''))
  }

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShiftHub//YRShifts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...vevents,
    'END:VCALENDAR'
  ].join('\r\n')
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED DELIVERY — FCM push + email + SMS
// ─────────────────────────────────────────────────────────────────────────────
async function deliver(user, subject, body, icsContent, customLink) {
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
        webpush: {
          fcmOptions: {
            link: link
          }
        }
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
      const mailOptions = {
        from:    `"ShiftHub" <${process.env.SMTP_USER}>`,
        to:      user.email,
        subject,
        text:    body,
        html:    emailHtml(subject, body),
      }
      if (icsContent) {
        mailOptions.attachments = [{
          filename: 'invite.ics',
          content: icsContent,
          contentType: 'text/calendar; charset=utf-8; method=REQUEST',
        }]
      }
      await transport.sendMail(mailOptions)
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
    .split('\n').map(l => `<p style="margin:0 0 8px; line-height:1.7;">${l || '&nbsp;'}</p>`).join('')
  return `<!DOCTYPE html>
<html>
<body style="font-family:'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color:#0F1117; color:#E8ECF4; padding:32px 16px; margin:0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0F1117;">
    <tr>
      <td align="center">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:540px; background-color:#1C2030; border:1px solid #2A2F40; border-radius:16px; overflow:hidden;">
          
          <!-- Top Brand Gradient Bar -->
          <tr>
            <td height="6" style="background:linear-gradient(90deg, #FBBF24 0%, #4EA8D6 100%); line-height:6px; font-size:1px;">&nbsp;</td>
          </tr>
          
          <!-- Header -->
          <tr>
            <td style="background-color:#181B25; padding:24px 32px; border-bottom:1px solid #2A2F40;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <!-- Logo Icon -->
                  <td width="44" valign="middle">
                    <div style="width:34px; height:34px; background-color:rgba(78, 168, 214, 0.08); border:1px solid rgba(78, 168, 214, 0.2); border-radius:8px; text-align:center; line-height:34px; font-size:18px;">
                      🎨
                    </div>
                  </td>
                  <!-- Title -->
                  <td valign="middle">
                    <span style="font-size:18px; font-weight:800; letter-spacing:0.5px; color:#E8ECF4; display:block; line-height:1.2;">Young Rembrandts</span>
                    <span style="font-size:10px; font-weight:700; color:#4EA8D6; text-transform:uppercase; letter-spacing:1.5px; display:block; margin-top:2px; line-height:1;">ShiftHub</span>
                  </td>
                  <!-- Status Tag -->
                  <td align="right" valign="middle">
                    <span style="font-size:10px; font-weight:700; color:#FBBF24; background-color:rgba(251, 191, 36, 0.08); padding:4px 10px; border-radius:20px; border:1px solid rgba(251, 191, 36, 0.2); text-transform:uppercase; letter-spacing:1px; display:inline-block; line-height:1.2;">
                      Alert
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Body Content -->
          <tr>
            <td style="padding:36px 32px;">
              <h2 style="font-size:18px; font-weight:800; color:#E8ECF4; margin:0 0 18px 0; line-height:1.4;">
                ${subject}
              </h2>
              <div style="color:#8B92A8; font-size:14px; line-height:1.75;">
                ${lines}
              </div>
              
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" border="0" style="margin-top:32px;">
                <tr>
                  <td>
                    <a href="https://yrshifts.web.app/app" style="display:inline-block; background-color:#4EA8D6; color:#0F1117; font-weight:800; font-size:13px; text-decoration:none; padding:14px 28px; border-radius:8px; border-bottom:3px solid #2D9CDB; text-transform:uppercase; letter-spacing:1px; box-shadow:0 4px 14px rgba(78, 168, 214, 0.35);">
                      Open ShiftHub ⚡
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color:#181B25; padding:24px 32px; border-top:1px solid #2A2F40; text-align:center;">
              <p style="color:#5C6380; font-size:11px; margin:0; font-weight:500; letter-spacing:0.5px; line-height:1.4;">
                This is an automated notification from Young Rembrandts ShiftHub.
              </p>
              <p style="color:#4EA8D6; font-size:10px; margin:6px 0 0 0; font-weight:700; text-transform:uppercase; letter-spacing:1.5px; line-height:1.2;">
                Young Rembrandts Minnesota & Western Wisconsin
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
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
      .where('role', 'in', ['owner', 'admin', 'manager'])
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
    let teacherName = 'Unassigned'
    if (before?.instructorId) {
      const snap = await db.collection('users').doc(before.instructorId).get()
      if (snap.exists) {
        const user    = { id: before.instructorId, ...snap.data() }
        teacherName   = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Teacher'
        const subject = `Shift cancelled — ${before.title || 'Your shift'}`
        const body    = `Hi ${user.firstName || 'there'},\n\nYour shift has been cancelled:\n\n  📅 ${before.date}\n  🕐 ${before.start} – ${before.end}\n  📚 ${before.title || 'Shift'}\n\nPlease contact your admin if you have questions.\n\nhttps://yrshifts.web.app/app`
        await deliver(user, subject, body)
      }
    }
    // Notify admins of cancelled shift
    await db.collection('notifications').add({
      type:        'shift_cancelled',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   'System',
      shiftId:     event.params.shiftId,
      shiftDate:   before.date,
      shiftStart:  before.start,
      shiftTitle:  before.title || 'Shift',
      teacherName: teacherName,
      status:      'unread',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
    return
  }

  const wasAssigned  = before?.instructorId
  const nowAssigned  = after.instructorId

  // ── 1. Open Shift Claimed ────────────────────────────────────────────────
  const becameClaimed = before?.claimable && !after.claimable && nowAssigned && !wasAssigned
  if (becameClaimed) {
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (snap.exists) {
      const user = { id: nowAssigned, ...snap.data() }
      const teacherName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'A teacher'
      
      // Create admin notification doc
      await db.collection('notifications').add({
        type:        'shift_claimed',
        forAdmin:    true,
        recipientId: 'admin',
        actorName:   teacherName,
        shiftId:     event.params.shiftId,
        shiftDate:   after.date,
        shiftStart:  after.start,
        shiftTitle:  after.title || 'Shift',
        status:      'unread',
        createdAt:   admin.firestore.FieldValue.serverTimestamp(),
      })

      // Deliver confirmation email with calendar attachment to the teacher
      const subject = `New shift assigned — ${after.date}`
      const body    = `Hi ${user.firstName || 'there'},\n\nYou have successfully claimed a new shift:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nThe calendar invite is attached — tap it to add to your calendar.\n\nhttps://yrshifts.web.app/app`
      const ics = generateICS({ ...after, id: event.params.shiftId })
      await deliver(user, subject, body, ics)
    }
    return
  }

  // ── 2. Shift Confirmed or Rejected ───────────────────────────────────────
  const statusChanged = nowAssigned && before?.confirmationStatus !== after.confirmationStatus
  if (statusChanged && (after.confirmationStatus === 'confirmed' || after.confirmationStatus === 'rejected')) {
    const snap = await db.collection('users').doc(nowAssigned).get()
    const teacherName = snap.exists ? `${snap.data().firstName || ''} ${snap.data().lastName || ''}`.trim() : 'A teacher'

    await db.collection('notifications').add({
      type:        after.confirmationStatus === 'confirmed' ? 'shift_confirmed' : 'shift_rejected',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   teacherName,
      shiftId:     event.params.shiftId,
      shiftDate:   after.date,
      shiftStart:  after.start,
      shiftTitle:  after.title || 'Shift',
      status:      'unread',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
    return
  }

  // ── 3. Newly Assigned (Direct assignment, not open claim) ─────────────────
  if (!wasAssigned && nowAssigned) {
    if (after.claimable) return   // open/unassigned — handled separately
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    const teacherName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Teacher'
    const subject = `New shift assigned — ${after.date}`
    const body    = `Hi ${user.firstName || 'there'},\n\nYou have a new shift:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nThe calendar invite is attached — tap it to add to your calendar.\n\nhttps://yrshifts.web.app/app`
    const ics = generateICS({ ...after, id: event.params.shiftId })
    console.log('ICS generated:', ics ? 'YES ('+ics.length+' chars)' : 'FAILED - null returned')
    console.log('Shift data for ICS:', JSON.stringify({ date: after.date, start: after.start, end: after.end, title: after.title }))
    await deliver(user, subject, body, ics)

    // Notify admins of directly assigned shift
    await db.collection('notifications').add({
      type:        'shift_assigned_admin',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   'System',
      shiftId:     event.params.shiftId,
      shiftDate:   after.date,
      shiftStart:  after.start,
      shiftTitle:  after.title || 'Shift',
      teacherName: teacherName,
      status:      'unread',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
    return
  }

  // ── 4. Edited (Already assigned) ─────────────────────────────────────────
  if (wasAssigned && nowAssigned === wasAssigned) {
    const changed = ['date','start','end','title','address','note','students','attachments'].filter(
      f => JSON.stringify(before[f]) !== JSON.stringify(after[f])
    )
    if (!changed.length) return
    const snap = await db.collection('users').doc(nowAssigned).get()
    if (!snap.exists) return
    const user    = { id: nowAssigned, ...snap.data() }
    const teacherName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Teacher'
    
    const wasConfirmed = before?.confirmationStatus === 'confirmed'
    const timeOrDayChanged = before.date !== after.date || before.start !== after.start || before.end !== after.end

    let subject = `Shift updated — ${after.date}`
    let body    = `Hi ${user.firstName || 'there'},\n\nYour shift has been updated:\n\n  📅 ${after.date}\n  🕐 ${after.start} – ${after.end}\n  📚 ${after.title || 'Shift'}${after.address ? `\n  📍 ${after.address}` : ''}${after.note ? `\n  📝 ${after.note}` : ''}\n\nChanged: ${changed.join(', ')}\n\nUpdated calendar invite attached.\n\nhttps://yrshifts.web.app/app`

    if (wasConfirmed) {
      if (timeOrDayChanged) {
        subject = `Important changes to confirmed shift — please confirm again`
        body    = `important changes to a shift you have already confirmed, please confirm again`
      } else {
        subject = `Shift details updated`
        body    = `details added`
      }
    }

    const ics = generateICS({ ...after, id: event.params.shiftId })
    await deliver(user, subject, body, ics)

    // Notify admins of shift update
    await db.collection('notifications').add({
      type:        'shift_updated',
      forAdmin:    true,
      recipientId: 'admin',
      actorName:   'System',
      shiftId:     event.params.shiftId,
      shiftDate:   after.date,
      shiftStart:  after.start,
      shiftTitle:  after.title || 'Shift',
      teacherName: teacherName,
      status:      'unread',
      createdAt:   admin.firestore.FieldValue.serverTimestamp(),
    })
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

  await Promise.all(teachers.map(teacher => deliver(teacher, subject, body)))
  console.log(`Open shift notification sent to ${teachers.length} teachers`)

  // Notify admins of new open shift posted
  await db.collection('notifications').add({
    type:        'open_shift_posted',
    forAdmin:    true,
    recipientId: 'admin',
    actorName:   'System',
    shiftId:     event.params.shiftId,
    shiftDate:   after.date,
    shiftStart:  after.start,
    shiftTitle:  after.title || 'Open Shift',
    status:      'unread',
    createdAt:   admin.firestore.FieldValue.serverTimestamp(),
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. NEW EVENT — notify ALL users (teachers + admins/owners/managers)
// ─────────────────────────────────────────────────────────────────────────────
exports.onEventCreated = onDocumentCreated({ document: 'events/{eventId}', secrets: EMAIL_SECRETS }, async (event) => {
  const e = event.data?.data()
  if (!e) return

  const userSnap = await db.collection('users').get()
  const users = userSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  
  const timeStr  = e.time ? ` at ${fmtTime(e.time)}` : ''
  const subject  = `📆 New event — ${e.title}`
  const body     = `Hi,\n\nA new event has been scheduled:\n\n  📌 ${e.title}\n  📅 ${e.date}${timeStr}${e.location ? `\n  📍 ${e.location}` : ''}${e.notes ? `\n  📝 ${e.notes}` : ''}\n\nOpen ShiftHub to RSVP.\n\nhttps://yrshifts.web.app/app`

  await Promise.all(users.map(user => deliver(user, subject, body)))
  console.log(`Event notification sent to ${users.length} users`)
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. NEW WEEKLY BUZZ POST — notify ALL teachers
// ─────────────────────────────────────────────────────────────────────────────
exports.onBuzzPostCreated = onDocumentCreated({ document: 'weekly_buzz/{postId}', secrets: EMAIL_SECRETS }, async (event) => {
  const post = event.data?.data()
  if (!post) return

  const teachers = await getAllTeachers()
  // Strip HTML tags for email plain-text preview safely (preserving block borders as spaces)
  const preview = (post.content || '')
    .replace(/<\/p>|<\/div>|<\/h[1-6]>|<\/li>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
  const subject  = `📢 New post — ${post.title}`
  const body     = `Hi,\n\n${post.authorName || 'Admin'} posted a new update:\n\n"${post.title}"\n\n${preview}${preview.length === 200 ? '…' : ''}\n\nOpen ShiftHub to read the full post.\n\nhttps://yrshifts.web.app/app`

  await Promise.all(teachers.map(teacher => deliver(teacher, subject, body)))
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
      const customLink = ['owner', 'admin', 'manager'].includes(user.role)
        ? `https://yrshifts.web.app/admin/chat?chatId=${chatId}`
        : `https://yrshifts.web.app/app?tab=chat&chatId=${chatId}`
      const body = `${msg.authorName || 'Someone'}: ${msg.text || '📎 Attachment'}\n\n${customLink}`
      await deliver(user, subject, body, null, customLink)
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
      const shiftId = shift.id || shiftDoc.id
      const reminderRef = db.collection('reminders').doc(`${shiftId}-24h`)
      if ((await reminderRef.get()).exists) continue
      const uSnap = await db.collection('users').doc(shift.instructorId).get()
      if (!uSnap.exists) continue
      const user = { id: shift.instructorId, ...uSnap.data() }
      await deliver(user,
        `⏰ Reminder: shift tomorrow — ${shift.title || 'Your shift'}`,
        buildReminderBody(user, shift, '24h'),
      )
      await reminderRef.set({
        shiftId: shiftId, instructorId: shift.instructorId,
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
      const shiftId = shift.id || shiftDoc.id
      const reminderRef = db.collection('reminders').doc(`${shiftId}-2h`)
      if ((await reminderRef.get()).exists) continue
      const uSnap = await db.collection('users').doc(shift.instructorId).get()
      if (!uSnap.exists) continue
      const user = { id: shift.instructorId, ...uSnap.data() }
      await deliver(user,
        `⏰ Starting in 2 hours — ${shift.title || 'Your shift'}`,
        buildReminderBody(user, shift, '2h'),
      )
      await reminderRef.set({
        shiftId: shiftId, instructorId: shift.instructorId,
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

    // Find all owners, admins, and managers to notify
    const ownersSnap = await db.collection('users').where('role', 'in', ['owner', 'admin', 'manager']).get()
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
        subject: `🎨 Welcome to ShiftHub! Your new schedule and team app`,
        text:    `Hi ${displayFirst},\n\nWelcome to the team! We are excited to invite you to ShiftHub, our brand new custom-built application by Young Rembrandts.\n\nShiftHub is where you will manage your teaching schedule, coordinate shifts, direct-message colleagues, and receive real-time updates.\n\n⚡ Step 1: Set Up Your Account\nClick your personal invitation link below to set your password, verify your email, and sign in for the first time:\n\n👉 ${appLink}\n\n(Note: For security, this link will expire in 72 hours.)\n\n---\n\n📱 Step 2: Install the App on Your Phone (Highly Recommended!)\nShiftHub is a Progressive Web App (PWA), meaning you can install it directly onto your phone’s home screen as a standalone app without needing to go to the App Store or Google Play Store.\n\nOnce you have opened the link above on your mobile phone, follow these quick steps:\n\n* iPhone & iPad (Safari):\n  1. Tap the Share button 📤 (the square icon with an up arrow at the bottom of Safari).\n  2. Scroll down the menu and select ➕ "Add to Home Screen".\n  3. Tap Add in the top right. ShiftHub will now appear on your phone's home screen!\n* Android (Chrome):\n  1. Tap the Menu icon ⋮ (three vertical dots in the top right of Chrome).\n  2. Select 📲 "Install app" / "Add to Home Screen".\n\n---\n\n🔔 Step 3: Enable Lock-Screen Notifications\nTo make sure you never miss a schedule update, open shift alert, or chat message from the team:\n\n1. Open ShiftHub from your home screen.\n2. Sign in with your email and the password you created.\n3. Tap the "Enable Notifications" prompt when it appears, or go to your "Profile" tab in the app and toggle "Push Notifications" ON.\n4. *Now, tapping any lock-screen alert will automatically launch the app and open the message or shift details instantly!*\n\n---\n\nIf you have any questions or run into any trouble during setup, please reply directly to this email or reach out to us.\n\nWe are thrilled to have you with us!\n\nBest,\nGiordano Fontana\nYoung Rembrandts`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0F1117;color:#E8ECF4;padding:24px;margin:0">
          <div style="max-width:520px;margin:0 auto">
            <div style="background:#4EA8D6;color:white;border-radius:12px 12px 0 0;padding:20px 24px">
              <span style="font-size:24px">🎨</span>
              <span style="font-size:18px;font-weight:700;margin-left:10px">ShiftHub</span>
            </div>
            <div style="background:#1C2030;border-radius:0 0 12px 12px;padding:24px;border-bottom:1px solid #2A2F40;">
              <p style="font-size:17px;font-weight:700;margin:0 0 12px;color:#E8ECF4">Hi ${displayFirst},</p>
              <p style="color:#8B92A8;font-size:14px;line-height:1.6;margin:0 0 16px">Welcome to the team! We are excited to invite you to <strong>ShiftHub</strong>, our brand new custom-built application by Young Rembrandts.<br/><br/>ShiftHub is where you will manage your teaching schedule, coordinate shifts, direct-message colleagues, and receive real-time updates.</p>
              <p style="font-size:14px;font-weight:700;color:#E8ECF4;margin:24px 0 12px">⚡ Step 1: Set Up Your Account</p>
              <p style="color:#8B92A8;font-size:14px;margin:0 0 20px">Click the button below to set your password, verify your email, and sign in for the first time:</p>
              <a href="${appLink}" style="display:inline-block;background:#4EA8D6;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:20px">
                Set my password →
              </a>
              <p style="color:#5C6380;font-size:12px;margin:0">This link expires in 72 hours. If it doesn't work, copy and paste this into your browser:<br><span style="color:#4EA8D6;word-break:break-all">${appLink}</span></p>
            </div>
            <div style="background:#181B25;padding:24px;border-bottom:1px solid #2A2F40;color:#E8ECF4;">
              <h3 style="font-size:14px;font-weight:800;color:#4EA8D6;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px 0;">
                📱 Step 2: Install the App on Your Phone (Highly Recommended!)
              </h3>
              <p style="color:#8B92A8;font-size:13px;line-height:1.6;margin:0 0 16px 0;">
                ShiftHub is a Progressive Web App (PWA), meaning you can install it directly onto your phone’s home screen as a standalone app without needing to go to the App Store or Google Play Store. Once you have opened the link above on your mobile phone, follow these quick steps:
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;line-height:1.6;color:#8B92A8;">
                <tr>
                  <td valign="top" width="20" style="padding-bottom:12px;font-weight:bold;color:#4EA8D6;">•</td>
                  <td style="padding-bottom:12px;">
                    <strong style="color:#E8ECF4;">iPhone & iPad (Safari):</strong><br/>
                    1. Tap the <strong style="color:#E8ECF4;">Share 📤</strong> button at the bottom of Safari.<br/>
                    2. Scroll down and select <strong style="color:#4EA8D6;">"Add to Home Screen"</strong>.<br/>
                    3. Tap <strong style="color:#E8ECF4;">Add</strong> in the top right.
                  </td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:12px;font-weight:bold;color:#4EA8D6;">•</td>
                  <td style="padding-bottom:12px;">
                    <strong style="color:#E8ECF4;">Android (Chrome):</strong><br/>
                    1. Tap the <strong style="color:#E8ECF4;">Menu ⋮</strong> icon in Chrome.<br/>
                    2. Select <strong style="color:#4EA8D6;">"Install app"</strong> or <strong style="color:#4EA8D6;">"Add to Home Screen"</strong>.
                  </td>
                </tr>
              </table>
            </div>
            <div style="background:#1C2030;padding:24px;border-bottom:1px solid #2A2F40;color:#E8ECF4;border-radius:0 0 12px 12px;">
              <h3 style="font-size:14px;font-weight:800;color:#4EA8D6;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px 0;">
                🔔 Step 3: Enable Lock-Screen Notifications
              </h3>
              <p style="color:#8B92A8;font-size:13px;line-height:1.6;margin:0 0 16px 0;">
                To make sure you never miss a schedule update, open shift alert, or chat message from the team:
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;line-height:1.6;color:#8B92A8;">
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">1.</td>
                  <td style="padding-bottom:8px;">Open ShiftHub from your home screen.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">2.</td>
                  <td style="padding-bottom:8px;">Sign in with your email and the password you created.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">3.</td>
                  <td style="padding-bottom:8px;">Tap the <strong style="color:#4EA8D6;">"Enable Notifications"</strong> prompt when it appears, or go to your Profile tab in the app and toggle Push Notifications ON.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">4.</td>
                  <td style="padding-bottom:8px;"><em>Now, tapping any lock-screen alert will automatically launch the app and open the message or shift details instantly!</em></td>
                </tr>
              </table>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2A2F40;color:#8B92A8;font-size:13px;line-height:1.6;">
                If you have any questions or run into any trouble during setup, please reply directly to this email or reach out to us.<br/><br/>
                We are thrilled to have you with us!<br/><br/>
                Best,<br/>
                <strong>Giordano Fontana</strong><br/>
                <span style="color:#4EA8D6;">Young Rembrandts</span>
              </div>
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
        subject: `🎨 Welcome to ShiftHub! Your new schedule and team app`,
        text:    `Hi ${firstName},\n\nWelcome to the team! We are excited to invite you to ShiftHub, our brand new custom-built application by Young Rembrandts.\n\nShiftHub is where you will manage your teaching schedule, coordinate shifts, direct-message colleagues, and receive real-time updates.\n\n⚡ Step 1: Set Up Your Account\nClick your personal invitation link below to set your password, verify your email, and sign in for the first time:\n\n👉 ${appLink}\n\n(Note: For security, this link will expire in 72 hours.)\n\n---\n\n📱 Step 2: Install the App on Your Phone (Highly Recommended!)\nShiftHub is a Progressive Web App (PWA), meaning you can install it directly onto your phone’s home screen as a standalone app without needing to go to the App Store or Google Play Store.\n\nOnce you have opened the link above on your mobile phone, follow these quick steps:\n\n* iPhone & iPad (Safari):\n  1. Tap the Share button 📤 (the square icon with an up arrow at the bottom of Safari).\n  2. Scroll down the menu and select ➕ "Add to Home Screen".\n  3. Tap Add in the top right. ShiftHub will now appear on your phone's home screen!\n* Android (Chrome):\n  1. Tap the Menu icon ⋮ (three vertical dots in the top right of Chrome).\n  2. Select 📲 "Install app" / "Add to Home Screen".\n\n---\n\n🔔 Step 3: Enable Lock-Screen Notifications\nTo make sure you never miss a schedule update, open shift alert, or chat message from the team:\n\n1. Open ShiftHub from your home screen.\n2. Sign in with your email and the password you created.\n3. Tap the "Enable Notifications" prompt when it appears, or go to your "Profile" tab in the app and toggle "Push Notifications" ON.\n4. *Now, tapping any lock-screen alert will automatically launch the app and open the message or shift details instantly!*\n\n---\n\nIf you have any questions or run into any trouble during setup, please reply directly to this email or reach out to us.\n\nWe are thrilled to have you with us!\n\nBest,\nGiordano Fontana\nYoung Rembrandts`,
        html: `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#0F1117;color:#E8ECF4;padding:24px;margin:0">
          <div style="max-width:520px;margin:0 auto">
            <div style="background:#4EA8D6;color:white;border-radius:12px 12px 0 0;padding:20px 24px">
              <span style="font-size:24px">🎨</span>
              <span style="font-size:18px;font-weight:700;margin-left:10px">ShiftHub</span>
            </div>
            <div style="background:#1C2030;border-radius:0 0 12px 12px;padding:24px;border-bottom:1px solid #2A2F40;">
              <p style="font-size:17px;font-weight:700;margin:0 0 12px;color:#E8ECF4">Hi ${firstName},</p>
              <p style="color:#8B92A8;font-size:14px;line-height:1.6;margin:0 0 16px">Welcome to the team! We are excited to invite you to <strong>ShiftHub</strong>, our brand new custom-built application by Young Rembrandts.<br/><br/>ShiftHub is where you will manage your teaching schedule, coordinate shifts, direct-message colleagues, and receive real-time updates.</p>
              <p style="font-size:14px;font-weight:700;color:#E8ECF4;margin:24px 0 12px">⚡ Step 1: Set Up Your Account</p>
              <p style="color:#8B92A8;font-size:14px;margin:0 0 20px">Click the button below to set your password, verify your email, and sign in for the first time:</p>
              <a href="${appLink}" style="display:inline-block;background:#4EA8D6;color:white;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;margin-bottom:20px">
                Set my password →
              </a>
              <p style="color:#5C6380;font-size:12px;margin:0">This link expires in 72 hours. If it doesn't work, copy and paste this into your browser:<br><span style="color:#4EA8D6;word-break:break-all">${appLink}</span></p>
            </div>
            <div style="background:#181B25;padding:24px;border-bottom:1px solid #2A2F40;color:#E8ECF4;">
              <h3 style="font-size:14px;font-weight:800;color:#4EA8D6;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px 0;">
                📱 Step 2: Install the App on Your Phone (Highly Recommended!)
              </h3>
              <p style="color:#8B92A8;font-size:13px;line-height:1.6;margin:0 0 16px 0;">
                ShiftHub is a Progressive Web App (PWA), meaning you can install it directly onto your phone’s home screen as a standalone app without needing to go to the App Store or Google Play Store. Once you have opened the link above on your mobile phone, follow these quick steps:
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;line-height:1.6;color:#8B92A8;">
                <tr>
                  <td valign="top" width="20" style="padding-bottom:12px;font-weight:bold;color:#4EA8D6;">•</td>
                  <td style="padding-bottom:12px;">
                    <strong style="color:#E8ECF4;">iPhone & iPad (Safari):</strong><br/>
                    1. Tap the <strong style="color:#E8ECF4;">Share 📤</strong> button at the bottom of Safari.<br/>
                    2. Scroll down and select <strong style="color:#4EA8D6;">"Add to Home Screen"</strong>.<br/>
                    3. Tap <strong style="color:#E8ECF4;">Add</strong> in the top right.
                  </td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:12px;font-weight:bold;color:#4EA8D6;">•</td>
                  <td style="padding-bottom:12px;">
                    <strong style="color:#E8ECF4;">Android (Chrome):</strong><br/>
                    1. Tap the <strong style="color:#E8ECF4;">Menu ⋮</strong> icon in Chrome.<br/>
                    2. Select <strong style="color:#4EA8D6;">"Install app"</strong> or <strong style="color:#4EA8D6;">"Add to Home Screen"</strong>.
                  </td>
                </tr>
              </table>
            </div>
            <div style="background:#1C2030;padding:24px;border-bottom:1px solid #2A2F40;color:#E8ECF4;border-radius:0 0 12px 12px;">
              <h3 style="font-size:14px;font-weight:800;color:#4EA8D6;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px 0;">
                🔔 Step 3: Enable Lock-Screen Notifications
              </h3>
              <p style="color:#8B92A8;font-size:13px;line-height:1.6;margin:0 0 16px 0;">
                To make sure you never miss a schedule update, open shift alert, or chat message from the team:
              </p>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;line-height:1.6;color:#8B92A8;">
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">1.</td>
                  <td style="padding-bottom:8px;">Open ShiftHub from your home screen.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">2.</td>
                  <td style="padding-bottom:8px;">Sign in with your email and the password you created.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">3.</td>
                  <td style="padding-bottom:8px;">Tap the <strong style="color:#4EA8D6;">"Enable Notifications"</strong> prompt when it appears, or go to your Profile tab in the app and toggle Push Notifications ON.</td>
                </tr>
                <tr>
                  <td valign="top" width="20" style="padding-bottom:8px;font-weight:bold;color:#4EA8D6;">4.</td>
                  <td style="padding-bottom:8px;"><em>Now, tapping any lock-screen alert will automatically launch the app and open the message or shift details instantly!</em></td>
                </tr>
              </table>
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #2A2F40;color:#8B92A8;font-size:13px;line-height:1.6;">
                If you have any questions or run into any trouble during setup, please reply directly to this email or reach out to us.<br/><br/>
                We are thrilled to have you with us!<br/><br/>
                Best,<br/>
                <strong>Giordano Fontana</strong><br/>
                <span style="color:#4EA8D6;">Young Rembrandts</span>
              </div>
            </div>
            <p style="color:#5C6380;font-size:11px;text-align:center;margin-top:16px">Young Rembrandts · ShiftHub</p>
          </div></body></html>`,
      })
    } catch(e) { console.error('Resend invite email:', e.message) }
  }

  return { ok: true }
})


// ─────────────────────────────────────────────────────────────────────────────
// 12. VERIFY RESET TOKEN — callable, verifies custom 72-hour reset token
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyResetToken = onCall({ enforceAppCheck: false }, async (request) => {
  const { token } = request.data || {}
  if (!token) return { valid: false }

  const snap = await db.collection('password_resets').doc(token).get()
  if (!snap.exists) return { valid: false }

  const data = snap.data()
  if (data.used) return { valid: false }

  const expiresAt = data.expiresAt.toDate()
  if (expiresAt.getTime() < Date.now()) return { valid: false }

  return { valid: true, email: data.email }
})

// ─────────────────────────────────────────────────────────────────────────────
// 13. COMPLETE RESET PASSWORD — callable, completes password set via custom token
// ─────────────────────────────────────────────────────────────────────────────
exports.completeResetPassword = onCall({ enforceAppCheck: false }, async (request) => {
  const { token, newPassword } = request.data || {}
  if (!token || !newPassword) {
    throw new HttpsError('invalid-argument', 'Missing token or password')
  }

  const snap = await db.collection('password_resets').doc(token).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Token not found')

  const data = snap.data()
  if (data.used) throw new HttpsError('failed-precondition', 'Token already used')

  const expiresAt = data.expiresAt.toDate()
  if (expiresAt.getTime() < Date.now()) {
    throw new HttpsError('failed-precondition', 'Token expired')
  }

  // Find user in auth
  const user = await admin.auth().getUserByEmail(data.email)
  
  // Update password & verify email
  await admin.auth().updateUser(user.uid, { password: newPassword, emailVerified: true })

  // Mark token used
  await db.collection('password_resets').doc(token).update({ used: true })

  return { success: true, email: data.email }
})

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function parseShiftTime(t) {
  if (!t) return -1
  const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)?/i)
  if (!m) return -1
  let h = parseInt(m[1])
  const mins   = parseInt(m[2])
  const period = (m[3] || '').toUpperCase()
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
    case 'shift_assigned_admin': return `📅 Shift assigned — ${n.shiftDate}`
    case 'shift_cancelled': return `❌ Shift cancelled — ${n.shiftDate}`
    case 'shift_updated':   return `🔄 Shift updated — ${n.shiftDate}`
    case 'open_shift_posted': return `⚡ Open shift posted — ${n.shiftDate}`
    case 'first_login':     return `🎉 ${n.actorName} logged in for the first time`
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
    case 'shift_assigned_admin':
      return `Shift assigned to ${n.teacherName} on ${n.shiftDate} at ${n.shiftStart}.\n\nhttps://yrshifts.web.app/admin`
    case 'shift_cancelled':
      return `Shift on ${n.shiftDate} at ${n.shiftStart} for ${n.teacherName} has been cancelled.`
    case 'shift_updated':
      return `Shift on ${n.shiftDate} at ${n.shiftStart} for ${n.teacherName} has been updated.\n\nhttps://yrshifts.web.app/admin`
    case 'open_shift_posted':
      return `An open shift was posted for ${n.shiftDate} at ${n.shiftStart}.\n\nhttps://yrshifts.web.app/admin`
    case 'first_login':
      return `${n.actorName} logged in for the first time to ShiftHub.\n\nView directory:\nhttps://yrshifts.web.app/admin/directory`
    default:
      return n.message || 'You have a new ShiftHub notification.'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. TEACHER CALENDAR FEED (onRequest)
// ─────────────────────────────────────────────────────────────────────────────
exports.teacherCalendarFeed = onRequest(async (req, res) => {
  try {
    let teacherId = req.query.teacherId
    if (!teacherId && req.path) {
      const filename = req.path.split('/').pop()
      if (filename) {
        teacherId = filename.replace(/\.ics$/i, '')
      }
    }

    if (!teacherId) {
      res.status(400).send('Teacher ID required.')
      return
    }

    // Verify user exists in Firestore
    const userSnap = await db.collection('users').doc(teacherId).get()
    if (!userSnap.exists) {
      res.status(404).send('Teacher profile not found.')
      return
    }

    // Query all active, non-cancelled shifts for this instructor
    const shiftsSnap = await db.collection('shifts')
      .where('instructorId', '==', teacherId)
      .get()

    const shifts = []
    shiftsSnap.forEach(doc => {
      const s = doc.data()
      // Filter active (status === 'published' or equivalent) and not rejected/cancelled shifts
      if (s.status === 'published' && s.confirmationStatus !== 'rejected') {
        shifts.push({ id: doc.id, ...s })
      }
    })

    const icsContent = generateTeacherICalFeed(shifts)

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${teacherId}.ics"`)
    res.status(200).send(icsContent)
  } catch (error) {
    console.error('Error serving iCal feed:', error)
    res.status(500).send('Internal Server Error')
  }
})


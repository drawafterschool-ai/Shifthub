# ShiftHub / YRShifts — Project Summary for Gemini

## Project Overview
A full-stack scheduling app for Young Rembrandts built with React 19 + Vite + Firebase (Firestore, Storage, Auth, Cloud Functions v2). Two separate apps deployed to yrshifts.web.app:
- **Admin app** → `/admin` (yrshifts-admin/)
- **Teacher app** → `/app` (yrshifts-teacher/)
- **Deploy folder** → yrshifts-deploy/ (functions + hosting)

## Tech Stack
- React 19, Vite, Tailwind CSS v3, Zustand v5, React Router v6 (admin)
- Firebase: Firestore, Storage, Auth, Cloud Functions v2, FCM push
- Node 22, Nodemailer (Gmail SMTP port 465 SSL), Twilio (optional SMS)
- Firebase project: `yrshifts`

## Deployment
```bash
cd ~/yrshifts-deploy
bash deploy-all.sh          # builds both apps + deploys everything
firebase deploy --only hosting   # hosting only
firebase deploy --only functions # functions only
```

## Firebase Secrets (set via CLI)
- `SMTP_USER` = admin Gmail address
- `SMTP_PASS` = Gmail App Password (16 chars, no spaces)
- VAPID key baked into teacher .env as `VITE_FIREBASE_VAPID_KEY`

---

## Admin App — Key Views
- **Schedule** — week/month grid, drag-and-drop shifts, color-coded by job type from Settings
- **ShiftPanel** — shift details, repeat dates (series via seriesId), attachments
- **Directory** — teacher management, invite flow with email
- **Chat** — two-pane, reactions, replies, read receipts
- **Knowledge Base** — drag-and-drop reorder, folder tree
- **Weekly Buzz** — rich text editor (B/I/U, alignment, text color, emoji, links), save draft / publish
- **Events** — RSVP tracking (going/maybe/no), remind unseen teachers
- **Notifications** — tabbed, stat cards
- **Settings** — session types/job colors, payroll tiers, CSV importer, danger zone

### Admin Mobile View
- Screens < 768px show a mobile bottom tab bar (MobileLayout.jsx)
- Tabs: Schedule (day view), Chat, Resources, Notifications, Profile
- MobileDayView.jsx — day navigator with shift list

---

## Teacher App — 7 Tabs
1. 📅 **Schedule** — upcoming/past shifts, confirm/reject/release with note modal
2. ⚡ **Open** — claimable shifts
3. 💬 **Chat** — DM + group, reactions, reply, unread badges
4. 📢 **Updates** — Weekly Buzz with likes + comments
5. 🗓️ **Events** — RSVP (going/maybe/can't)
6. 📚 **Resources** — read-only KB browser
7. 👤 **Profile** — photo, name, phone, email, password

---

## Key Files Changed / Created

### Auth Flow (teacher)
- `src/stores/useAuthStore.js` — polls for profile doc (handles first-login race), keeps auth listener alive permanently, no async in callbacks (Safari-safe)
- `src/views/LoginView.jsx` — detects oobCode from invite link, confirms password reset, auto signs in
- `src/utils/firebase.js` — no deprecated enableIndexedDbPersistence

### Layout / iOS Safari Issue
- `src/index.css` — uses `@supports (-webkit-touch-callout: none)` block for Safari-only CSS
- `src/safari.css` — NEW file, imported after index.css, Safari-only layout fixes
- `src/main.jsx` — imports safari.css after index.css
- Tab bar positioning has been extensively worked on — Gemini's approach (clean flex layout + `@supports` block) was most stable for Chrome; Safari gap below toolbar remains a known issue

### Cloud Functions (yrshifts-deploy/functions/index.js)
- **9 functions** total
- **Critical**: Every function that sends email must declare `secrets: ['SMTP_USER', 'SMTP_PASS']`
- Gmail SMTP: port 465, secure: true, strips spaces from app password
- `createTeacherAccount` — extracts oobCode from reset link, builds direct app URL, sends branded HTML email
- Triggers: shift assigned/edited/deleted, open shift posted, new event, new buzz post, 24h/2h reminders

### Shift Colors (Admin)
- Job colors come from `settings/company.jobs` in Firestore
- Default jobs: Teach (#4ade80), Workshop (#7dd3fc), Assist (#f9a8d4), Sub (#fca5a5), Cancelled (#9ca3af)
- Unassigned row chips: white (#e2e8f0)
- Colors applied as RGBA tints via hexToRgba() helper

### Series Dates (Admin ShiftPanel)
- When reopening a repeating shift, loads all sibling dates from `rawShifts` via `seriesId`
- ShiftChip shows date range: "4/15–5/13"

### Chat Unread Badges
- `useChatStore.init()` now subscribes to messages for ALL chats immediately (not just active chat)
- Fixes badge count showing 0 until chat is opened

### Teacher Shift Actions
- Confirm, Reject (keeps instructorId, sets confirmationStatus: 'rejected')
- Release shift = same as reject (keeps instructorId for admin visibility)
- Both Reject and Release require a note via NoteModal
- ShiftCard detail modal: scrollable content, action buttons pinned at bottom

### Push Notifications
- Service worker: `public/firebase-messaging-sw.js`
- iOS Safari: shows install instructions (Add to Home Screen required)
- `pushSupported` check prevents crash on browsers without Notification API

---

## Known Issues / Notes
- **iOS toolbar gap**: Safari shows black gap below tab bar in browser mode. Worked on extensively. Gemini's `@supports` approach + `safari.css` file is current best attempt.
- **First login**: Profile doc created async by Cloud Function — auth store polls up to 12 attempts before showing error
- **Sign out**: Auth listener must NOT be cancelled on sign out — only profile listener gets cancelled
- **Export CSV**: ExportModal was missing from JSX render — fixed. calcHours must be imported in ScheduleView.
- **Firestore indexes**: NOT deployed (causes 400 error on weekly_buzz). All 8 indexes are live manually.

---

## Deploy Checklist
1. Copy changed files to correct folders
2. `npm run build` in changed app folder(s)
3. `bash deploy-all.sh` from yrshifts-deploy/
4. For functions only: `firebase deploy --only functions`
5. For hosting only: `firebase deploy --only hosting`

---

## Suggested Future Implementations

### High Priority
- **Shift swap requests** — teacher requests to swap a shift with another teacher, admin approves/denies. Would need a `swapRequests` collection and notifications to both teachers + admin.
- **Recurring shift templates** — save a shift pattern (e.g. every Tuesday 2-3pm at School X) and apply it to any week with one click. Reduces manual data entry significantly.
- **Teacher availability** — teachers mark days/times they're unavailable. Admin sees conflicts highlighted in red before assigning. Would need an `availability` collection per teacher.
- **Payroll export improvements** — current CSV export is basic. Add pay period grouping, per-teacher summaries, and direct integration with QuickBooks or Gusto.
- **Admin shift approval workflow** — currently shifts go live immediately. Add a draft → review → publish flow with email confirmation before teachers are notified.

### Medium Priority
- **In-app shift history** — full audit log of who changed what and when. Currently changes overwrite previous data with no history.
- **Teacher performance tracking** — track confirmation rate, rejection rate, late cancellations per teacher. Visible to admin only.
- **Bulk shift assignment** — assign the same teacher to multiple shifts at once from a multi-select UI instead of one by one.
- **Google Calendar sync** — teachers can connect their Google Calendar and confirmed shifts automatically appear there.
- **Substitution pool** — when a shift is rejected or released, automatically notify a pool of available subs rather than broadcasting to all teachers.
- **Read receipts on shift assignments** — admin can see when a teacher has opened/read their shift notification, not just whether they confirmed.

### Nice to Have
- **Dark/light mode toggle** — currently hardcoded dark. Add a toggle stored in user preferences.
- **Multi-language support** — Young Rembrandts operates across regions. Spanish support would be valuable.
- **Offline mode** — Firestore offline persistence (carefully implemented) so teachers can view their schedule without internet.
- **Admin app as PWA** — same Home Screen install flow as teacher app, with push notifications for admin.
- **Shift check-in** — teacher taps "I'm here" when they arrive at a shift location. Admin sees real-time attendance.
- **Parent/client-facing portal** — read-only view showing which teacher is assigned to their class and contact info.
- **Connecteam migration assistant** — smarter CSV importer that maps column names automatically and previews before importing.
- **Analytics dashboard** — weekly hours per teacher, fill rate for open shifts, cancellation trends, busiest days.

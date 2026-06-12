# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YRShifts is a shift-scheduling PWA for Young Rembrandts. The monorepo contains two separate React apps and a Firebase deployment hub:

- `yrshifts-admin/` — Admin web app (React + Vite), served at `/admin`
- `yrshifts-teacher/` — Teacher web app (React + Vite), served at `/app`
- `yrshifts-deploy/` — Firebase Hosting config, Firestore rules, and Cloud Functions

## Commands

### Development
```bash
# Run dev servers (run separately in each app folder)
cd yrshifts-admin && npm run dev
cd yrshifts-teacher && npm run dev
```

### Build & Deploy
```bash
# Build both apps + deploy everything (from yrshifts-deploy/)
bash deploy-all.sh

# Hosting + Firestore rules only (skip Cloud Functions)
bash deploy-all.sh --skip-functions

# Deploy Cloud Functions only (from yrshifts-deploy/)
firebase deploy --only functions

# Deploy hosting only (requires dist/ to already be built)
firebase deploy --only hosting
```

### Cloud Functions
```bash
# Deploy functions only (from yrshifts-deploy/functions/)
npm run deploy
```

## Architecture

Both frontend apps are independent Vite projects. `deploy-all.sh` builds both, merges their `dist/` outputs into `yrshifts-deploy/dist/`, then runs `firebase deploy`.

**Tech Stack:**
- React 19, Vite 8, Tailwind CSS v3
- Zustand v5 (global state), React Router v6 (admin only)
- Firebase v11 (Firestore, Auth, Storage, FCM, Functions)
- TipTap rich-text editor (admin Weekly Buzz only)
- Cloud Functions: Node.js 22, Firebase Functions v2, nodemailer, Twilio

**User Roles:** `owner` / `admin` / `manager` / `teacher` — stored in `users.role` in Firestore.

**Firestore collections:** `users`, `shifts`, `settings/company`, `kb_nodes`, `weekly_buzz`, `notifications`, `events`, `chats` + `chats/{id}/messages`, `reminders`

## Key Patterns and Gotchas

- **Vite base paths are critical:** admin builds with `base: '/admin'`, teacher with `base: '/app'`. Do not change these.
- **No test or lint scripts** exist in this project.
- **Firestore indexes:** 8 composite indexes are managed manually in the Firebase Console. Do not attempt `firebase deploy --only firestore:indexes` — it causes 400 errors.
- **Auth listener:** `onAuthStateChanged` is intentionally never cancelled (even on sign-out) for Safari compatibility. Only the profile sub-listener is cancelled.
- **Teacher first-login:** Profile doc is created asynchronously by the `createTeacherAccount` Cloud Function. The auth store polls up to 12 times before giving up.
- **Chat store:** `useChatStore.init()` subscribes to ALL chat message streams at startup to keep unread badge counts accurate without opening each chat.
- **iOS Safari:** `safari.css` + `@supports (-webkit-touch-callout: none)` handles the known gap below the tab bar in browser mode.
- **Environment variables:** Both apps require `.env` files with `VITE_FIREBASE_*` keys. The teacher app also needs `VITE_FIREBASE_VAPID_KEY` for FCM push. Firebase secrets (`SMTP_USER`, `SMTP_PASS`, optional Twilio vars) are set via Firebase CLI, not `.env`.

## Deployment URLs

- Admin: `https://yrshifts.web.app/admin`
- Teacher: `https://yrshifts.web.app/app`

## Behavioral Guidelines

These guidelines bias toward caution over speed to reduce common LLM coding mistakes. For trivial tasks, use judgment.

### 1. Think Before Coding
**Don't assume. Don't hide confusion. Surface tradeoffs.**
Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
**Minimum code that solves the problem. Nothing speculative.**
- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
**Touch only what you must. Clean up only your own mess.**
When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it, but don't delete it (unless it was created by your own changes).

### 4. Goal-Driven Execution
**Define success criteria and loop until verified.**
- Transform vague tasks into concrete, verifiable success criteria before starting.
- For non-trivial tasks, state a brief plan consisting of verifiable steps.
- Loop and refine until success criteria are met.


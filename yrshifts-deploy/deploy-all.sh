#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# YRShifts — deploy BOTH apps in one shot
#
# Usage (run from THIS folder):
#   bash deploy-all.sh                   → full deploy (hosting + firestore + functions)
#   bash deploy-all.sh --skip-functions  → hosting + firestore only
#
# Folder structure expected:
#   yrshifts-admin/     ← admin app (sibling of this folder)
#   yrshifts-teacher/   ← teacher app (sibling of this folder)
#   yrshifts-deploy/    ← THIS folder
# ─────────────────────────────────────────────────────────────────────────────
set -e

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADMIN_DIR="$(dirname "$DEPLOY_DIR")/yrshifts-admin"
TEACHER_DIR="$(dirname "$DEPLOY_DIR")/yrshifts-teacher"
DIST_DIR="$DEPLOY_DIR/dist"

SKIP_FUNCTIONS=false
[[ "$1" == "--skip-functions" ]] && SKIP_FUNCTIONS=true

echo ""
echo "🔥  YRShifts — deploying admin + teacher"
echo "──────────────────────────────────────────"

# ── Verify both folders exist ──────────────────────────────────────────────
if [ ! -d "$ADMIN_DIR" ]; then
  echo "❌  yrshifts-admin not found at: $ADMIN_DIR"
  echo "    Make sure yrshifts-admin and yrshifts-deploy are in the same parent folder."
  exit 1
fi

if [ ! -d "$TEACHER_DIR" ]; then
  echo "❌  yrshifts-teacher not found at: $TEACHER_DIR"
  exit 1
fi

# ── Build admin app ────────────────────────────────────────────────────────
echo ""
echo "📦  [1/3] Building admin app…"
cd "$ADMIN_DIR"
[ ! -f ".env" ] && echo "❌  yrshifts-admin/.env not found" && exit 1
npm install --silent
npm run build

# ── Build teacher app ──────────────────────────────────────────────────────
echo ""
echo "📦  [2/3] Building teacher app…"
cd "$TEACHER_DIR"
[ ! -f ".env" ] && echo "❌  yrshifts-teacher/.env not found" && exit 1
npm install --silent
npm run build

# ── Merge into combined dist ───────────────────────────────────────────────
echo ""
echo "🗂   [3/3] Merging build outputs…"
cd "$DEPLOY_DIR"

rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/admin"
mkdir -p "$DIST_DIR/app"

# Copy admin dist → dist/admin/
cp -r "$ADMIN_DIR/dist/." "$DIST_DIR/admin/"

# Copy teacher dist → dist/app/
cp -r "$TEACHER_DIR/dist/." "$DIST_DIR/app/"

echo "    ✓ dist/admin/ — $(find "$DIST_DIR/admin" -type f | wc -l | tr -d ' ') files"
echo "    ✓ dist/app/   — $(find "$DIST_DIR/app"   -type f | wc -l | tr -d ' ') files"

# ── Deploy ─────────────────────────────────────────────────────────────────
echo ""
if [ "$SKIP_FUNCTIONS" = true ]; then
  echo "🚀  Deploying hosting + Firestore (skipping functions)…"
  firebase deploy --only hosting,firestore:rules
else
  echo "📦  Installing Cloud Functions dependencies…"
  (cd "$DEPLOY_DIR/functions" && npm install --silent)
  echo "🚀  Deploying everything…"
  firebase deploy --only hosting,firestore:rules,functions
fi

echo ""
echo "✅  Both apps live:"
echo "    Admin:   https://yrshifts.web.app/admin"
echo "    Teacher: https://yrshifts.web.app/app"
echo ""
echo "──── Optional: enable notification delivery ─────────────────────────────"
echo "📧  firebase functions:secrets:set SMTP_USER"
echo "📧  firebase functions:secrets:set SMTP_PASS"
echo "📱  firebase functions:secrets:set TWILIO_SID"
echo "📱  firebase functions:secrets:set TWILIO_TOKEN"
echo "📱  firebase functions:secrets:set TWILIO_FROM"
echo ""
echo "    After setting secrets: firebase deploy --only functions"
echo "─────────────────────────────────────────────────────────────────────────"

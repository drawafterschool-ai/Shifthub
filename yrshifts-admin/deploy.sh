#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "🔥  YRShifts Admin — deploy"
echo "────────────────────────────"

[ ! -f ".env" ] && echo "❌  .env not found" && exit 1

SKIP_FUNCTIONS=false
[[ "$1" == "--skip-functions" ]] && SKIP_FUNCTIONS=true

echo "📦  Installing frontend dependencies…"
npm install

echo "🏗️   Building…"
npm run build

if [ "$SKIP_FUNCTIONS" = true ]; then
  echo "⏩  Skipping functions (--skip-functions)"
  echo "🚀  Deploying hosting + Firestore…"
  firebase deploy --only hosting,firestore
else
  echo "📦  Installing Cloud Functions dependencies…"
  (cd "$SCRIPT_DIR/functions" && npm install)
  echo "🚀  Deploying everything…"
  firebase deploy --only hosting,firestore,functions
fi

echo ""
echo "✅  Live at: https://yrshifts.web.app/admin"
echo ""
echo "──── Optional: enable notification delivery ─────────────────────────────"
echo "📧  Email:"
echo "    firebase functions:secrets:set SMTP_USER  (your Gmail address)"
echo "    firebase functions:secrets:set SMTP_PASS  (Gmail App Password)"
echo ""
echo "📱  SMS (Twilio):"
echo "    firebase functions:secrets:set TWILIO_SID"
echo "    firebase functions:secrets:set TWILIO_TOKEN"
echo "    firebase functions:secrets:set TWILIO_FROM  (+15551234567)"
echo ""
echo "    Then redeploy: firebase deploy --only functions"
echo "─────────────────────────────────────────────────────────────────────────"

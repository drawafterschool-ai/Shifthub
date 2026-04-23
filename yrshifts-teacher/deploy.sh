#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "📱  YRShifts Teacher — deploy"
echo "──────────────────────────────"

[ ! -f ".env" ] && echo "❌  .env not found" && exit 1

echo "📦  Installing dependencies…"
npm install

echo "🏗️   Building…"
npm run build

echo "🚀  Deploying to Firebase…"
firebase deploy --only hosting

echo ""
echo "✅  Live at: https://yrshifts.web.app/app"

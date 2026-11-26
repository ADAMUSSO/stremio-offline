#!/usr/bin/env bash
# Odinštalovanie Offline Stremio na macOS — vráti bežné spúšťanie Stremia; stiahnuté súbory a dáta ostanú
set -euo pipefail

[[ "$(uname)" == "Darwin" ]] || { echo "This script is for macOS. On Linux use ./uninstall.sh" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
LABEL="community.offline-stremio"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl unsetenv WEBUI_URL 2>/dev/null || true
rm -rf "$HOME/Applications/Stremio Offline.app"
pkill -f "$DIR/server.js" 2>/dev/null || true

echo "Uninstalled. Downloads stay in ~/Movies/Stremio, data in ~/Library/Application Support/stremio-offline."
echo "Quit Stremio completely (Cmd+Q) and open it again."

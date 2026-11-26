#!/usr/bin/env bash
# Odinštalovanie Offline Stremio na macOS — zmaže spúšťač a zastaví pomocníka; stiahnuté súbory a dáta ostanú
set -euo pipefail

[[ "$(uname)" == "Darwin" ]] || { echo "This script is for macOS. On Linux use ./uninstall.sh" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
rm -rf "$HOME/Applications/Stremio Offline.app"
pkill -f "$DIR/server.js" 2>/dev/null || true

echo "Uninstalled. Downloads stay in ~/Movies/Stremio, data in ~/Library/Application Support/stremio-offline."
echo "Start Stremio normally; if it is open now, quit it and start it again."

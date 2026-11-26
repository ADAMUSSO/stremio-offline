#!/usr/bin/env bash
# Inštalácia Offline Stremio na macOS
#  - vytvorí aplikáciu ~/Applications/Stremio Offline.app (spúšťač)
#  - spúšťač naštartuje pomocníka (node server.js) a potom Stremio s --webui-url na náš server
#  - Stremio.app sa nemení; pôvodné Stremio sa dá ďalej spúšťať normálne (bez funkcií Offline)
# Spustenie: v Termináli v priečinku projektu  ./install-macos.sh   (odinštalovanie: ./uninstall-macos.sh)
set -euo pipefail

[[ "$(uname)" == "Darwin" ]] || { echo "This script is for macOS. On Linux use ./install.sh" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-11488}"
LAUNCHER="$HOME/Applications/Stremio Offline.app"

# Node.js 20+ (aplikácia spustená z Findera nemá PATH z Terminálu → uložíme absolútnu cestu)
NODE=""
for candidate in "$(command -v node || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
    [[ -x "$candidate" ]] || continue
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if (( major >= 20 )); then NODE="$candidate"; break; fi
done
if [[ -z "$NODE" ]]; then
    echo "Node.js 20 or newer is required." >&2
    echo "Install it with Homebrew (brew install node) or from https://nodejs.org, then run this again." >&2
    exit 1
fi

# Stremio 5 pre macOS
APP=""
for candidate in "/Applications/Stremio.app" "$HOME/Applications/Stremio.app"; do
    [[ -d "$candidate" ]] && { APP="$candidate"; break; }
done
[[ -n "$APP" ]] || { echo "Stremio.app was not found in /Applications. Install Stremio 5 for macOS first." >&2; exit 1; }
VERSION="$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo 0)"
if [[ "${VERSION%%.*}" -lt 5 ]]; then
    echo "Stremio $VERSION found, but version 5 or newer is needed (it supports --webui-url)." >&2
    exit 1
fi
EXE_NAME="$(defaults read "$APP/Contents/Info" CFBundleExecutable)"
BUNDLE_ID="$(defaults read "$APP/Contents/Info" CFBundleIdentifier)"

# spúšťač ako malá .app (skript), ikona zo Stremia
rm -rf "$LAUNCHER"
mkdir -p "$LAUNCHER/Contents/MacOS" "$LAUNCHER/Contents/Resources"
cp "$APP/Contents/Resources/AppIcon.icns" "$LAUNCHER/Contents/Resources/AppIcon.icns" 2>/dev/null || true

cat > "$LAUNCHER/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Stremio Offline</string>
    <key>CFBundleDisplayName</key><string>Stremio Offline</string>
    <key>CFBundleIdentifier</key><string>community.offline-stremio.launcher</string>
    <key>CFBundleExecutable</key><string>stremio-offline</string>
    <key>CFBundleIconFile</key><string>AppIcon</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

cat > "$LAUNCHER/Contents/MacOS/stremio-offline" <<EOF
#!/bin/bash
# Spúšťač Offline Stremio: pomocník + Stremio s upraveným rozhraním
NODE="$NODE"
DIR="$DIR"
APP="$APP"
EXE="\$APP/Contents/MacOS/$EXE_NAME"
BUNDLE_ID="$BUNDLE_ID"
PORT="$PORT"
URL="http://127.0.0.1:\$PORT/"
LOG="\$HOME/Library/Logs/offline-stremio.log"

health() { curl -sf -m 1 "http://127.0.0.1:\$PORT/__dl/health" >/dev/null; }
alert() { osascript -e "display alert \"Stremio Offline\" message \"\$1\"" >/dev/null; }

# 1) pomocník — sám sa vypne asi minútu po zatvorení Stremia (IDLE_EXIT)
if ! health; then
    IDLE_EXIT=1 PORT="\$PORT" nohup "\$NODE" "\$DIR/server.js" >>"\$LOG" 2>&1 &
    for _ in \$(seq 50); do health && break; sleep 0.2; done
fi
if ! health; then
    alert "The Offline helper did not start. Details are in ~/Library/Logs/offline-stremio.log. Opening normal Stremio."
    open -a "\$APP"
    exit 1
fi

# 2) Stremio už beží bez nášho rozhrania? "open --args" by sa vtedy ignorovalo → ponúkneme reštart
running="\$(ps -axww -o pid=,args= | grep -F "\$EXE" | grep -v grep | head -1)"
if [[ -n "\$running" && "\$running" != *"--webui-url=\$URL"* ]]; then
    answer="\$(osascript -e 'button returned of (display dialog "Stremio is already running without the Offline features. Restart it now?" buttons {"Cancel", "Restart"} default button "Restart" with title "Stremio Offline")' 2>/dev/null || true)"
    [[ "\$answer" == "Restart" ]] || exit 0
    osascript -e "tell application id \"\$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in \$(seq 50); do ps -axww -o args= | grep -F "\$EXE" | grep -qv grep || break; sleep 0.2; done
fi

# 3) Stremio s naším rozhraním (alebo len do popredia, ak už tak beží)
open -a "\$APP" --args "--webui-url=\$URL"
EOF
chmod +x "$LAUNCHER/Contents/MacOS/stremio-offline"
touch "$LAUNCHER"

echo "Installed: $LAUNCHER"
echo "  Node.js:  $NODE"
echo "  Stremio:  $APP ($VERSION)"
echo
echo "Start Stremio with \"Stremio Offline\" (Applications → Stremio Offline, or drag it to the Dock)."
echo "The first time you will need to log in to Stremio again (the interface runs from a local address)."
echo "When macOS asks whether node may access a removable volume or the Downloads folder, allow it."

#!/usr/bin/env bash
# Inštalácia Offline Stremio na macOS — bežná ikona Stremia dostane funkcie Offline (ako na Linuxe)
#  - LaunchAgent pri prihlásení spustí macos/offline-stremio-agent.sh, ktorý:
#      * nastaví WEBUI_URL pre aplikácie z Docku/Findera (Stremio 5 ju číta ako --webui-url)
#      * pri štarte Stremia spustí pomocníka (node server.js); ten sa sám vypne po zatvorení Stremia
#  - Stremio.app sa nemení. Záloha: ./install-macos.sh --launcher vytvorí aj aplikáciu "Stremio Offline",
#    ktorá spúšťa Stremio s --webui-url priamo (keby premenná WEBUI_URL na niektorom Macu nezabrala)
# Spustenie: v Termináli v priečinku projektu  ./install-macos.sh   (odinštalovanie: ./uninstall-macos.sh)
set -euo pipefail

[[ "$(uname)" == "Darwin" ]] || { echo "This script is for macOS. On Linux use ./install.sh" >&2; exit 1; }

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-11488}"
LABEL="community.offline-stremio"
AGENT_PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAUNCHER="$HOME/Applications/Stremio Offline.app"
WITH_LAUNCHER=0
[[ "${1:-}" == "--launcher" ]] && WITH_LAUNCHER=1

# Node.js 20+ (launchd ani Finder nemajú PATH z Terminálu → uložíme absolútnu cestu)
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
    echo "Stremio $VERSION found, but version 5 or newer is needed (it supports --webui-url / WEBUI_URL)." >&2
    exit 1
fi
EXE="$APP/Contents/MacOS/$(defaults read "$APP/Contents/Info" CFBundleExecutable)"
BUNDLE_ID="$(defaults read "$APP/Contents/Info" CFBundleIdentifier)"

chmod +x "$DIR/macos/offline-stremio-agent.sh"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

cat > "$AGENT_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$DIR/macos/offline-stremio-agent.sh</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OFFLINE_STREMIO_NODE</key><string>$NODE</string>
        <key>OFFLINE_STREMIO_DIR</key><string>$DIR</string>
        <key>STREMIO_EXE</key><string>$EXE</string>
        <key>PORT</key><string>$PORT</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardErrorPath</key><string>$HOME/Library/Logs/offline-stremio-agent.log</string>
</dict>
</plist>
EOF

# (re)načítanie agenta — hneď nastaví WEBUI_URL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_PLIST"

# voliteľná záloha: samostatná aplikácia, ktorá spúšťa Stremio s --webui-url
rm -rf "$LAUNCHER"
if (( WITH_LAUNCHER )); then
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
# Záložný spúšťač: pomocník + Stremio s --webui-url (keď beží bez neho, ponúkne reštart)
NODE="$NODE"; DIR="$DIR"; APP="$APP"; EXE="$EXE"; BUNDLE_ID="$BUNDLE_ID"; PORT="$PORT"
URL="http://127.0.0.1:\$PORT/"
LOG="\$HOME/Library/Logs/offline-stremio.log"
health() { curl -sf -m 1 "http://127.0.0.1:\$PORT/__dl/health" >/dev/null; }
if ! health; then
    IDLE_EXIT=1 PORT="\$PORT" nohup "\$NODE" "\$DIR/server.js" >>"\$LOG" 2>&1 &
    for _ in \$(seq 50); do health && break; sleep 0.2; done
fi
running="\$(ps -axww -o pid=,args= | grep -F "\$EXE" | grep -v grep | head -1)"
if [[ -n "\$running" && "\$running" != *"--webui-url=\$URL"* ]]; then
    answer="\$(osascript -e 'button returned of (display dialog "Stremio is already running without the Offline features. Restart it now?" buttons {"Cancel", "Restart"} default button "Restart" with title "Stremio Offline")' 2>/dev/null || true)"
    [[ "\$answer" == "Restart" ]] || exit 0
    osascript -e "tell application id \"\$BUNDLE_ID\" to quit" >/dev/null 2>&1 || true
    for _ in \$(seq 50); do ps -axww -o args= | grep -F "\$EXE" | grep -qv grep || break; sleep 0.2; done
fi
open -a "\$APP" --args "--webui-url=\$URL"
EOF
    chmod +x "$LAUNCHER/Contents/MacOS/stremio-offline"
fi

echo "Installed."
echo "  Node.js:  $NODE"
echo "  Stremio:  $APP ($VERSION)"
echo "  Agent:    $AGENT_PLIST"
(( WITH_LAUNCHER )) && echo "  Launcher: $LAUNCHER"
echo
echo "Quit Stremio completely (Cmd+Q) and open it again from the Dock or Applications as usual."
echo "The first time you will need to log in to Stremio again (the interface runs from a local address)."
echo "macOS may show a \"Background item added\" notice and ask whether node may access a removable volume"
echo "or the Downloads folder — allow it."
